'use strict';

// ============================================================
//  LLM 客户端：本地 Ollama / OpenAI 兼容云端，可切换
//
//  立场：
//   - 不内置任何云端密钥——云端模式由用户自带密钥（BYOK），密钥只存本机
//   - 云端走 OpenAI 兼容协议（DeepSeek / Kimi / 通义 / OpenAI 通用）
//   - 无论哪种模型，产出都由本地确定性校验门把关（见 agent.js）
// ============================================================

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:11434',
  model: 'qwen2.5:7b',          // 中文 + JSON 输出表现均衡的小模型
  temperature: 0.3,             // 改写任务要稳不要发散
  timeout: 120000               // 本地模型推理慢，给足 2 分钟
};

const CLOUD_DEFAULTS = {
  endpoint: 'https://api.deepseek.com/v1',  // OpenAI 兼容地址，一般以 /v1 结尾
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.3,
  timeout: 120000
};

// ---------------- 本地 Ollama ----------------
function createOllamaClient(config) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  const base = String(cfg.endpoint || '').replace(/\/+$/, '');

  async function fetchJson(path, body, timeoutMs) {
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
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    config: cfg,
    provider: 'ollama',

    // 探测本地服务与可用模型（短超时，不阻塞 UI）
    async status() {
      try {
        const r = await fetchJson('/api/tags', null, 2500);
        return {
          available: true,
          models: (r.models || []).map((m) => m.name)
        };
      } catch (_) {
        return { available: false, models: [] };
      }
    },

    // 非流式 / 流式对话。
    // opts.onChunk → 流式打字机；opts.tools → 原生 function calling。
    // 返回值：无 tools 时为 string（兼容旧行为）；
    //         有 tools 时为 { content, toolCalls: [{name, args}] }，
    //         两个协议（Ollama/OpenAI）的响应都归一化成这个形状。
    async chat(messages, opts) {
      const o = opts || {};
      const onChunk = typeof o.onChunk === 'function' ? o.onChunk : null;
      const tools = Array.isArray(o.tools) && o.tools.length ? o.tools : null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
      try {
        const body = {
          model: cfg.model,
          messages,
          stream: !!onChunk && !tools, // function-calling 循环不需要流式（要完整 JSON 决策）
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
          const r = await resp.json();
          const msg = (r && r.message) || {};
          const content = msg.content;
          if (tools) {
            const toolCalls = normalizeToolCalls(msg.tool_calls);
            return {
              content: content || '',
              toolCalls,
              rawToolCalls: msg.tool_calls || []
            };
          }
          if (!content) throw new Error('模型未返回内容');
          return content;
        }

        // Ollama 流式返回 NDJSON：每行 {message:{content:"片段"}}
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              const piece = obj && obj.message && obj.message.content;
              if (piece) {
                full += piece;
                onChunk(piece);
              }
            } catch (_) { /* 半行或心跳行，忽略 */ }
          }
        }
        if (!full) throw new Error('模型未返回内容');
        return full;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// 归一化 function-calling 响应：
// Ollama: tool_calls: [{function: {name, arguments: {...}}}]（arguments 已是对象）
// OpenAI: tool_calls: [{id, function: {name, arguments: "{\"a\":1}"}}]（arguments 是 JSON 串）
// 返回 {name, args} 列表；同时 rawToolCalls 保留原始结构（OpenAI 协议要求回填原样）
function normalizeToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc) => {
    const fn = (tc && tc.function) || {};
    let args = fn.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (_) { args = {}; } // eslint-disable-line no-empty
    }
    return { name: fn.name || '', args: args || {}, raw: tc };
  }).filter((c) => c.name);
}

// ---------------- 云端（OpenAI 兼容） ----------------
function httpHint(status) {
  if (status === 401 || status === 403) return 'API 密钥无效或未授权（' + status + '）';
  if (status === 402) return '账户余额不足（402）';
  if (status === 429) return '请求过于频繁或配额不足（429）';
  if (status === 404) return '接口路径不存在（404），请检查 API 地址是否以 /v1 结尾';
  return 'HTTP ' + status;
}

