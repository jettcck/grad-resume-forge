'use strict';

// 真实应用 → 点「打开同步窗口」→ 用 CDP 观察同步窗口是否真的渲染出内容。
// 观测通道用 --remote-debugging-port（Chromium 自带），不碰应用内的 debugger 模块。

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9334;
const log = (...a) => console.log('[e2e2]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(pathname, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 3000, () => req.destroy(new Error('http timeout')));
  });
}

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
        const mask = Buffer.from([9, 8, 7, 6]);
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
            if (msg.id === 1) { try { socket.end(); } catch (_) {} finish(resolve, { ok: true, msg }); }
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

async function evalOn(wsUrl, expr) {
  const r = await cdpCall(wsUrl, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r && r.ok ? r.msg.result : null;
}

async function run() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-e2e2-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, [
    path.join(ROOT, 'dist', 'main', 'main.js'),
    '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT, '--user-data-dir=' + ud
  ], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log('app>', String(d).trim().slice(0, 200)));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 200)));

  let ready = false;
  for (let i = 0; i < 60; i += 1) { try { await httpJson('/json/version', 1500); ready = true; break; } catch (_) { await wait(500); } }
  log('devtools ready =', ready);
  if (!ready) { child.kill(); process.exit(2); }

  await wait(4000);
  let targets = await httpJson('/json/list', 4000);
  const pages = targets.filter((t) => t.type === 'page');
  log('pages:', pages.map((t) => (t.url || '').slice(0, 60)).join('  ||  '));

  const mainTarget = pages.find((t) => /index\.html/.test(t.url || ''));
  if (!mainTarget) { log('no main target'); child.kill(); process.exit(3); }

  // 先注册一个会话用户（jobsync IPC 需要有效会话），再打开同步窗口。
  const reg = await evalOn(mainTarget.webSocketDebuggerUrl,
    '(async()=>{try{const r=await window.api.auth.register({email:"e2e@local.test",password:"e2e-pass-1",name:"E2E"});return JSON.stringify(r).slice(0,300);}catch(e){return "ERR:"+e.message;}})()');
  log('register:', JSON.stringify(reg));

  const platforms = await evalOn(mainTarget.webSocketDebuggerUrl,
    '(async()=>{try{const r=await window.api.jobSync.platforms();return JSON.stringify({ok:r&&r.ok,data:r&&r.data});}catch(e){return "ERR:"+e.message;}})()');
  log('platforms:', JSON.stringify(platforms));

  const openRes = await evalOn(mainTarget.webSocketDebuggerUrl,
    '(async()=>{try{const r=await window.api.jobSync.open("boss");return JSON.stringify(r);}catch(e){return "ERR:"+e.message;}})()');
  log('open(zhipin):', JSON.stringify(openRes));

  await wait(6000);
  const listAfter = await httpJson('/json/list', 4000);
  const pagesAfter = listAfter.filter((t) => t.type === 'page');
  log('pages after open:', pagesAfter.map((t) => (t.title || '') + ' @ ' + (t.url || '').slice(0, 50)).join('  ||  '));

  for (const t of pagesAfter) {
    if (/index\.html/.test(t.url || '')) continue;
    try {
      const info = await cdpCall(t.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'JSON.stringify({t:document.title,url:location.href,ready:document.readyState,text:(document.body?document.body.innerText:"<nobody>").replace(/\\s+/g," ").slice(0,160)})',
        returnByValue: true
      });
      log('SYNC WINDOW:', JSON.stringify(info.msg && info.msg.result && info.msg.result.result && info.msg.result.result.value));
    } catch (e) { log('SYNC WINDOW read err:', e && e.message); }
  }

  // 再看一眼主界面里同步面板的状态（pageState / error 字段是否仍误报为空）
  const st = await evalOn(mainTarget.webSocketDebuggerUrl,
    '(async()=>{try{const r=await window.api.jobSync.platforms();const b=(r.data||[]).find(x=>x.id==="boss");return JSON.stringify(b&&{open:b.open,pageState:b.pageState,pageTitle:b.pageTitle,pageUrl:b.pageUrl,error:b.error});}catch(e){return "ERR:"+e.message;}})()');
  log('boss status:', JSON.stringify(st));

  child.kill();
  process.exit(0);
}

run().catch((e) => { console.error('[e2e2] fatal:', e && e.message); process.exit(2); });
