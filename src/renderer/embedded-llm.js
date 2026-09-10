'use strict';

// ============================================================
//  内嵌模型 Provider（渲染进程侧）
//  WebLLM + WebGPU：首次经国内镜像下载约 270-281MB 进缓存，之后完全离线
//  对主进程暴露与 LlmClient 相同的 chat() 形状——Agent 三通道之一。
//
//  加载形态：经典 <script>（禁止顶层 export / TS 注解，CI 有语法门禁），
//  挂载 window.EmbeddedLlm。
//
//  镜像（2026-09 探针实测）：huggingface.co 直连在大陆 Failed to fetch；
//  hf-mirror.com 200（LFS 大文件 302 到 cas-bridge.xethub.hf.co，CSP 已放行）；
//  gh-proxy.com 206（Range 生效）。权重走 hf-mirror，模型库 wasm 走 gh-proxy。
//
//  显卡选档（探针实测踩坑）：q4f16 模型的 WGSL 用 f16 着色器，
//  GPU 不支持 shader-f16 时编译直接失败（Invalid ShaderModule）——
//  故按 adapter.features 自动选 q4f16 / q4f32，用户无感。
// ============================================================

(function () {
  const MODEL_VERSION = 'v0_2_84/base';
  const LIB_PREFIX = 'https://gh-proxy.com/https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/';

  // 两个量化档位：f16 更省显存；f32 兼容所有 WebGPU 显卡。权重体积几乎一样。
  const VARIANTS = {
    f16: {
      key: 'f16',
      modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      weightsMB: 276, libMB: 5, vramMB: 945,
      mirrorModelUrl: 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/',
      mirrorLibUrl: LIB_PREFIX + MODEL_VERSION + '/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
      requiresF16: true
    },
    f32: {
      key: 'f32',
      modelId: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
      weightsMB: 265, libMB: 5, vramMB: 1060,
      mirrorModelUrl: 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC/resolve/main/',
      mirrorLibUrl: LIB_PREFIX + MODEL_VERSION + '/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm',
      requiresF16: false
    }
  };

  let _webllm = null;
  let _engine = null;             // EngineInstance
  let _loading = null;
  let _progressCb = null;
  let _variant = null;            // 已检测的档位（会话内不变）

  // 相对路径对开发（仓库根 node_modules）与打包（asar 根 node_modules）同构
  async function loadWebllm() {
    if (_webllm) return _webllm;
    _webllm = await import('../../node_modules/@mlc-ai/web-llm/lib/index.js');
    return _webllm;
  }

  // WebGPU 可用性（含 adapter 检测，比 navigator.gpu 存在性更准）
  async function webgpuAvailable() {
    try {
      const gpu = navigator.gpu;
      if (!gpu) return false;
      const adapter = await gpu.requestAdapter();
      return !!adapter;
    } catch (_) {
      return false;
    }
  }

  // CSP 是否放行 WebAssembly 编译（WebLLM 运行库是 wasm；
  // script-src 缺 'wasm-unsafe-eval' 时 instantiate 会被 CSP 拒绝——
  // 8 字节最小合法模块，同步编译即验证，零下载）
  function wasmCompilable() {
    try {
      new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      return true;
    } catch (_) {
      return false;
    }
  }

  // 按显卡能力选档：支持 shader-f16 → q4f16（省显存）；否则 q4f32（全兼容）
  async function detectVariant() {
    if (_variant) return _variant;
    try {
      const gpu = navigator.gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      _variant = (adapter && adapter.features && adapter.features.has('shader-f16'))
        ? VARIANTS.f16
        : VARIANTS.f32;
    } catch (_) {
      _variant = VARIANTS.f32;
    }
    return _variant;
  }

  // 用镜像源改写 prebuiltAppConfig 里所选模型的两个下载地址（其余记录原样保留）
  function mirroredAppConfig(webllm, variant) {
    const base = webllm.prebuiltAppConfig;
    if (!base || !Array.isArray(base.model_list)) return undefined;
    return {
      ...base,
      model_list: base.model_list.map(function (r) {
        return r.model_id === variant.modelId
          ? { ...r, model: variant.mirrorModelUrl, model_lib: variant.mirrorLibUrl }
          : r;
      })
    };
  }

  // 网络类错误才值得重试（镜像偶发抖动是常态）；
  // 着色器编译 / 显存不足这类确定性失败重试无意义，快速失败
  function isRetryableError(err) {
    const msg = String((err && err.message) || err);
    return /fetch|network|Cache\.add|aborted|timeout|ECONN|socket|ENOTFOUND|EAI_AGAIN/i.test(msg);
  }

  // 初始化（含模型下载，带进度回调）。重复调用复用同一 engine。
  // 网络抖动自动重试（已下载分片在缓存里命中，重试即断点续传），最多 3 次。
  const DL_MAX_ATTEMPTS = 3;
  const DL_RETRY_WAIT_MS = 1500;

  async function ensureEngineOnce(variant, onProgress) {
    const webllm = await loadWebllm();
    return webllm.CreateMLCEngine(variant.modelId, {
      appConfig: mirroredAppConfig(webllm, variant),
      initProgressCallback: function (report) {
        // report.progress: 0~1（下载+加载统一进度）
        if (onProgress) {
          onProgress({
            phase: /fetch|download/i.test(report.text || '') ? 'download' : 'load',
            percent: Math.round((report.progress || 0) * 100),
            text: report.text || ''
          });
        }
      }
    });
  }

  async function ensureEngine(onProgress) {
    if (_engine) return _engine;
    if (_loading) return _loading;
    _progressCb = onProgress || null;

    _loading = (async function () {
      const variant = await detectVariant();
      let lastErr = null;
      for (let attempt = 1; attempt <= DL_MAX_ATTEMPTS; attempt++) {
        try {
          const engine = await ensureEngineOnce(variant, function (p) {
            if (_progressCb) _progressCb(p);
          });
          _engine = engine;
          return engine;
        } catch (err) {
          lastErr = err;
          // 确定性失败（如显卡能力不足）快速失败，不浪费重试
          if (!isRetryableError(err) || attempt >= DL_MAX_ATTEMPTS) break;
          // 已就绪的文件在缓存里，重试会跳过——只剩网络抖动恢复的成本
          if (_progressCb) {
            _progressCb({
              phase: 'download',
              percent: 0,
              text: '网络波动，第 ' + (attempt + 1) + '/' + DL_MAX_ATTEMPTS + ' 次自动续传…'
            });
          }
          await new Promise(function (r) { setTimeout(r, DL_RETRY_WAIT_MS * attempt); });
        }
      }
      throw lastErr || new Error('模型下载失败');
    })();

    try {
      return await _loading;
    } catch (err) {
      _loading = null; // 失败允许整体重试
      throw err;
    }
  }

  function isEngineReady() {
    return !!_engine;
  }

  // 对话：返回全文（非流式简单版——Agent 改写需要完整 JSON，流式无益）
  async function embeddedChat(messages) {
    const engine = _engine || await ensureEngine();
    const reply = await engine.chat.completions.create({ messages: messages, stream: false });
    const content = reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content;
    if (!content) throw new Error('内嵌模型未返回内容');
    return content;
  }

  // 释放（切换 provider 时省内存）
  async function unloadEngine() {
    try {
      if (_engine && _engine.unload) await _engine.unload();
    } catch (_) { /* 忽略 */ }
    _engine = null;
    _loading = null;
  }

  // 诊断/测试用：只加载模块本体（不触发下载），验证相对 import、CSP、wasm、选档
  async function moduleSelfTest() {
    const m = await loadWebllm();
    const variant = await detectVariant();
    return {
      exports: Object.keys(m).length,
      hasCreateMLCEngine: typeof m.CreateMLCEngine === 'function',
      prebuiltModels: m.prebuiltAppConfig && m.prebuiltAppConfig.model_list ? m.prebuiltAppConfig.model_list.length : 0,
      wasmCompilable: wasmCompilable(),
      variant: variant.key,
      variantModelId: variant.modelId,
      variantTotalMB: variant.weightsMB + variant.libMB
    };
  }

  // 同步信息（默认档）；UI 需要精确值时用 getVariantInfo()（异步、含显卡检测）
  window.EmbeddedLlm = {
    MODEL_ID: VARIANTS.f16.modelId,
    modelInfo: {
      id: VARIANTS.f16.modelId,
      label: 'Qwen2.5-0.5B',
      weightsMB: VARIANTS.f16.weightsMB,
      libMB: VARIANTS.f16.libMB,
      totalMB: VARIANTS.f16.weightsMB + VARIANTS.f16.libMB,
      vramMB: VARIANTS.f16.vramMB,
      mirrorModelUrl: VARIANTS.f16.mirrorModelUrl,
      mirrorLibUrl: VARIANTS.f16.mirrorLibUrl
    },
    VARIANTS: VARIANTS,
    webgpuAvailable: webgpuAvailable,
    wasmCompilable: wasmCompilable,
    detectVariant: detectVariant,
    getVariantInfo: detectVariant,
    ensureEngine: ensureEngine,
    isEngineReady: isEngineReady,
    embeddedChat: embeddedChat,
    unloadEngine: unloadEngine,
    moduleSelfTest: moduleSelfTest
  };
})();
