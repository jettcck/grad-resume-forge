'use strict';

// ============================================================
//  同步窗口端到端冒烟
//
//  为什么这样写：
//   在本机（Electron 38 / 该 Windows 环境）里，从主进程对「已经显示出来的」
//   webContents 调 executeJavaScript / capturePage 会永远不 resolve，
//   这是环境行为而不是业务代码问题 —— 所以不能用它来判定窗口是否白屏。
//   改用 Chromium 自带的 remote-debugging-port 作为「进程外观测通道」：
//   它和业务代码完全隔离，能真实读回页面 DOM。
//
//  用法：
//    <node> <electron> scripts/smoke-jobsync-window.js --no-sandbox --disable-gpu
//  两轮：normal（本地首页）与 hang（服务端永不响应），断言窗口都有可读内容。
// ============================================================

const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[smoke-jobsync]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 9355;

// ---- CDP over raw WebSocket（不引入依赖） ----
function cdpCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + (u.search || ''),
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key }
    });
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; fn(arg); } };
    req.on('upgrade', (res, socket) => {
      const frame = (obj) => {
        const data = Buffer.from(JSON.stringify(obj));
        const len = data.length;
        let header;
        if (len < 126) header = Buffer.from([0x81, (0x80 | len) & 0xFF]);
        else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0xFE; header.writeUInt16BE(len, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0xFF; header.writeBigUInt64BE(BigInt(len), 2); }
        const mask = Buffer.from([11, 22, 33, 44]);
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i += 1) masked[i] = data[i] ^ mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
      };
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          let len = buf[1] & 0x7F; let off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) break;
          const payload = buf.slice(off, off + len).toString('utf8');
          buf = buf.slice(off + len);
          try {
            const msg = JSON.parse(payload);
            if (msg.id === 1) { try { socket.end(); } catch (_) {} finish(resolve, msg); }
          } catch (_) { /* ignore */ }
        }
      });
      socket.on('error', () => finish(reject, new Error('socket error')));
      frame({ id: 1, method, params: params || {} });
      setTimeout(() => { try { socket.end(); } catch (_) {} finish(reject, new Error('ws timeout')); }, 8000);
    });
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

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

// 看看同步窗口（非主界面 target）当前渲染了什么
async function inspectSyncWindow(label) {
  let targets = [];
  for (let i = 0; i < 10; i += 1) {
    try { targets = (await httpJson('/json/list')).filter((t) => t.type === 'page'); break; }
    catch (_) { await wait(400); }
  }
  const candidates = targets.filter((t) => !/index\.html/.test(t.url || ''));
  const sync = candidates[candidates.length - 1]; // 取最新打开的那个同步窗口
  if (!sync) { log(label, '=> 没有找到同步窗口 target'); return null; }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const r = await cdpCall(sync.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'JSON.stringify({url:location.href,title:document.title,ready:document.readyState,text:(document.body?document.body.innerText:"<nobody>").replace(/\\s+/g," ").slice(0,200)})',
        returnByValue: true
      });
      const v = r && r.result && r.result.result && r.result.result.value;
      const info = JSON.parse(v);
      log(label, '=>', JSON.stringify(info));
      return info;
    } catch (e) { if (attempt === 2) { log(label, '读取失败:', e.message); return null; } await wait(600); }
  }
  return null;
}

// ---- 本地 HTTP 服务：normal 正常返回首页；hang 永不响应 ----
let mode = 'normal';
const server = http.createServer((req, res) => {
  if (mode === 'hang') return;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>本地模拟平台</title>'
    + '<h1>本地模拟平台首页</h1><p>如果你能看到这行字，说明平台视图已经正常显示。</p>');
});

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'grf-smoke-sync-')));
// 观测通道必须在 app ready 之前开好（Chromium 启动参数只在初始化阶段生效）
app.commandLine.appendSwitch('remote-debugging-port', String(PORT));

