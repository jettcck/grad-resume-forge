'use strict';

// ============================================================
//  流式响应自测：最后一段没有换行的数据不能丢、多字节字符跨分片不能烂
//  动机：以前只解析「带换行的完整行」，也没在结束时 flush TextDecoder。
//  服务端关连接时最后一行常常不带换行 —— 内容会截断，甚至误报「模型未返回内容」。
//  运行：node test-stream.js
// ============================================================
const http = require('http');
const path = require('path');

const { createLlmClient } = require(path.join(__dirname, 'packages/llm-adapters/dist/index'));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

// 起一个假服务：按脚本把分片原样写回，可控制结尾有无换行
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const json = (res, obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

(async () => {
  // ---------- 1) Ollama NDJSON：最后一行没有换行 ----------
  {
    const srv = await startServer((req, res) => {
      if (req.url === '/api/tags') return json(res, { models: [{ name: 'qwen2.5:7b' }] });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      // 三条完整行 + 一条没有结尾换行的行（真实服务端常见的收尾方式）
      res.write('{"message":{"content":"第一段"}}\n');
      res.write('{"message":{"content":"第二段"}}\n');
      res.write('{"message":{"content":"最后一段"},"done":true}');
      res.end();
    });
    const port = srv.address().port;
    const client = createLlmClient({ provider: 'ollama', endpoint: 'http://127.0.0.1:' + port, model: 'qwen2.5:7b' });
    try {
      const chunks = [];
      const out = await client.chat([{ role: 'user', content: 'x' }], { onChunk: (p) => chunks.push(p) });
      assert(out === '第一段第二段最后一段', '无尾换行的最后一段没有丢（实际「' + out + '」）');
      assert(chunks.length === 3, '流式回调收到全部 3 段（实际 ' + chunks.length + '）');
    } catch (e) {
      assert(false, 'Ollama 无尾换行不该报错：' + e.message);
    }
    await new Promise((r) => srv.close(r));
  }

  // ---------- 2) Ollama：多字节字符跨分片（decoder 必须 flush） ----------
  {
    const srv = await startServer((req, res) => {
      if (req.url === '/api/tags') return json(res, { models: [] });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      // 「优化」的 UTF-8 是三字节，这里刻意在字节中间切开
      const line = Buffer.from('{"message":{"content":"优化"}}\n', 'utf8');
      res.write(line.slice(0, line.length - 5));
      setTimeout(() => { res.write(line.slice(line.length - 5)); res.end(); }, 20);
    });
    const port = srv.address().port;
    const client = createLlmClient({ provider: 'ollama', endpoint: 'http://127.0.0.1:' + port, model: 'qwen2.5:7b' });
    try {
      const out = await client.chat([{ role: 'user', content: 'x' }], { onChunk: () => {} });
      assert(out === '优化', '多字节字符跨分片不乱码、不丢字（实际「' + out + '」）');
    } catch (e) {
      assert(false, '跨分片多字节不该报错：' + e.message);
    }
    await new Promise((r) => srv.close(r));
  }

  // ---------- 3) OpenAI SSE：最后一段 data: 行没有换行 ----------
  {
    const srv = await startServer((req, res) => {
      if (req.url === '/models') return json(res, { data: [{ id: 'deepseek-chat' }] });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"前半"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"结尾"}}]}'); // 无换行收尾
      res.end();
    });
    const port = srv.address().port;
    const client = createLlmClient({ provider: 'cloud', endpoint: 'http://127.0.0.1:' + port, model: 'deepseek-chat', apiKey: 'k' });
    try {
      const out = await client.chat([{ role: 'user', content: 'x' }], { onChunk: () => {} });
      assert(out === '前半结尾', 'SSE 无尾换行的最后一段没有丢（实际「' + out + '」）');
    } catch (e) {
      assert(false, 'SSE 无尾换行不该报错：' + e.message);
    }
    await new Promise((r) => srv.close(r));
  }

  // ---------- 4) 非流式路径不受影响（回归） ----------
  {
    const srv = await startServer((req, res) => {
      if (req.url === '/api/tags') return json(res, { models: [] });
      json(res, { message: { content: '非流式完整返回' } });
    });
    const port = srv.address().port;
    const client = createLlmClient({ provider: 'ollama', endpoint: 'http://127.0.0.1:' + port, model: 'qwen2.5:7b' });
    const out = await client.chat([{ role: 'user', content: 'x' }]);
    assert(out === '非流式完整返回', '非流式返回正常（回归）');
    await new Promise((r) => srv.close(r));
  }

  // ---------- 5) 真空响应仍然如实报错（不假装成功） ----------
  {
    const srv = await startServer((req, res) => {
      if (req.url === '/api/tags') return json(res, { models: [] });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end();
    });
    const port = srv.address().port;
    const client = createLlmClient({ provider: 'ollama', endpoint: 'http://127.0.0.1:' + port, model: 'qwen2.5:7b' });
    let err = null;
    try { await client.chat([{ role: 'user', content: 'x' }], { onChunk: () => {} }); } catch (e) { err = e; }
    assert(!!err && /未返回内容/.test(err.message), '空响应如实报「模型未返回内容」');
    await new Promise((r) => srv.close(r));
  }

  // 外部取消必须到达实际 HTTP 请求，不能等客户端自身的超时。
  {
    let requests = 0;
    const srv = await startServer((_req, res) => { requests++; json(res, { message: { content: '{}' } }); });
    const client = createLlmClient({ endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', timeout: 10000 });
    const ctl = new AbortController(); ctl.abort();
    const started = Date.now(); let error;
    try { await client.chat([{ role: 'user', content: 'x' }], { signal: ctl.signal }); } catch (e) { error = e; }
    assert(error && error.name === 'AbortError' && Date.now() - started < 1000, 'Ollama 预取消立即返回 AbortError');
    assert(requests === 0, 'Ollama 预取消不发送 HTTP 请求');
    await new Promise((r) => srv.close(r));
  }
  {
    let entered, closed;
    const requestStarted = new Promise((r) => { entered = r; });
    const requestClosed = new Promise((r) => { closed = r; });
    const srv = await startServer((_req, res) => { res.on('close', () => closed(!res.writableEnded)); entered(); });
    const client = createLlmClient({ endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', timeout: 10000 });
    const ctl = new AbortController();
    const waiting = client.chat([{ role: 'user', content: 'x' }], { signal: ctl.signal }).catch((e) => e);
    await requestStarted; const started = Date.now(); ctl.abort();
    const error = await waiting;
    assert(error.name === 'AbortError' && Date.now() - started < 1000, 'Ollama 等待期间取消立即结束客户端请求');
    const disconnected = await Promise.race([requestClosed, new Promise((r) => setTimeout(() => r(false), 1000))]);
    assert(disconnected, 'Ollama 取消确实关闭服务端连接，停止占用推理请求');
    await new Promise((r) => srv.close(r));
  }
  // 普通改写也保留服务端 token 用量，评测无需把缺失值猜成 0。
  for (const provider of ['ollama', 'cloud']) {
    const srv = await startServer((_req, res) => json(res, provider === 'ollama'
      ? { message: { content: '{}' }, prompt_eval_count: 12, eval_count: 3 }
      : { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }));
    const client = createLlmClient({ provider, endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', apiKey: 'test' });
    let usage;
    await client.chat([{ role: 'user', content: 'x' }], { onUsage: (u) => { usage = u; } });
    assert(usage && usage.prompt_tokens === 12 && usage.completion_tokens === 3 && usage.total_tokens === 15, provider + '：普通改写回传实际 token 用量');
    await new Promise((r) => srv.close(r));
  }

  // 流式尾帧可能只有用量、没有正文；累计上报由调用方按当前请求覆盖。
  for (const provider of ['ollama', 'cloud']) {
    let requestBody;
    const srv = await startServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requestBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream' });
        const frame = obj => provider === 'ollama' ? JSON.stringify(obj) : 'data: ' + JSON.stringify(obj);
        res.write(frame(provider === 'ollama' ? { message: { content: '完整' } } : { choices: [{ delta: { content: '完整' } }] }) + '\n');
        res.end(frame(provider === 'ollama' ? { done: true, prompt_eval_count: 12, eval_count: 3 }
          : { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }));
      });
    });
    try {
      const client = createLlmClient({ provider, endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', apiKey: 'test' });
      const reported = [];
      const text = await client.chat([{ role: 'user', content: 'x' }], { onChunk: () => {}, onUsage: u => reported.push(u) });
      assert(text === '完整' && reported.length === 1 && reported[0].total_tokens === 15, provider + '：无换行的纯用量尾帧回传实际 token');
      assert(provider === 'ollama' ? requestBody.stream === true : requestBody.stream_options.include_usage === true, provider + '：流式请求启用用量报告');
    } finally { await new Promise(r => srv.close(r)); }
  }

  {
    let requests = 0;
    const srv = await startServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests++;
        if (JSON.parse(body).stream_options) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'stream_options unsupported' } }));
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"兼容回复"}}],"usage":{"total_tokens":9}}');
      });
    });
    try {
      const client = createLlmClient({ provider: 'cloud', endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', apiKey: 'test' });
      let usage;
      const text = await client.chat([{ role: 'user', content: 'x' }], { onChunk: () => {}, onUsage: u => { usage = u; } });
      assert(requests === 2 && text === '兼容回复' && usage.total_tokens === 9, '服务拒绝 stream_options 时去掉可选参数重试，保留用量回调');
    } finally { await new Promise(r => srv.close(r)); }
  }

  // 非流式收到响应头后仍要覆盖正文读取：分别验证普通回复与工具调用。
  for (const tools of [undefined, [{ type: 'function', function: { name: 'noop', parameters: {} } }]]) {
    for (const cancel of [true, false]) {
      let entered, closed;
      const headersSent = new Promise(resolve => { entered = resolve; });
      const connectionClosed = new Promise(resolve => { closed = resolve; });
      const srv = await startServer((_req, res) => {
        res.on('close', () => closed(!res.writableEnded));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"choices":['); entered();
      });
      try {
        const client = createLlmClient({ provider: 'cloud', endpoint: 'http://127.0.0.1:' + srv.address().port, model: 'test', apiKey: 'test', timeout: cancel ? 5000 : 150 });
        const controller = new AbortController();
        const waiting = client.chat([{ role: 'user', content: 'x' }], { tools, signal: controller.signal }).catch(error => error);
        await headersSent;
        const started = Date.now();
        if (cancel) controller.abort();
        const result = await Promise.race([waiting, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
        const label = (tools ? '工具调用' : '普通回复') + (cancel ? '主动取消' : '客户端期限');
        assert(result?.name === 'AbortError' && Date.now() - started < 1000, label + '在响应头之后仍中断正文读取');
        assert(await Promise.race([connectionClosed, new Promise(resolve => setTimeout(() => resolve(false), 1000))]), label + '关闭服务端连接');
        srv.closeAllConnections(); await waiting;
      } finally { srv.closeAllConnections(); await new Promise(resolve => srv.close(resolve)); }
    }
  }

  console.log('\n流式响应自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})();
