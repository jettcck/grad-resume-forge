'use strict';
// 部署版启动烟测：CDP 连上桌面安装的 v1.12.22，确认窗口起来、版本对、同步模块在
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXE = 'C://Users//王锦楠//Desktop//grad-resume-forge//简历锻造炉.exe';
const PORT = 9466;
const log = (...a) => console.log('[deploy-smoke]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}
let msgId = 0;
function cdp(wsUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = ++msgId;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error(method + ' timeout')); }, timeoutMs || 20000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params: params || {} }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        if (msg.error) reject(new Error(method + ': ' + JSON.stringify(msg.error)));
        else resolve(msg.result);
      } catch (_) {}
    };
  });
}
async function evalIn(ws, expression, timeoutMs) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result && r.result.value;
}

async function run() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-deploy-smoke-'));
  const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir], {
    cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => log('app>', String(d).trim().slice(0, 160)));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 160)));
  let ready = false;
  for (let i = 0; i < 80; i++) { try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); } }
  if (!ready) { log('devtools 未就绪'); child.kill(); process.exit(2); }
  await wait(4000);
  const targets = await httpJson('/json/list').catch(() => []);
  const main = targets.find((x) => x.type === 'page' && /index\.html/.test(x.url || ''));
  if (!main) { log('找不到主窗口'); child.kill(); process.exit(2); }
  const ws = main.webSocketDebuggerUrl;
  const out = await evalIn(ws, `
    (async () => {
      const st = await window.api.updater.status();
      const d = st && st.data ? st.data : {};
      return JSON.stringify({
        version: d.version,
        hasJobSync: typeof window.JobSync !== 'undefined',
        hasJobImport: typeof window.JobImport !== 'undefined',
        hasOnProgress: typeof window.api.jobSync.onProgress === 'function',
        hasMapView: typeof window.MapView !== 'undefined',
        title: document.title
      });
    })()
  `, 20000).catch((e) => 'ERR: ' + e.message);
  log('部署版状态: ' + out);
  const o = JSON.parse(String(out));
  const ok = o.version === '1.12.22' && o.hasJobSync && o.hasOnProgress && o.hasMapView;
  log(ok ? '✅ 部署版启动正常，版本 1.12.22，同步/进度/地图模块齐全' : '❌ 部署版异常');
  child.kill();
  await wait(600);
  process.exit(ok ? 0 : 1);
}
run().catch((e) => { console.error('[deploy-smoke] fatal:', e); process.exit(2); });
