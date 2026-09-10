'use strict';

// ============================================================
//  内嵌模型 Provider（渲染进程侧）
//  WebLLM + WebGPU：首次经国内镜像下载约 281MB 进缓存，之后完全离线
//  对主进程暴露与 LlmClient 相同的 chat() 形状——Agent 三通道之一。
//
//  加载形态：经典 <script>（禁止顶层 export / TS 注解，CI 有语法门禁），
//  挂载 window.EmbeddedLlm。
//
//  镜像说明（2026-09 探针实测）：
//    - huggingface.co 直连在大陆网络直接 Failed to fetch；
//    - hf-mirror.com 200 / gh-proxy.com 206（Range 生效）。
//  因此：模型权重走 hf-mirror；模型库 wasm 走 gh-proxy 代理
//  raw.githubusercontent.com（与更新器同款镜像思路）。
// ============================================================

(function () {
  const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

  // 权重目录（hf-mirror 镜像 huggingface.co/mlc-ai/…）
  const MIRROR_MODEL_URL = 'https://hf-mirror.com/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/main/';
  // 模型库 wasm（gh-proxy 代理 raw.githubusercontent.com）
  const MIRROR_MODEL_LIB_URL = 'https://gh-proxy.com/https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';

  // 首次下载量（诚实告知，实测：权重 276MB + 库 4.6MB）
  const MODEL_INFO = {
    id: MODEL_ID,
    label: 'Qwen2.5-0.5B',
    weightsMB: 276,
    libMB: 5,
    totalMB: 281,
    vramMB: 945,
    mirrorModelUrl: MIRROR_MODEL_URL,
    mirrorLibUrl: MIRROR_MODEL_LIB_URL
  };

  let _webllm = null;
  let _engine = null;             // EngineInstance
  let _loading = null;
  let _progressCb = null;

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

  // 用镜像源改写 prebuiltAppConfig 里本模型的两个下载地址（其余 162 条记录原样保留）
  function mirroredAppConfig(webllm) {
    const base = webllm.prebuiltAppConfig;
    if (!base || !Array.isArray(base.model_list)) return undefined;
    return {
      ...base,
      model_list: base.model_list.map(function (r) {
        return r.model_id === MODEL_ID
          ? { ...r, model: MIRROR_MODEL_URL, model_lib: MIRROR_MODEL_LIB_URL }
          : r;
      })
    };
  }

  // 初始化（含模型下载，带进度回调）。重复调用复用同一 engine。
  async function ensureEngine(onProgress) {
    if (_engine) return _engine;
    if (_loading) return _loading;
    _progressCb = onProgress || null;

    _loading = (async function () {
      const webllm = await loadWebllm();
      const engine = await webllm.CreateMLCEngine(MODEL_ID, {
        appConfig: mirroredAppConfig(webllm),
        initProgressCallback: function (report) {
          // report.progress: 0~1（下载+加载统一进度）
          if (_progressCb) {
            _progressCb({
              phase: /fetch|download/i.test(report.text || '') ? 'download' : 'load',
              percent: Math.round((report.progress || 0) * 100),
              text: report.text || ''
            });
          }
        }
      });
      _engine = engine;
      return engine;
    })();

    try {
      return await _loading;
    } catch (err) {
      _loading = null; // 失败允许重试
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

  // 诊断/测试用：只加载模块本体（不下载模型），验证相对 import 与 CSP 均可用
  async function moduleSelfTest() {
    const m = await loadWebllm();
    return {
      exports: Object.keys(m).length,
      hasCreateMLCEngine: typeof m.CreateMLCEngine === 'function',
      prebuiltModels: m.prebuiltAppConfig && m.prebuiltAppConfig.model_list ? m.prebuiltAppConfig.model_list.length : 0
    };
  }

  window.EmbeddedLlm = {
    MODEL_ID: MODEL_ID,
    modelInfo: MODEL_INFO,
    webgpuAvailable: webgpuAvailable,
    ensureEngine: ensureEngine,
    isEngineReady: isEngineReady,
    embeddedChat: embeddedChat,
    unloadEngine: unloadEngine,
    moduleSelfTest: moduleSelfTest
  };
})();