const realCore = require(path.join(ROOT, 'dist/main/job-sync-core'));
const syncPath = path.join(ROOT, 'dist/main/job-sync.js');
const Module = require('module');
const originalLoad = Module._load;
const patchedCore = {
  ...realCore,
  SYNC_PLATFORMS: realCore.SYNC_PLATFORMS.slice(0, 2).map((p, i) => ({
    ...p, id: i === 0 ? 'localprobe' : 'localprobe2', name: '本地探针平台' + (i + 1),
    syncable: true, recordHint: '本地探针'
  })),
  findPlatform: (id) => patchedCore.SYNC_PLATFORMS.find((p) => p.id === id) || null
};

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  patchedCore.SYNC_PLATFORMS[0].entryUrl = 'http://127.0.0.1:' + port + '/';
  log('local platform url:', patchedCore.SYNC_PLATFORMS[0].entryUrl);

  Module._load = function (request, parent) {
    if ((request === './job-sync-core' || request === './job-sync-core.js')
      && parent && /dist[\\/]main[\\/]job-sync\.js$/.test(parent.filename)) {
      return patchedCore;
    }
    return originalLoad.apply(this, arguments);
  };
  const sync = require(syncPath);
  Module._load = originalLoad;

  // 观测端口就绪
  let ready = false;
  for (let i = 0; i < 40; i += 1) { try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(300); } }
  log('observability port ready =', ready);

  // ---- case 1: 正常首页 ----
  log('--- case 1: 正常平台首页 ---');
  mode = 'normal';
  const openRes = await Promise.race([
    sync.open('localprobe'),
    wait(25000).then(() => ({ timeout: true }))
  ]);
  log('open() =>', JSON.stringify(openRes));
  if (openRes && openRes.timeout) { log('FAIL: open() 挂起（白屏根因复发）'); server.close(); app.exit(1); return; }

  let info = null;
  for (let i = 0; i < 8 && !(info && /本地模拟平台首页/.test(info.text || '')); i += 1) {
    await wait(700);
    info = await inspectSyncWindow('case1');
  }
  const okNormal = !!(info && /本地模拟平台首页/.test(info.text || ''));
  log(okNormal ? 'PASS: 正常平台视图已显示真实内容' : 'FAIL: 正常平台页面没有显示出来');

  // 收掉 case1 的会话，避免 case2 采样时读到上一个窗口
  try { sync.close('localprobe'); } catch (_) { /* ignore */ }
  await wait(1500);

  // ---- case 2: 平台永不响应 —— 必须是诊断页，不能纯白 ----
  log('--- case 2: 平台永远不响应 ---');
  mode = 'hang';

  const openRes2 = await Promise.race([
    sync.open('localprobe2').then((r) => ({ r })).catch((e) => ({ e: String(e && e.message || e) })),
    wait(20000).then(() => ({ timeout: true }))
  ]);
  log('open() =>', JSON.stringify(openRes2));
  if (openRes2 && openRes2.timeout) {
    log('FAIL: hang 场景下 open() 挂起不返回（白屏根因复发）');
    server.close(); app.exit(1); return;
  }

  const timeline = [];
  let info2 = null;
  for (let i = 0; i < 16; i += 1) {
    await wait(1500);
    info2 = await inspectSyncWindow('case2[' + (i + 1) + ']');
    if (info2) timeline.push((info2.title || '') + ' | ' + (info2.text || '').slice(0, 70));
    if (info2 && info2.text && info2.text.replace(/\s+/g, '').length > 10) break;
  }
  log('case2 timeline:', JSON.stringify(timeline, null, 0));
  // hang 场景的判定：拿到窗口内容即可（诊断页文字 > 10 字），且【不是】case1 的本地首页
  const hangText = (info2 && info2.text) || '';
  const okHang = hangText.replace(/\s+/g, '').length > 10 && !/本地模拟平台首页/.test(hangText);
  log(okHang ? 'PASS: 挂起场景下窗口显示诊断页而非纯白' : 'FAIL: 挂起场景下窗口是空的/纯白，或仍显示上一条会话的页面');

  server.close();
  log('RESULT:', JSON.stringify({ normal: okNormal, hang: okHang }));
  app.exit(okNormal && okHang ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[smoke-jobsync] fatal:', err);
  app.exit(2);
});
