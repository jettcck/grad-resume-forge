'use strict';

// ============================================================
//  内嵌模型 Provider（渲染进程侧）
//  WebLLM + WebGPU：模型下载进缓存（首次 ~500MB，之后离线可用）
//  对主进程暴露与 LlmClient 相同的 chat() 形状——Agent 三通道之一。
//  兼容降级：无 WebGPU / WebLLM 加载失败 → available:false，
//  UI 置灰并引导用知识库或云端。
// ============================================================

// 动态 import（webllm 是可选依赖，加载失败不影响应用其他功能）
let _webllm = null;
let _engine = null;             // EngineInstance
let _loading = null;
let _progressCb = null;

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

async function loadWebllm() {
  if (_webllm) return _webllm;
  _webllm = await import('@mlc-ai/web-llm');
  return _webllm;
}

// WebGPU 可用性（含 adapter 检测，比 navigator.gpu 存在性更准）
export async function webgpuAvailable() {
  try {
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch (_) {
    return false;
  }
}

// 初始化（含模型下载，带进度回调）。重复调用复用同一 engine。
export async function ensureEngine(onProgress) {
  if (_engine) return _engine;
  if (_loading) return _loading;
  _progressCb = onProgress || null;

  _loading = (async () => {
    const webllm = await loadWebllm();
    const engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        // report.progress: 0~1（下载+加载统一进度）
        if (_progressCb) {
          _progressCb({
            phase: /fetch|download/i.test(report.text || '') ? 'download' : 'load',
            percent: Math.round((report.progress || 0) * 100)
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

export function isEngineReady(): boolean {
  return !!_engine;
}

// 对话：返回全文（非流式简单版——Agent 改写需要完整 JSON，流式无益）
export async function embeddedChat(messages) {
  const engine = _engine || await ensureEngine();
  const reply = await engine.chat.completions.create({ messages, stream: false });
  const content = reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content;
  if (!content) throw new Error('内嵌模型未返回内容');
  return content;
}

// 释放（切换 provider 时省内存）
export async function unloadEngine() {
  try {
    if (_engine && _engine.unload) await _engine.unload();
  } catch (_) { /* 忽略 */ }
  _engine = null;
  _loading = null;
}
