'use strict';

// ============================================================
//  采集链路诊断（用真实登录态跑一遍）
//
//  目的：验证「点抓取 → 自动打开平台页 → 捕获数据」在真实 BOSS 登录态下真的通。
//  方法：给桌面版加上 --remote-debugging-port，用 CDP 从进程外观测——
//        不 attach 应用内 webContents 的 debugger（那会冻首帧），只读指标。
//
//  输出四段结论：
//    1) preload 是否加载、注入是否就绪（__grfJobsyncReady / Hits）
//    2) 平台页面是否真的渲染（innerText 长度 / URL / 标题）
//    3) 主进程侧 captured 计数（= 面板上显示的数字）
//    4) collect(auto) 的最终结果与抓到的条数
//
//  只读：不导入、不写库，只调 open / platforms / collect。
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// dev 启动：与打包版共用同一份 userData（登录态一致），且在本实验室可正常渲染
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_MAIN = path.join(ROOT, 'dist', 'main', 'main.js');
const PORT = 9443;
const log = (...a) => console.log('[diag]', ...a);
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

let msgId = 0;
function cdp(wsUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = ++msgId;
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) { /* 忽略 */ }
      reject(new Error(method + ' timeout'));
    }, timeoutMs || 20000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params: params || {} }));
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(method + ' ws error')); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== id) return;
        clearTimeout(timer);
        try { ws.close(); } catch (_) { /* 忽略 */ }
        if (msg.error) reject(new Error(method + ': ' + JSON.stringify(msg.error)));
        else resolve(msg.result);
      } catch (_) { /* 非 JSON 帧忽略 */ }
    };
  });
}

async function evalIn(wsUrl, expression, timeoutMs) {
  const r = await cdp(wsUrl, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  }, timeoutMs);
  if (r.exceptionDetails) {
    throw new Error('页面内执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  }
  return r.result && r.result.value;
}

async function findTargets() {
  const list = await httpJson('/json/list');
  return list;
}

async function run() {
  log('启动应用（dev 方式，复用默认 userData 的真实登录态）');
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: undefined });
  const child = spawn(ELECTRON, [APP_MAIN, '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => log('app>', String(d).trim().slice(0, 200)));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 200)));

  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); }
  }
  if (!ready) { log('devtools 端点未就绪'); child.kill(); process.exit(2); }
  log('devtools 就绪');

  await wait(4000);
  let targets = await findTargets();
  log('targets: ' + targets.map((t) => t.type + ':' + (t.title || '').slice(0, 18)).join(' | '));

  const main = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  if (!main) { log('找不到主窗口 target'); child.kill(); process.exit(2); }
  log('主窗口: ' + main.url);

  // 1) 打开同步窗口（复用已保存的登录态）
  log('调用 jobSync.open(boss) …');
  try {
    const openRes = await evalIn(main.webSocketDebuggerUrl,
      'window.api.jobSync.open("boss").then(r=>JSON.stringify(r))', 30000);
    log('open 返回: ' + openRes);
  } catch (e) { log('open 调用失败: ' + e.message); }

  await wait(9000);

  // 2) 主进程侧状态（面板上那个数字）
  let boss = null;
  try {
    const wrapped = await evalIn(main.webSocketDebuggerUrl,
      'window.api.jobSync.platforms().then(a=>JSON.stringify(a))', 20000);
    const all = JSON.parse(wrapped);
    const arr = Array.isArray(all) ? all : (all.data || []);
    boss = arr.find((x) => x.id === 'boss');
    log('平台状态: ' + JSON.stringify({
      open: boss.open, loggedIn: boss.loggedIn, cookieCount: boss.cookieCount,
      captured: boss.captured, pageState: boss.pageState,
      pageTitle: boss.pageTitle, pageUrl: boss.pageUrl, statusNote: boss.statusNote, error: boss.error
    }));
  } catch (e) { log('读取平台状态失败: ' + e.message); }

  // 3) 平台页面内部指标（注入是否就绪、钩子是否命中、页面是否渲染）
  targets = await findTargets();
  const platform = targets.find((t) => t.type === 'page' && /zhipin\.com/.test(t.url || ''));
  if (platform) {
    try {
      const diag = await evalIn(platform.webSocketDebuggerUrl,
        'JSON.stringify({ready: !!window.__grfJobsyncReady, hooked: !!window.__grfJobsyncHooked,'
        + ' hits: window.__grfJobsyncHits || null, url: location.href, title: document.title,'
        + ' cookieNames: document.cookie.split("; ").map(function(c){return c.split("=")[0]}),'
        + ' readyState: document.readyState, bodyLen: document.body ? document.body.innerText.length : -1,'
        + ' hasJobsLink: !!document.querySelector(\'a[href*="job"]\')})', 15000);
      log('平台页面: ' + diag);
    } catch (e) { log('读取平台页面失败: ' + e.message); }
  } else {
    log('未找到 zhipin 平台 target（页面可能没加载出来）');
    log('当前 targets: ' + targets.map((t) => t.type + ':' + (t.url || '').slice(0, 60)).join(' | '));
  }

  // 4) 自动抓取（只读，不导入）
  const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['applied', 'collected'];
  for (const kind of kinds) {
    log('调用 collect(boss,' + kind + ',auto) …');
    try {
      const wrapped = await evalIn(main.webSocketDebuggerUrl,
        'window.api.jobSync.collect("boss","' + kind + '",true).then(r=>JSON.stringify(r))', 150000);
      const outer = JSON.parse(wrapped);
      const parsed = outer && outer.data ? outer.data : outer;
      log('collect(' + kind + ') => ok=' + parsed.ok
        + ' items=' + (parsed.items ? parsed.items.length : 0)
        + ' needLogin=' + !!parsed.needLogin
        + (parsed.error ? ' error=' + parsed.error : '')
        + ' diag=' + JSON.stringify(parsed.diagnostics || {}));
      if (parsed.items && parsed.items.length) {
        log('样例: ' + JSON.stringify(parsed.items.slice(0, 3)));
      }
    } catch (e) { log('collect(' + kind + ') 调用失败: ' + e.message); }

    // 抓取后再读一次平台页面内部指标：钩子命中几次、最终停在哪个 URL
    const t2 = await findTargets();
    const plat2 = t2.find((t) => t.type === 'page' && /zhipin\.com/.test(t.url || ''));
    if (plat2) {
      try {
        const d2 = await evalIn(plat2.webSocketDebuggerUrl,
          'JSON.stringify({ready: !!window.__grfJobsyncReady, hooked: !!window.__grfJobsyncHooked,'
          + ' hits: window.__grfJobsyncHits || null, url: location.href, title: document.title,'
          + ' cookieNames: document.cookie.split("; ").map(function(c){return c.split("=")[0]}),'
          + ' readyState: document.readyState, bodyLen: document.body ? document.body.innerText.length : -1})', 15000);
        log('抓取后平台页面: ' + d2);
      } catch (e) { log('抓取后读取平台页面失败: ' + e.message); }
    } else {
      log('抓取后未找到 zhipin target');
    }
  }

  child.kill();
  await wait(800);
  process.exit(0);
}

run().catch((e) => { console.error('[diag] fatal:', e); process.exit(2); });
