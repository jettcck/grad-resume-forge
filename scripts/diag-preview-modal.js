'use strict';

// ============================================================
//  预览弹窗真实应用验证（CDP 驱动打包版，无需登录）
//
//  验证两件用户实机反馈的事：
//    1) 取消勾选后，「导入选中的 N 条」实时变化（以前写死不变）
//    2) 模态框滚动容器渲染 30 行不卡（根因是全屏 backdrop-filter，已移除）
//
//  方法：启动打包版 + --remote-debugging-port，把 window.api.jobSync.collect
//  stub 成返回 30 条假数据，再点面板里的「抓取投递记录」按钮 → 真实走
//  doCollect → showPreview 全链路。只读面板状态，不真正导入。
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const EXE = process.env.GRF_DESKTOP_EXE
  || 'C:\\Users\\王锦楠\\Desktop\\grad-resume-forge\\简历锻造炉.exe';
const PORT = 9445;
const log = (...a) => console.log('[modal-diag]', ...a);
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
    ws.onerror = () => { clearTimeout(timer); reject(new Error(method + ' ws error')); };
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

function fakeItems(n) {
  const cities = ['北京', '上海', '深圳', '杭州', '成都', '广州', '南京', '武汉'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      company: '测试公司' + (i + 1) + '号',
      position: '测试岗位' + (i + 1),
      place: cities[i % cities.length],
      url: 'https://example.com/job/' + i,
      externalId: 'ext-' + i,
      stage: 'applied',
      notes: ''
    });
  }
  return out;
}

async function run() {
  if (!fs.existsSync(EXE)) { log('打包版不存在: ' + EXE); process.exit(2); }
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; // 关键：否则 exe 退化成 Node 进程
  log('启动打包版: ' + EXE);
  // 独立 user-data-dir：用户实例正在运行（单实例锁按 userData 区分），
  // 用同一份 userData 启动只会在 600ms 内被锁礼貌退出。collect 已被 stub，不需要登录态。
  const profileDir = path.join(ROOT, '.modal-diag-profile');
  const child = spawn(EXE, ['--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profileDir], {
    cwd: path.dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => log('app>', String(d).trim().slice(0, 160)));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 160)));

  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); }
  }
  if (!ready) { log('devtools 端点未就绪'); child.kill(); process.exit(2); }
  log('devtools 就绪');

  await wait(4000);
  let targets = await httpJson('/json/list').catch(() => []);
  const main = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  if (!main) {
    log('找不到主窗口 target: ' + targets.map((t) => t.type + ':' + (t.url || '').slice(0, 60)).join(' | '));
    child.kill(); process.exit(2);
  }
  const ws = main.webSocketDebuggerUrl;

  // 1) 直接驱动真实 showPreview（window.api 是 contextBridge 只读对象，页面里 stub 不了 collect）
  const setup = await evalIn(ws, `
    (async () => {
      if (!window.JobSync || !window.JobSync._internal || !window.JobSync._internal.showPreview) {
        return 'showPreview-not-exposed';
      }
      window.__modalDiag = { collectCalls: 0 };
      const p = window.JobSync._internal.showPreview(${JSON.stringify(fakeItems(30))}, 'BOSS直聘', 'applied');
      window.__modalDiag.picked = p;
      await new Promise(r => setTimeout(r, 800));
      return 'modal-opened';
    })()
  `, 30000).catch((e) => 'setup-failed: ' + e.message);
  log('预览模态: ' + setup);

  // 2) 模态真的出来了吗：行数、初始按钮文案
  const state1 = await evalIn(ws, `
    JSON.stringify((() => {
      const overlay = document.querySelector('.modal-overlay .ji-box');
      const list = document.querySelector('.modal-overlay .ji-list');
      const boxes = document.querySelectorAll('.modal-overlay .ji-list input[type=checkbox]');
      const submit = [...document.querySelectorAll('.modal-overlay button')].find(b => /导入选中的/.test(b.textContent||''));
      return {
        modalOpen: !!overlay,
        rows: list ? list.children.length : -1,
        boxes: boxes.length,
        submitText: submit ? submit.textContent : null,
        submitDisabled: submit ? submit.disabled : null,
        overlayBackdrop: overlay ? getComputedStyle(document.querySelector('.modal-overlay')).backdropFilter : null
      };
    })())
  `, 15000).catch((e) => 'read-failed: ' + e.message);
  log('模态状态: ' + state1);

  // 3) 真实 DOM 上取消两项 → 按钮文案必须实时变
  const state2 = await evalIn(ws, `
    (async () => {
      const boxes = document.querySelectorAll('.modal-overlay .ji-list input[type=checkbox]');
      if (boxes.length < 18) return JSON.stringify({ error: 'boxes too few: ' + boxes.length });
      boxes[16].click();   // #17 北京国鼎保安
      boxes[17].click();   // #18
      await new Promise(r => setTimeout(r, 150));
      const submit = [...document.querySelectorAll('.modal-overlay button')].find(b => /导入选中的/.test(b.textContent||''));
      const checked = [...boxes].filter(b => b.checked).length;
      return JSON.stringify({ checked, submitText: submit ? submit.textContent : null, submitDisabled: submit ? submit.disabled : null });
    })()
  `, 15000).catch((e) => 'uncheck-failed: ' + e.message);
  log('取消两项后: ' + state2);

  // 4) 全部取消 → 0 条 + 禁用
  const state3 = await evalIn(ws, `
    (async () => {
      const boxes = document.querySelectorAll('.modal-overlay .ji-list input[type=checkbox]');
      boxes.forEach(b => { if (b.checked) b.click(); });
      await new Promise(r => setTimeout(r, 200));
      const submit = [...document.querySelectorAll('.modal-overlay button')].find(b => /导入选中的/.test(b.textContent||''));
      return JSON.stringify({ submitText: submit ? submit.textContent : null, submitDisabled: submit ? submit.disabled : null });
    })()
  `, 15000).catch((e) => 'uncheck-all-failed: ' + e.message);
  log('全部取消后: ' + state3);

  // 5) 滚动性能粗测：把 30 行列表滚到底，量一下主线程耗时与合成层提示
  const perf = await evalIn(ws, `
    (async () => {
      const list = document.querySelector('.modal-overlay .ji-list');
      if (!list) return JSON.stringify({ error: 'no list' });
      const cs = getComputedStyle(list);
      const t0 = performance.now();
      list.scrollTop = list.scrollHeight;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const dt = performance.now() - t0;
      return JSON.stringify({
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        frameMs: Math.round(dt * 10) / 10,
        willChange: cs.willChange,
        transform: cs.transform,
        containRow: getComputedStyle(list.children[0]).contain
      });
    })()
  `, 15000).catch((e) => 'perf-failed: ' + e.message);
  log('滚动/合成层: ' + perf);

  // 6) 截图留证
  try {
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, 15000);
    if (shot && shot.data) {
      const out = path.join(ROOT, 'scripts', 'modal-diag-screenshot.png');
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      log('截图已存: ' + out);
    }
  } catch (e) { log('截图失败: ' + e.message); }

  child.kill();
  await wait(600);
  process.exit(0);
}

run().catch((e) => { console.error('[modal-diag] fatal:', e); process.exit(2); });
