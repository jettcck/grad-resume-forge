'use strict';

// ============================================================
//  LLM 客户端：本地 Ollama / OpenAI 兼容云端，可切换（TypeScript 版）
//
//  立场：
//   - 不内置任何云端密钥——云端模式由用户自带密钥（BYOK），密钥只存本机
//   - 云端走 OpenAI 兼容协议（DeepSeek / Kimi / 通义 / OpenAI 通用）
//   - 无论哪种模型，产出都由本地确定性校验门把关（见 agent.ts）
// ============================================================

import type { LlmClient, LlmConfig, LlmStatus, ChatMessage, ChatOptions, ToolCallReply, NormalizedToolCall, RawToolCall, LlmUsage } from './types';

// 类型对外再导出：应用侧（src/main/types.ts）从这里统一取，保证实现与类型是同一份定义
export type { ChatMessage, RawToolCall, NormalizedToolCall, ToolCallReply, LlmClient, LlmConfig, LlmStatus, ChatOptions, LlmUsage } from './types';

export const DEFAULTS: LlmConfig = {
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',          // 中文 + JSON 输出表现均衡的小模型
  temperature: 0.3,             // 改写任务要稳不要发散
  timeout: 120000               // 本地模型推理慢，给足 2 分钟
};

export const CLOUD_DEFAULTS: LlmConfig = {
  endpoint: 'https://api.deepseek.com/v1',  // OpenAI 兼容地址，一般以 /v1 结尾
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.3,
  timeout: 120000
};

// ---------------- 本地 Ollama ----------------
/** 把各家的 usage 形状归一到 { prompt_tokens, completion_tokens, total_tokens } */
function normalizeUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_eval_count?: number; eval_count?: number };
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : (typeof u.prompt_eval_count === 'number' ? u.prompt_eval_count : undefined);
  const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : (typeof u.eval_count === 'number' ? u.eval_count : undefined);
  const total = typeof u.total_tokens === 'number'
    ? u.total_tokens
    : (prompt != null || completion != null ? (prompt || 0) + (completion || 0) : undefined);
  if (prompt == null && completion == null && total == null) return undefined;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

