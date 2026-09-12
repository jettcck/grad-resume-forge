'use strict';

// ============================================================
//  本机模型服务自动探测
//  目的：用户如果已经因为别的原因装了本地推理服务（LM Studio / llama.cpp /
//  vLLM / Jan / GPT4All …），不必再让他「去装 Ollama」——探测到就直接用。
//  这些都是 OpenAI 兼容接口，统一 GET {base}/models 即可判定。
//  全部只探 127.0.0.1，短超时、并发探测，绝不影响启动速度。
// ============================================================

export interface DetectedService {
  id: string;
  name: string;
  endpoint: string;
  models: string[];
}

interface Candidate { id: string; name: string; endpoint: string }

// 常见本地推理服务的默认 OpenAI 兼容端口
const CANDIDATES: readonly Candidate[] = [
  { id: 'ollama', name: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1' },
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1' },
  { id: 'llamacpp', name: 'llama.cpp server', endpoint: 'http://127.0.0.1:8080/v1' },
  { id: 'vllm', name: 'vLLM', endpoint: 'http://127.0.0.1:8000/v1' },
  { id: 'jan', name: 'Jan', endpoint: 'http://127.0.0.1:1337/v1' },
  { id: 'textgen', name: 'text-generation-webui', endpoint: 'http://127.0.0.1:5000/v1' },
  { id: 'koboldcpp', name: 'KoboldCpp', endpoint: 'http://127.0.0.1:5001/v1' },
  { id: 'gpt4all', name: 'GPT4All', endpoint: 'http://127.0.0.1:4891/v1' }
];

// 解析 OpenAI 兼容的 /models 返回（Ollama 原生接口返回 {models:[{name}]} 也一并兼容）
function parseModels(raw: unknown): string[] {
  const j = raw as { data?: Array<{ id?: unknown }>; models?: Array<{ id?: unknown; name?: unknown }> };
  const list: string[] = [];
  if (Array.isArray(j?.data)) {
    j.data.forEach((m) => { if (m && typeof m.id === 'string') list.push(m.id); });
  }
  if (Array.isArray(j?.models)) {
    j.models.forEach((m) => {
      const v = m && (typeof m.id === 'string' ? m.id : (typeof m.name === 'string' ? m.name : ''));
      if (v) list.push(v);
    });
  }
  return Array.from(new Set(list)).slice(0, 12);
}

async function probe(c: Candidate, timeoutMs: number): Promise<DetectedService | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(c.endpoint + '/models', { signal: ctrl.signal });
    if (!res.ok) return null;
    const models = parseModels(await res.json());
    return { id: c.id, name: c.name, endpoint: c.endpoint, models };
  } catch (_) {
    return null; // 没在跑 / 端口没开 / 超时 —— 都属于「没检测到」，不是错误
  } finally {
    clearTimeout(timer);
  }
}

// 并发探测全部候选，返回真正在跑的服务（按候选顺序）
export async function detectLocalServices(timeoutMs = 800): Promise<DetectedService[]> {
  const results = await Promise.all(CANDIDATES.map((c) => probe(c, timeoutMs)));
  return results.filter((r): r is DetectedService => r !== null);
}

export { CANDIDATES as LOCAL_SERVICE_CANDIDATES };
