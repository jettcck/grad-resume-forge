'use strict';

// ============================================================
//  采集链路冒烟（不依赖任何真实平台、不联网）
//
//  为什么需要它：「已捕获 0 个响应」这个 bug 先后以三种形态出现过
//  （preload 路径不存在 / 隔离世界包不到主世界 fetch / source 判断丢消息），
//  每一种在真实平台上都只表现为「抓不到」，看不出卡在哪一环。
//  这里用本地页面把整条链路走一遍：
//
//    本地页面(自己发 fetch + XHR)
//      → 主进程注入的 CAPTURE_SCRIPT（主世界）
//      → postMessage
//      → 隔离世界 preload 转发
//      → IPC 'jobsync:captured'
//      → extractRecords 归一化
//
//  用法：electron scripts/smoke-jobsync-capture.js --no-sandbox
// ============================================================

const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const http = require('http');
const path = require('path');

const jobSync = require(path.join(__dirname, '..', 'dist', 'main', 'job-sync.js'));

const PORT = 18731;
const PARTITION = 'persist:jobsync-smoke';
const log = (...a) => console.log('[smoke]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass += 1; log('✅ PASS:', msg); }
  else { failCnt += 1; log('❌ FAIL:', msg); process.exitCode = 1; }
}

// ---------- 本地模拟平台：页面自己发 fetch 与 XHR ----------
const PAGE = `<!doctype html><meta charset="utf-8"><title>模拟平台</title>
<body><h1>模拟招聘平台</h1><div id="out"></div>
<script>
  // fetch：BOSS 风格的嵌套响应
  fetch('/api/zp').then(function(r){return r.text()}).then(function(t){
    document.getElementById('out').textContent = 'fetch ok ' + t.length;
  });
  // XHR（responseType=json）：另一套字段别名
  var x = new XMLHttpRequest();
  x.responseType = 'json';
  x.open('GET', '/api/alt');
  x.send();
<\/script>`;

const server = http.createServer((req, res) => {
  const url = String(req.url || '');
  if (url.indexOf('/api/zp') === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      code: 0,
      zpData: {
        list: [
          { jobName: 'Java开发工程师', companyName: '甲甲公司', cityName: '北京', encryptJobId: 'a1', jobUrl: '/job_detail/a1.html' },
          { jobName: '前端开发工程师', companyName: '乙乙公司', cityName: '杭州', encryptJobId: 'b2' }
        ]
      }
    }));
    return;
  }
  if (url.indexOf('/api/alt') === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: { items: [{ company: { name: '丙丙科技' }, jobTitle: '算法工程师', workCity: '深圳', positionId: 998877 }] }
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  log('本地模拟平台: http://127.0.0.1:' + PORT);

  const captured = [];
  const probes = [];
  ipcMain.on('jobsync:captured', (_e, payload) => {
    if (payload && typeof payload.body === 'string') captured.push(payload);
  });
  ipcMain.on('jobsync:probe', (_e, payload) => { probes.push(payload); });

  const win = new BrowserWindow({ show: false, width: 900, height: 700 });
  const view = new BrowserView({
    webPreferences: {
      partition: PARTITION,
      preload: jobSync.capturePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });

  // 注入时机：did-start-navigation（页面脚本执行之前）→ dom-ready → 主框架加载完成。
  // 只在 dom-ready 注入会漏掉页面初始化时发的请求（实测：内联脚本里的 fetch 已经用
  // 原生 fetch 发出去了，钩子白装）。did-start-navigation 注入失败（文档还没建好）
  // 时由后续事件兜底。
  const inject = () => {
    view.webContents.executeJavaScript(jobSync.CAPTURE_SCRIPT, true)
      .catch((e) => log('注入失败: ' + String(e && e.message).slice(0, 120)));
  };
  view.webContents.on('did-start-navigation', () => { log('did-start-navigation → 注入'); inject(); });
  view.webContents.on('dom-ready', inject);
  view.webContents.on('did-frame-finish-load', (_e, isMain) => { if (isMain) inject(); });

  await view.webContents.loadURL('http://127.0.0.1:' + PORT + '/');
  await wait(2500);

  // 1) preload 真的加载了吗（就绪回执只能由 preload 转发出来）
  assert(probes.length > 0 && probes.some((p) => p && p.ready), 'preload 已加载并转发主世界就绪回执');

  // 2) 页面里钩子装上了吗、命中了吗；以及页面自己的请求到底发出去没有
  let pageInfo = {};
  try {
    const r = await view.webContents.executeJavaScript(
      'JSON.stringify({ready:!!window.__grfJobsyncReady,hooked:!!window.__grfJobsyncHooked,'
      + 'hits:window.__grfJobsyncHits||null,out:(document.getElementById("out")||{}).textContent||"",'
      + 'fetchIsWrapped:String(window.fetch).indexOf("__grf")>=0||String(window.fetch).indexOf("of.apply")>=0})', true);
    pageInfo = JSON.parse(String(r));
    log('页面状态: ' + JSON.stringify(pageInfo));
  } catch (_) { /* 忽略 */ }
  assert(pageInfo.hooked === true, '采集钩子已注入页面主世界');
  assert(!!(pageInfo.hits && pageInfo.hits.fetch > 0), 'fetch 被钩住并命中（实得 ' + (pageInfo.hits ? pageInfo.hits.fetch : -1) + '）');
  assert(!!(pageInfo.hits && pageInfo.hits.xhr > 0), 'XHR 被钩住并命中（实得 ' + (pageInfo.hits ? pageInfo.hits.xhr : -1) + '）');

  // 3) 主进程真的收到了吗
  assert(captured.length >= 2, '主进程收到 ' + captured.length + ' 条采集响应（≥2）');
  const urls = captured.map((c) => String(c.url || ''));
  assert(urls.some((u) => u.indexOf('/api/zp') >= 0), 'fetch 响应已回传（' + urls.join(', ') + '）');
  assert(urls.some((u) => u.indexOf('/api/alt') >= 0), 'XHR(responseType=json) 响应已回传');

  // 4) 能归一化成记录吗
  const bodies = captured.map((c) => ({ url: String(c.url || ''), json: (() => { try { return JSON.parse(c.body); } catch (_) { return null; } })() }));
  const items = jobSync.extractRecords(bodies, 'applied');
  assert(items.length >= 3, '归一化出 ' + items.length + ' 条记录（fetch 2 条 + XHR 1 条）');
  assert(items.some((i) => i.company === '甲甲公司' && i.position === 'Java开发工程师'),
    '嵌套字段（zpData.list / jobName / companyName）解析正确');
  assert(items.some((i) => i.company === '丙丙科技' && i.position === '算法工程师'),
    'responseType=json 的另一套别名（company.name / jobTitle）解析正确');
  assert(items.some((i) => i.place === '北京'), '地点解析正确');

  // 5) 幂等：重复注入不会叠加包装
  inject(); inject();
  await wait(600);
  const r2 = await view.webContents.executeJavaScript('window.__grfJobsyncHits.report', true);
  assert(Number(r2) >= 2, '重复注入后钩子未叠加（report=' + r2 + '）');

  win.destroy();
  server.close();
  app.exit(failCnt === 0 ? 0 : 1);
});

app.on('window-all-closed', () => { /* 冒烟脚本自行退出 */ });
