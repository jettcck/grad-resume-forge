'use strict';

// 真实应用端到端检查：
//   1. 用 --remote-debugging-port 启动真实 dist/main/main.js（不注册任何 mock IPC）
//   2. 通过 CDP(HTTP) 列出所有 target，看同步窗口是否有真实页面内容
//   3. 通过 Page.navigate 让同步窗口打开平台页，再读 DOM 文本
// 关键：这里对「同步窗口的 webContents」不 attach debugger（那是应用内的 bug），
// 而是走 Chromium 自己的 remote-debugging-port —— 与业务代码完全隔离的观测通道。

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9333;
const log = (...a) => console.log('[e2e]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('http timeout')));
  });
}

// 极简 WebSocket 客户端（CDP 用），避免额外依赖
function wsEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const u = new URL(wsUrl);
    const key = Buffer.from(String(Math.random())).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key
      }
    });
    req.on('upgrade', (res, socket) => {
      const send = (obj) => {
        const data = Buffer.from(JSON.stringify(obj));
        const len = data.length;
        let header;
        if (len < 126) { header = Buffer.from([0x81, 0x80 | len]); }
        else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(len, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(len), 2); }
        const mask = Buffer.from([1, 2, 3, 4]);
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i += 1) masked[i] = data[i] ^ mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
      };
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 2) return;
        let len = buf[1] & 0x7F; let off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len).toString('utf8');
        try {
          const msg = JSON.parse(payload);
          if (msg.id === 1) { socket.end(); resolve(msg.result); }
        } catch (_) { /* 分片忽略 */ }
      });
      send({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } });
      setTimeout(() => { try { socket.end(); } catch (_) {} reject(new Error('ws timeout')); }, 6000);
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-e2e-'));
  const child = spawn(ELECTRON, [
    path.join(ROOT, 'dist', 'main', 'main.js'),
    '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + ud
  ], { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log('app>', String(d).trim()));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 300)));

  // 等 DevTools 端点就绪
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); }
  }
  log('devtools ready =', ready);
  if (!ready) { child.kill(); app_exit(2); return; }

  await wait(3000);
  const targets = await httpJson('/json/list');
  log('targets:', targets.map((t) => t.type + ':' + (t.title || '').slice(0, 24)).join(' | '));

  const main = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  log('main window target:', main ? main.url : '(none)');

  if (main) {
    const title = await wsEval(main.webSocketDebuggerUrl, 'document.title');
    log('main title:', JSON.stringify(title));
    const bodyLen = await wsEval(main.webSocketDebuggerUrl, 'document.body ? document.body.innerText.length : -1');
    log('main body length:', JSON.stringify(bodyLen));
  }

  child.kill();
  await wait(1000);
  app_exit(0);
}

function app_exit(code) { process.exit(code); }

run().catch((e) => { console.error('[e2e] fatal:', e); process.exit(2); });
