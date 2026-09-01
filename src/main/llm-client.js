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

    // 非流式 / 流式对话；format:'json' 让 Ollama 约束输出为 JSON。
    // opts.onChunk存在时走流式：每个分片回调一次（打字机效果），返回全文。
    async chat(messages, opts) {
      const onChunk = opts && typeof opts.onChunk === 'function' ? opts.onChunk : null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
      try {
        const resp = await fetch(base + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            stream: !!onChunk,
            format: 'json',
            options: { temperature: cfg.temperature }
          }),
          signal: ctrl.signal
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        if (!onChunk || !resp.body) {
          const r = await resp.json();
          const content = r && r.message && r.message.content;
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

  // 单次请求（流式或非流式）；失败抛带 status 的错误
  async function postChat(body, onChunk) {
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
    // 服务商不支持（400/422）时自动降级重试一次（prompt 纪律 + 松散解析兜底）
    async chat(messages, opts) {
      const onChunk = opts && typeof opts.onChunk === 'function' ? opts.onChunk : null;
      const body = {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        stream: !!onChunk
      };
      if (cfg.jsonMode !== false) body.response_format = { type: 'json_object' };

      try {
        return await postChat(body, onChunk);
      } catch (err) {
        if ((err.status === 400 || err.status === 422) && body.response_format) {
          const retry = Object.assign({}, body);
          delete retry.response_format;
          return await postChat(retry, onChunk);
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
  DEFAULTS,
  CLOUD_DEFAULTS
};