function createOpenAiClient(config) {
  const cfg = Object.assign({}, CLOUD_DEFAULTS, config || {});
  const base = String(cfg.endpoint || '').replace(/\/+$/, '');

  // 单次请求。raw=true 返回原始 Response（由 chat 层按 tools/普通路径解析）；
  // raw=false 时消费 body：流式 → 返回拼接全文；非流式 → 返回 content 字符串
  async function postChat(body, onChunk, raw) {
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
          const j = await resp.json();
          detail = (j.error && j.error.message) || (j.message) || '';
        } catch (_) {} // eslint-disable-line no-empty
        const err = new Error(httpHint(resp.status) + (detail ? '：' + detail : ''));
        err.status = resp.status;
        throw err;
      }

      if (raw) return resp;

      if (!onChunk || !resp.body) {
        const r = await resp.json();
        const content = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
        if (!content) throw new Error('模型未返回内容');
        return content;
      }

      // SSE 流：data: {"choices":[{"delta":{"content":"片段"}}]} … data: [DONE]
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const piece = obj && obj.choices && obj.choices[0] &&
              obj.choices[0].delta && obj.choices[0].delta.content;
            if (piece) {
              full += piece;
              onChunk(piece);
            }
          } catch (_) { /* 不完整分片，忽略 */ }
        }
      }
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
    async status() {
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
        const j = await resp.json();
        const models = (j.data || []).map((m) => m.id).filter(Boolean);
        return { available: true, models };
      } catch (err) {
        return {
          available: false,
          models: [],
          error: (err && err.name === 'AbortError')
            ? '连接云端超时，请检查网络或地址'
            : '无法连接云端服务：' + ((err && err.message) || '未知错误')
        };
      } finally {
        clearTimeout(timer);
      }
    },

    // 对话：默认带 response_format:json_object 约束 JSON；
    // opts.tools → 原生 function calling（不走流式，决策需要完整 JSON）；
    // 服务商不支持 response_format（400/422）时自动降级重试一次。
    // 返回值与 Ollama 客户端对齐：有 tools → {content, toolCalls}；否则 string。
    async chat(messages, opts) {
      const o = opts || {};
      const onChunk = typeof o.onChunk === 'function' && !o.tools ? o.onChunk : null;
      const tools = Array.isArray(o.tools) && o.tools.length ? o.tools : null;
      const body = {
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

      async function extract(res) {
        if (tools) {
          const r = await res.json();
          const msg = (r.choices && r.choices[0] && r.choices[0].message) || {};
          const toolCalls = normalizeToolCalls(msg.tool_calls);
          return {
            content: msg.content || '',
            toolCalls,
            rawToolCalls: msg.tool_calls || []
          };
        }
        const r = await res.json();
        const content = r && r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
        if (!content) throw new Error('模型未返回内容');
        return content;
      }

      try {
        if (onChunk) return await postChat(body, onChunk); // 流式路径直接拿全文
        const res = await postChat(body, null, true);
        return await extract(res);
      } catch (err) {
        if ((err.status === 400 || err.status === 422) && body.response_format) {
          const retry = Object.assign({}, body);
          delete retry.response_format;
          if (onChunk) return await postChat(retry, onChunk);
          const res = await postChat(retry, null, true);
          return await extract(res);
        }
        throw err;
      }
    }
  };
}

// ---------------- 分发器：按 provider 选择客户端 ----------------
// config.provider === 'cloud' → OpenAI 兼容云端；否则（含缺省/旧配置）→ 本地 Ollama
function createLlmClient(config) {
  const provider = (config && config.provider) === 'cloud' ? 'cloud' : 'ollama';
  return provider === 'cloud' ? createOpenAiClient(config) : createOllamaClient(config);
}

module.exports = {
  createOllamaClient,
  createOpenAiClient,
  createLlmClient,
  normalizeToolCalls,
  DEFAULTS,
  CLOUD_DEFAULTS
};
