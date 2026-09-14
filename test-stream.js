'use strict';

// ============================================================
//  流式响应自测：最后一段没有换行的数据不能丢、多字节字符跨分片不能烂
//  动机：以前只解析「带换行的完整行」，也没在结束时 flush TextDecoder。
//  服务端关连接时最后一行常常不带换行 —— 内容会截断，甚至误报「模型未返回内容」。
//  运行：node test-stream.js
// ============================================================
const http = require('http');
const path = require('path');

const { createLlmClient } = require(path.join(__dirname, 'dist/main/llm-client'));

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

  console.log('\n流式响应自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
})();