export function createOllamaClient(config: Partial<LlmConfig> | undefined): LlmClient {
  const cfg = Object.assign({}, DEFAULTS, config || {}) as Required<Pick<LlmConfig, 'endpoint' | 'model' | 'temperature' | 'timeout'>> & LlmConfig;
  const base = String(cfg.endpoint || '').replace(/\/+$/, '');

  async function fetchJson<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || cfg.timeout);
    try {
      const resp = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    config: cfg,
    provider: 'ollama',

    // 探测本地服务与可用模型（短超时，不阻塞 UI）
    async status(): Promise<LlmStatus> {
      try {
        const r = await fetchJson<{ models?: Array<{ name: string }> }>('/api/tags', null, 2500);
        return { available: true, models: (r.models || []).map((m) => m.name) };
      } catch (_) {
        return { available: false, models: [] };
      }
    },

    // 非流式 / 流式对话。opts.tools → 原生 function calling。
    async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string | ToolCallReply> {
      const o = opts || {};
      const onChunk = typeof o.onChunk === 'function' ? o.onChunk : null;
      const tools = Array.isArray(o.tools) && o.tools.length ? o.tools : null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
      try {
        const body: Record<string, unknown> = {
          model: cfg.model,
          messages,
          stream: !!onChunk && !tools,
          options: { temperature: cfg.temperature }
        };
        if (tools) body.tools = tools;
        else body.format = 'json';

        const resp = await fetch(base + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        if (!onChunk || !resp.body) {
          const r = await resp.json() as { message?: { content?: string; tool_calls?: RawToolCall[] }; prompt_eval_count?: number; eval_count?: number };
          const msg = r.message || {};
          const content = msg.content;
          if (tools) {
            const toolCalls = normalizeToolCalls(msg.tool_calls);
            // Ollama 的用量字段是 prompt_eval_count / eval_count
            return { content: content || '', toolCalls, rawToolCalls: msg.tool_calls || [], usage: normalizeUsage(r) };
          }
          if (!content) throw new Error('模型未返回内容');
          return content;
        }

        // Ollama 流式返回 NDJSON：每行 {message:{content:"片段"}}
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let full = '';
        const takeLine = (line: string): void => {
          if (!line) return;
          try {
            const obj = JSON.parse(line) as { message?: { content?: string } };
            const piece = obj && obj.message && obj.message.content;
            if (piece) {
              full += piece;
              onChunk(piece);
            }
          } catch (_) { /* 半行或心跳行，忽略 */ }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            takeLine(buf.slice(0, nl).trim());
            buf = buf.slice(nl + 1);
          }
        }
        takeTail(decoder, buf, takeLine); // 最后一段没有换行的数据也要算
        if (!full) throw new Error('模型未返回内容');
        return full;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// 流式收尾：flush 解码器 + 处理最后一段没有换行的数据。
// 服务端关闭连接时最后一行常常不带换行；只解析「完整行」会把这段丢掉，
// 表现为内容被截断、甚至误报「模型未返回内容」。
function takeTail(decoder: { decode: () => string }, buf: string, onLine: (line: string) => void): void {
  let rest = buf;
  try { rest += decoder.decode(); } catch (_) { /* 忽略解码尾部异常 */ }
  const tail = rest.trim();
  if (tail) onLine(tail);
}

// ---------------- 云端（OpenAI 兼容） ----------------
function httpHint(status: number): string {
  if (status === 401 || status === 403) return 'API 密钥无效或未授权（' + status + '）';
  if (status === 402) return '账户余额不足（402）';
  if (status === 429) return '请求过于频繁或配额不足（429）';
  if (status === 404) return '接口路径不存在（404），请检查 API 地址是否以 /v1 结尾';
  return 'HTTP ' + status;
}

export function createOpenAiClient(config: Partial<LlmConfig> | undefined): LlmClient {
  const cfg = Object.assign({}, CLOUD_DEFAULTS, config || {}) as Required<Pick<LlmConfig, 'endpoint' | 'model' | 'apiKey' | 'temperature' | 'timeout'>> & LlmConfig;
  const base = String(cfg.endpoint || '').replace(/\/+$/, '');

  // 单次请求。raw=true 返回原始 Response；false 时消费 body 返回拼接全文
  async function postChat(body: Record<string, unknown>, onChunk: ((p: string) => void) | null, raw?: boolean): Promise<Response | string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
    try {
      const resp = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (cfg.apiKey || '')
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });

      if (!resp.ok) {
        let detail = '';
        try {
          const j = await resp.json() as { error?: { message?: string }; message?: string };
          detail = (j.error && j.error.message) || j.message || '';
        } catch (_) { /* 忽略 */ }
        const err = new Error(httpHint(resp.status) + (detail ? '：' + detail : ''));
        (err as Error & { status?: number }).status = resp.status;
        throw err;
      }

      if (raw) return resp;

      if (!onChunk || !resp.body) {
        const r = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = r.choices?.[0]?.message?.content;
        if (!content) throw new Error('模型未返回内容');
        return content;
      }

      // SSE 流：data: {"choices":[{"delta":{"content":"片段"}}]} … data: [DONE]
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      const takeLine = (line: string): void => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
          const obj = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const piece = obj.choices?.[0]?.delta?.content;
          if (piece) {
            full += piece;
            onChunk(piece);
          }
        } catch (_) { /* 不完整分片，忽略 */ }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          takeLine(buf.slice(0, nl).trim());
          buf = buf.slice(nl + 1);
        }
      }
      takeTail(decoder, buf, takeLine); // 最后一段没有换行的 data: 行同样不能丢
      if (!full) throw new Error('模型未返回内容');
      return full;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    config: cfg,
    provider: 'cloud',

    // 探测：无密钥直接不可用；有密钥则 GET /models 校验有效性（短超时）
    async status(): Promise<LlmStatus> {
      if (!cfg.apiKey) {
        return { available: false, models: [], error: '未配置 API 密钥' };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const resp = await fetch(base + '/models', {
          headers: { Authorization: 'Bearer ' + cfg.apiKey },
          signal: ctrl.signal
        });
        if (!resp.ok) {
          return { available: false, models: [], error: httpHint(resp.status) };
        }
        const j = await resp.json() as { data?: Array<{ id?: string }> };
        const models = (j.data || []).map((m) => m.id).filter((x): x is string => !!x);
        return { available: true, models };
      } catch (err) {
        const e = err as Error & { name?: string };
        return {
          available: false,
          models: [],
          error: e.name === 'AbortError'
            ? '连接云端超时，请检查网络或地址'
            : '无法连接云端服务：' + (e.message || '未知错误')
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string | ToolCallReply> {
      const o = opts || {};
      const onChunk = typeof o.onChunk === 'function' && !o.tools ? o.onChunk : null;
      const tools = Array.isArray(o.tools) && o.tools.length ? o.tools : null;
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        stream: !!onChunk
      };
      if (tools) {
        body.tools = tools;
        body.tool_choice = 'auto';
      } else if (cfg.jsonMode !== false) {
        body.response_format = { type: 'json_object' };
      }

      async function extract(res: Response): Promise<string | ToolCallReply> {
        if (tools) {
          const r = await res.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: RawToolCall[] } }>; usage?: unknown };
          const msg = r.choices?.[0]?.message || {};
          const toolCalls = normalizeToolCalls(msg.tool_calls);
          // usage 以前被直接丢掉，导致 Agent 的 token 预算永远读到 0
          return { content: msg.content || '', toolCalls, rawToolCalls: msg.tool_calls || [], usage: normalizeUsage(r.usage) };
        }
        const r = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = r.choices?.[0]?.message?.content;
        if (!content) throw new Error('模型未返回内容');
        return content;
      }

      try {
        if (onChunk) return await postChat(body, onChunk) as string; // 流式路径直接拿全文
        const res = await postChat(body, null, true) as Response;
        return await extract(res);
      } catch (err) {
        const e = err as Error & { status?: number };
        if ((e.status === 400 || e.status === 422) && body.response_format) {
          const retry = Object.assign({}, body);
          delete retry.response_format;
          if (onChunk) return await postChat(retry, onChunk) as string;
          const res = await postChat(retry, null, true) as Response;
          return await extract(res);
        }
        throw err;
      }
    }
  };
}

// 归一化 function-calling 响应：
// Ollama: tool_calls: [{function: {name, arguments: {...}}}]（arguments 已是对象）
// OpenAI: tool_calls: [{id, function: {name, arguments: "{\"a\":1}"}}]（arguments 是 JSON 串）
export function normalizeToolCalls(raw: RawToolCall[] | undefined): NormalizedToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc) => {
    const fn = (tc && tc.function) || { name: '', arguments: {} };
    let args: Record<string, unknown> = fn.arguments as Record<string, unknown>;
    if (typeof args === 'string') {
      try { args = JSON.parse(args) as Record<string, unknown>; } catch (_) { args = {}; }
    }
    return { name: fn.name || '', args: args || {}, raw: tc };
  }).filter((c) => c.name);
}

// ---------------- 分发器：按 provider 选择客户端 ----------------
export function createLlmClient(config: Partial<LlmConfig> | undefined): LlmClient {
  const provider = (config && config.provider) === 'cloud' ? 'cloud' : 'ollama';
  return provider === 'cloud' ? createOpenAiClient(config) : createOllamaClient(config);
}
