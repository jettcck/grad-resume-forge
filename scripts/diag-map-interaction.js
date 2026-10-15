'use strict';

// ============================================================
//  地图交互层真实应用诊断（CDP 驱动，独立 user-data-dir）
//
//  用户报障：「滑动鼠标时地图操作繁琐、定位不准确」。v1.12.23 把交互层
//  按高德/腾讯手感重写（锚点缩放 / transform 跟手 / 惯性 / 双击 / 捏合 /
//  键盘 / 悬浮按钮 / 比例尺）。单测守数学，本脚本守**真实应用里的行为**：
//
//   1. 滚轮缩放锚点固定：鼠标底下那个点缩放后不许跑（「定位准确」的核心）
//   2. 拖动跟手：拖动中图层 transform 实时非空；松手后中心精确等于
//      「拖动前锚点处的经纬度」（跟手 + 落账不失真）
//   3. 惯性：快甩松手后地图继续滑 >25px，且最终停住
//   4. 双击放大一级且不误触发点选（实例不重建、出发地不变）
//   5. Firefox 风格滚轮（deltaMode=1）同样一级
//   6. 键盘：方向键平移量精确、+/- 缩放
//   7. 悬浮按钮：＋/－/◎/⤢ 各自生效
//   8. 双指捏合：缩放生效且锚点固定
//   9. 状态行：实时中心坐标 + 比例尺（45–130px）
//   10. 幽灵层最终被清干净（不泄漏 DOM）
//   11. 单击仍能点选出发地：近原点（<30km）直接存；远点（>30km）必须弹确认，
//       取消不改、确认才存（防「fitAll 视野下点屏幕中间，出发地跑偏 660km」）
//   12. 打开地图时锁在出发地身上（有 origin 就不 fitAll）
//
//  运行：node scripts/diag-map-interaction.js
//
//  沙箱注意：本沙箱把 Electron 窗口以最小化状态拉起，且数秒后会再次被最小化，
//  visibilityState 在 visible/hidden 间翻覆（隐藏时 rAF 停摆、CDP mouseWheel 无 ack）。
//  诊断启动后会自动用 PowerShell 激活窗口、等可见，并全程低频重激活保持。
// ============================================================

const { spawn, execFile } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9456;
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-mapinter-diag-'));
const log = (...a) => console.log('[map-inter-diag]', ...a);
const DEBUG = !!process.env.DEBUG;
const dbg = (...a) => { if (DEBUG) log('DEBUG', ...a); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, failCnt = 0;
const t = (cond, msg) => {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
};

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

async function mouse(ws, type, x, y, extra) {
  // 注意：坐标不做四舍五入。锚点测试要比对「鼠标底下那个点」，
  // 取整会引入 0.5px 误差，在低级别（每像素 1~2km）下就是几百米漂移。
  const params = Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {});
  const t0 = Date.now();
  try {
    const r = await cdp(ws, 'Input.dispatchMouseEvent', params, 15000);
    dbg('mouse', type, Date.now() - t0, 'ms');
    return r;
  } catch (e) {
    // 窗口在两次派发之间又被最小化 → ack 永远不来。激活后重试一次。
    if (!/timeout/.test(String(e.message))) throw e;
    log('mouse', type, '超时（窗口可能又被最小化），重激活后重试');
    await activateWindow();
    await wait(1500);
    const r = await cdp(ws, 'Input.dispatchMouseEvent', params, 15000);
    dbg('mouse', type, '重试后', Date.now() - t0, 'ms');
    return r;
  }
}

// 沙箱窗口激活（本机诊断的必需步骤，实测结论）：
//   本沙箱把 Electron 主窗口以【最小化】状态拉起（showCmd=2, iconic=true），
//   且数秒后会再次被最小化——visibilityState 在 visible/hidden 之间反复翻覆。
//   隐藏时 rAF 停摆 → CDP Input.dispatchMouseEvent(mouseWheel) 永远等不到 ack
//   （mouseMoved 只走主线程所以能过）。 bringToFront / setFocusEmulationEnabled /
//   setWebLifecycleState / startScreencast / 反遮挡启动参数全部无效；唯一有效手段是
//   PowerShell 外挂激活：ShowWindow(SW_RESTORE) + BringWindowToTop + SetForegroundWindow。
//   因为窗口会周期性重新最小化，测试全程要低频重激活（keepalive）。
let activating = false;
function activateWindow() {
  if (activating) return Promise.resolve('busy');
  activating = true;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
      "$sig = @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public class W {",
      "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);",
      "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int n);",
      "  [DllImport(\"user32.dll\")] public static extern bool BringWindowToTop(IntPtr h);",
      "}",
      "'@",
      "Add-Type -TypeDefinition $sig",
      "$ps = Get-Process -Name electron -ErrorAction SilentlyContinue",
      "foreach ($p in $ps) {",
      "  if ($p.MainWindowHandle -ne [IntPtr]::Zero) {",
      "    [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null",
      "    [W]::BringWindowToTop($p.MainWindowHandle) | Out-Null",
      "    [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null",
      "    Write-Output ('activated pid=' + $p.Id)",
      "  }",
      "}"
    ].join('\r\n')], { encoding: 'utf8', timeout: 20000 }, (err, stdout) => {
      activating = false;
      resolve(err ? 'PS-ERR: ' + String(err.message).slice(0, 120) : String(stdout).trim());
    });
  });
}

const geoDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 页面内助手：全部经由 window.MapView._internal.current（诊断挂钩）
const PRELIM = `(() => {
  const m = () => window.MapView && window.MapView._internal.current;
  window.__mv = {
    has: () => !!m(),
    tag: () => { const x = m(); if (x && !x.__tag) x.__tag = Math.random(); return x ? x.__tag : null; },
    state: () => { const s = m().state; return { center: s.center.slice(), zoom: s.zoom, viewZoom: s.viewZoom, viewCenter: (s.viewCenter || s.center).slice(), datum: s.datum, maxZoom: s.maxZoom, dragBase: s.dragBase.slice(), momentum: !!s.momentum }; },
    unproject: (x, y) => m().unproject(x, y),
    project: (lat, lng) => m().project(lat, lng),
    layerTransform: () => { const l = document.querySelector('.mv-map-tiles:not(.mv-map-ghost)'); return l ? l.style.transform : null; },
    tiles: () => document.querySelectorAll('.mv-map-tiles:not(.mv-map-ghost) img.mv-tile').length,
    ghosts: () => document.querySelectorAll('.mv-map-ghost').length,
    readout: () => { const r = document.querySelector('.mv-map-readout'); return r ? r.textContent : ''; },
    scale: () => { const b = document.querySelector('.mv-map-scale-bar'); const l = document.querySelector('.mv-map-scale-label'); return (b && l) ? { w: parseFloat(b.style.width), label: l.textContent } : null; },
    stackTexts: () => [...document.querySelectorAll('.mv-map-stack button')].map((b) => b.textContent),
    clickStack: (i) => { const bs = document.querySelectorAll('.mv-map-stack button'); if (!bs[i]) return -1; bs[i].click(); return bs.length; },
    focusCanvas: () => { const c = document.querySelector('.mv-map-canvas'); if (!c) return false; c.focus(); return document.activeElement === c; },
    key: (k) => { const c = document.querySelector('.mv-map-canvas'); c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); },
    wheelEvt: (x, y, dy, mode) => { const c = document.querySelector('.mv-map-canvas'); c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: mode || 0, clientX: x, clientY: y, bubbles: true, cancelable: true })); },
    // 几何探针：画布现在的 rect / 布局尺寸 / 派生缩放
    geom: () => {
      const c = document.querySelector('.mv-map-canvas');
      const r = c.getBoundingClientRect();
      const zx = c.offsetWidth ? r.width / c.offsetWidth : 1;
      const zy = c.offsetHeight ? r.height / c.offsetHeight : 1;
      return { left: r.left, top: r.top, rw: r.width, rh: r.height, ow: c.offsetWidth, oh: c.offsetHeight, cw: c.clientWidth, ch: c.clientHeight, cl: c.clientLeft, ct: c.clientTop, zx, zy };
    },
    // toCanvasPx 的精确逆映射：给定画布坐标，返回应该派发的客户端坐标
    toClient: (x, y) => {
      const c = document.querySelector('.mv-map-canvas');
      const r = c.getBoundingClientRect();
      const zx = c.offsetWidth ? r.width / c.offsetWidth : 1;
      const zy = c.offsetHeight ? r.height / c.offsetHeight : 1;
      const bx = c.clientLeft * zx, by = c.clientTop * zy;
      const cw = c.clientWidth * zx, ch = c.clientHeight * zy;
      return [r.left + bx + x * cw / 768, r.top + by + y * ch / 420];
    },
    px: (x, y) => { const m0 = m(); return m0 && m0.px ? m0.px(x, y) : null; },
    pinch: (x1, y1, x2, y2, x3, y3) => {
      const c = document.querySelector('.mv-map-canvas');
      const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1, pointerType: 'touch' }));
      ev('pointerdown', 1, x1, y1); ev('pointerdown', 2, x2, y2); ev('pointermove', 2, x3, y3); ev('pointerup', 1, x1, y1); ev('pointerup', 2, x3, y3);
    },
    // 确认框探针（点选落点距原位 >30km 时会弹）
    modal: () => {
      const o = document.querySelector('.modal-overlay');
      if (!o) return null;
      return {
        title: (o.querySelector('.modal-title') || {}).textContent || '',
        msg: (o.querySelector('.modal-message') || {}).textContent || ''
      };
    },
    clickModal: (which) => {
      const o = document.querySelector('.modal-overlay');
      if (!o) return false;
      const b = which === 'ok' ? o.querySelector('.btn-danger') : o.querySelector('.btn-ghost');
      if (!b) return false;
      b.click();
      return true;
    },
    origin: async () => { const r = await window.api.settings.get('map'); return (r && r.data && r.data.origin) || null; },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms))
  };
  return true;
})()`;

async function run() {
  const env = Object.assign({}, process.env, { GRF_FORCE_SHOW: '1' });
  delete env.ELECTRON_RUN_AS_NODE;
  log('启动应用（开发态 dist/main，独立 user-data-dir）');
  const child = spawn(ELECTRON, ['.', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE_DIR], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => log('app>', String(d).trim().slice(0, 160)));
  child.stderr.on('data', (d) => log('app!', String(d).trim().slice(0, 160)));

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); }
  }
  if (!ready) { log('devtools 端点未就绪'); child.kill(); process.exit(2); }
  await wait(4000);
  const targets = await httpJson('/json/list').catch(() => []);
  const main = targets.find((x) => x.type === 'page' && /index\.html/.test(x.url || ''));
  if (!main) {
    log('找不到主窗口 target: ' + targets.map((x) => x.type + ':' + (x.url || '').slice(0, 60)).join(' | '));
    child.kill(); process.exit(2);
  }
  const ws = main.webSocketDebuggerUrl;
  log('主窗口已连接');

  // 窗口激活 + 可见性门控：沙箱把窗口以最小化状态拉起且会周期性重新最小化，
  // 隐藏时 rAF 停摆、CDP mouseWheel 无 ack，惯性/滚轮测试全部失去意义。
  log('激活应用窗口:', await activateWindow());
  let vis = '';
  for (let i = 0; i < 40; i++) {
    vis = await evalIn(ws, 'document.visibilityState', 5000).catch(() => '');
    if (vis === 'visible') break;
    if (i % 10 === 9) log('重试激活:', await activateWindow());
    await wait(500);
  }
  t(vis === 'visible', '页面可见（visibilityState=' + vis + '，rAF 正常运行）');
  if (vis !== 'visible') { log('页面不可见，诊断中止'); child.kill(); process.exit(2); }
  // 保持激活：窗口数秒后会再次被最小化，整个测试期间低频重激活。
  // mouse() 超时也会自动重激活重试，双保险。
  const keepalive = setInterval(() => { activateWindow().catch(() => {}); }, 4000);

  // 1) 账号 + 数据（顺序：先写库，再走渲染层表单登录，否则 state.applications 是空的）
  const reg = await evalIn(ws, `
    (async () => {
      const r = await window.api.auth.register({ email: 'mapinter-diag@test.local', password: 'pass123456', name: '地图交互诊断' });
      return r.ok ? r.data.id : ('ERR:' + r.error);
    })()
  `, 20000).catch((e) => 'ERR:' + e.message);
  t(!String(reg).startsWith('ERR:'), '冒烟账号就绪（' + String(reg).slice(0, 20) + '）');
  const uid = String(reg);

  const seed = await evalIn(ws, `
    (async () => {
      await window.api.settings.save('map', { origin: { label: '我的学校', place: '杭州', lat: 30.2741, lng: 120.1551, source: 'city', level: 'city' } });
      await window.api.applications.save(${JSON.stringify(uid)}, { company: '腾讯', place: '深圳·南山', stage: 'applied', position: '后端开发' });
      await window.api.applications.save(${JSON.stringify(uid)}, { company: '阿里巴巴', place: '杭州·余杭', stage: 'wish', position: 'Java 开发' });
      const list = await window.api.applications.list(${JSON.stringify(uid)});
      return (list.ok && list.data) ? list.data.length : -1;
    })()
  `, 20000).catch((e) => -1);
  t(seed >= 2, '出发地与投递记录已写入（' + seed + ' 条）');

  await evalIn(ws, `
    (() => {
      const f = document.getElementById('auth-form');
      f.querySelector('input[name="email"]').value = 'mapinter-diag@test.local';
      f.querySelector('input[name="password"]').value = 'pass123456';
      f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return true;
    })()
  `);
  await wait(3500);

  // 2) 开地图
  const opened = await evalIn(ws, `
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('.nav-item[data-route="apps"]').click();
      await sleep(2200);
      const btn = [...document.querySelectorAll('.mv-map-controls .btn')].find((b) => /开启地图/.test(b.textContent));
      if (!btn) return JSON.stringify({ error: '没有开启地图按钮' });
      btn.click();
      ${PRELIM}
      // 等画布 + 地图实例 + 瓦片（瓦片最多等 20s；取不到也能测交互，只是记一笔）
      for (let i = 0; i < 40; i++) {
        if (window.__mv.has()) break;
        await sleep(500);
      }
      for (let i = 0; i < 40; i++) {
        if (window.__mv.tiles() > 0) break;
        await sleep(500);
      }
      const st = window.__mv.state();
      const c = document.querySelector('.mv-map-canvas');
      c.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(400);
      const r = c.getBoundingClientRect();
      const status = (document.querySelector('.mv-map-status') || {}).textContent || '';
      return JSON.stringify({
        has: window.__mv.has(), tiles: window.__mv.tiles(),
        zoom: st.zoom, center: st.center, datum: st.datum,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        cl: c.clientLeft, ct: c.clientTop,
        stack: window.__mv.stackTexts(), status: status.slice(0, 60)
      });
    })()
  `, 60000).catch((e) => JSON.stringify({ error: e.message }));
  const O = JSON.parse(String(opened));
  t(!O.error && O.has === true, '地图实例已创建（zoom=' + O.zoom + ', datum=' + O.datum + '）');
  t(O.rect && O.rect.w > 700, '画布尺寸正常（' + (O.rect && O.rect.w) + '×' + (O.rect && O.rect.h) + '）');
  t(O.stack && O.stack.length === 4, '悬浮操作栈有 4 个按钮（＋/－/◎/⤢，实得 ' + (O.stack || []).join('') + '）');
  const netOk = O.tiles > 0;
  t(netOk || /取不回来/.test(String(O.status)),
    netOk ? '真实瓦片已显示 ' + O.tiles + ' 块' : '瓦片未取到（' + String(O.status).slice(0, 50) + '）——交互测试继续');
  if (!O.rect) { log('没有画布矩形，后续测试无法进行'); child.kill(); process.exit(2); }

  // 画布坐标 → 客户端坐标：必须走页面里的 toClient（toCanvasPx 的精确逆映射）。
  // 早期版本用 rect.left + x + clientLeft 直接拼，在分数窗口缩放下混用了
  // 「视觉像素」与「布局像素」，派发点整体偏出几个像素 —— 锚点测试全挂。
  const at = async (x, y) => {
    const p = JSON.parse(await evalIn(ws, `JSON.stringify(window.__mv.toClient(${x}, ${y}))`));
    return { x: p[0], y: p[1] };
  };

  // 0) 坐标管线自洽：toCanvasPx(toClient(x,y)) 必须原样回来
  {
    const rt = JSON.parse(await evalIn(ws, `JSON.stringify((() => {
      const g = window.__mv.geom();
      const pts = [[0,0],[200,150],[384,210],[767,419]];
      let worst = 0;
      for (const [x, y] of pts) {
        const c = window.__mv.toClient(x, y);
        const b = window.__mv.px(c[0], c[1]);
        worst = Math.max(worst, Math.hypot(b[0]-x, b[1]-y));
      }
      return { worst: worst, geom: g };
    })())`));
    dbg('roundtrip=', JSON.stringify(rt));
    t(rt.worst < 0.001, '坐标换算自洽：toCanvasPx∘toClient 往返误差 ' + rt.worst.toExponential(2) + 'px（zx=' + rt.geom.zx.toFixed(5) + ', zy=' + rt.geom.zy.toFixed(5) + '）');
  }

  // 0b) 端到端：CDP 派发的鼠标坐标，页面读出来必须就是目标画布坐标。
  // 这是「定位准确」的总验收——悬停时左下角状态行的指针经纬度，
  // 必须等于该画布坐标反投影出的经纬度。
  {
    const H = await at(300, 200);
    await mouse(ws, 'mouseMoved', H.x, H.y);
    await wait(120);
    const r = JSON.parse(await evalIn(ws, `JSON.stringify({ ro: window.__mv.readout(), g: window.__mv.unproject(300, 200) })`));
    const m = /指针 (-?[\d.]+), (-?[\d.]+)/.exec(r.ro);
    const ok = m && Math.hypot(Number(m[1]) - r.g[0], Number(m[2]) - r.g[1]) < 2e-4;
    dbg('hover readout=', r.ro, 'expect=', JSON.stringify(r.g));
    t(!!ok, 'CDP 派发坐标与页面读取一致（指针 ' + (m ? m[1] + ',' + m[2] : 'N/A') + ' vs 期望 ' + r.g.map((v) => v.toFixed(4)).join(',') + '）');
  }

  // 3) 滚轮锚点缩放：鼠标底下那个点不许跑
  // 坐标系说明（实测结论，别再踩）：
  //   · 合成 MouseEvent/WheelEvent 与 CDP 派发的 wheel/dblclick 事件，client 坐标
  //     都会被量化到整数像素（反解验证过）；
  //   · 合成 PointerEvent 与 CDP mouseMoved/mouseReleased 保留小数。
  // 所以锚点接线用「整数 client 坐标」派发（量化无关），锚点在页面里用
  // toCanvasPx 反算——处理器必须恰好把这个点当锚点，缩放后它不许动。
  {
    const A = await at(200, 150);
    const C = [Math.round(A.x), Math.round(A.y)];
    const before = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), anc: window.__mv.px(${C[0]}, ${C[1]}) })`);
    const B = JSON.parse(before);
    const G0 = JSON.parse(await evalIn(ws, `JSON.stringify(window.__mv.unproject(${B.anc[0]}, ${B.anc[1]}))`));
    await evalIn(ws, `window.__mv.wheelEvt(${C[0]}, ${C[1]}, -120, 0)`);
    await wait(900);
    const after = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(${B.anc[0]}, ${B.anc[1]}), tiles: window.__mv.tiles() })`);
    const C2 = JSON.parse(after);
    t(C2.s.zoom === B.s.zoom + 1, '滚轮一格放大一级（' + B.s.zoom + ' → ' + C2.s.zoom + '）');
    dbg('wheel(wiring) anchor=', JSON.stringify(B.anc), 'after=', JSON.stringify(C2.s));
    t(geoDist(G0, C2.g) < 5e-4, '锚点地理点缩放后不动（漂移 ' + geoDist(G0, C2.g).toExponential(2) + '°，锚点画布坐标 ' + B.anc.map((v) => v.toFixed(2)).join(',') + '）');
    t(C2.s.viewZoom === C2.s.zoom && geoDist(C2.s.viewCenter, C2.s.center) < 1e-9, '落账后实时视图与已提交视图一致');
    if (netOk) t(C2.tiles > 0, '缩放后新图层有瓦片（' + C2.tiles + ' 块）');
  }

  // 3b) 真实滚轮事件链路（CDP mouseWheel）：事件到得了、级别对、锚点不飞
  {
    const A = await at(300, 260);
    const before = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(300, 260) })`);
    const B = JSON.parse(before);
    await mouse(ws, 'mouseMoved', A.x, A.y);
    await mouse(ws, 'mouseWheel', A.x, A.y, { deltaX: 0, deltaY: -120 });
    await wait(900);
    const after = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(300, 260) })`);
    const C = JSON.parse(after);
    // 容差 = 1.5px 当量：真实事件坐标被量化到整数像素，锚点天然有 ≤1px 输入误差
    const tol = 1.5 * Number(await evalIn(ws, `window.MapView._internal.metersPerPixel(${C.s.center[0]}, ${C.s.zoom})`)) / 110000;
    t(C.s.zoom === B.s.zoom + 1, '真实滚轮事件同样放大一级（' + B.s.zoom + ' → ' + C.s.zoom + '）');
    t(geoDist(B.g, C.g) < tol, '真实滚轮锚点不飞（漂移 ' + geoDist(B.g, C.g).toExponential(2) + '° ≤ ' + tol.toExponential(1) + '°，输入量化 1.5px 当量）');
  }

  // 4) 双击放大一级，且不误触发点选
  {
    const D = await at(560, 140);
    const before = await evalIn(ws, `(async () => JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(560, 140), tag: window.__mv.tag(), origin: await window.__mv.origin() }))()`);
    const B = JSON.parse(before);
    await mouse(ws, 'mouseMoved', D.x, D.y);
    await mouse(ws, 'mousePressed', D.x, D.y, { clickCount: 1 });
    await mouse(ws, 'mouseReleased', D.x, D.y, { clickCount: 1 });
    await wait(70);
    await mouse(ws, 'mousePressed', D.x, D.y, { clickCount: 2 });
    await mouse(ws, 'mouseReleased', D.x, D.y, { clickCount: 2 });
    await wait(900);
    const after = await evalIn(ws, `(async () => JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(560, 140), tag: window.__mv.tag(), origin: await window.__mv.origin() }))()`);
    const C = JSON.parse(after);
    t(C.s.zoom === B.s.zoom + 1, '双击放大一级（' + B.s.zoom + ' → ' + C.s.zoom + '）');
    dbg('dblclick(real) before=', JSON.stringify(B), 'after=', JSON.stringify(C));
    const tol = 1.5 * Number(await evalIn(ws, `window.MapView._internal.metersPerPixel(${C.s.center[0]}, ${C.s.zoom})`)) / 110000;
    t(geoDist(B.g, C.g) < tol, '双击锚点不飞（漂移 ' + geoDist(B.g, C.g).toExponential(2) + '° ≤ ' + tol.toExponential(1) + '°，输入量化 1.5px 当量）');
    t(C.tag === B.tag, '双击没有误触发点选（地图实例未重建）');
    t(JSON.stringify(C.origin) === JSON.stringify(B.origin), '双击后出发地未被改写');
    // 合成 dblclick（整数 client 坐标）：验「事件坐标 → toCanvasPx 锚点 →
    // zoomAroundCenter」这条接线。合成 MouseEvent 坐标同样被量化到整数像素，
    // 所以派整数坐标，锚点在页面里用 toCanvasPx 反算，与量化无关。
    const CI = [Math.round(D.x), Math.round(D.y)];
    const before2 = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), anc: window.__mv.px(${CI[0]}, ${CI[1]}) })`);
    const B2 = JSON.parse(before2);
    const G0 = JSON.parse(await evalIn(ws, `JSON.stringify(window.__mv.unproject(${B2.anc[0]}, ${B2.anc[1]}))`));
    await evalIn(ws, `document.querySelector('.mv-map-canvas').dispatchEvent(new MouseEvent('dblclick', { clientX: ${CI[0]}, clientY: ${CI[1]}, bubbles: true, cancelable: true }))`);
    await wait(900);
    const C2 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(${B2.anc[0]}, ${B2.anc[1]}) })`));
    t(C2.s.zoom === B2.s.zoom + 1, '合成双击同样放大一级（' + B2.s.zoom + ' → ' + C2.s.zoom + '）');
    dbg('dblclick(wiring) anchor=', JSON.stringify(B2.anc), 'after=', JSON.stringify(C2.s));
    t(geoDist(G0, C2.g) < 5e-4, '双击锚点地理点缩放后不动（漂移 ' + geoDist(G0, C2.g).toExponential(2) + '°，锚点画布坐标 ' + B2.anc.map((v) => v.toFixed(2)).join(',') + '）');
  }

  // 5) Firefox 风格滚轮（deltaMode=1，一行 ≈ 33px）
  {
    const E = await at(300, 300);
    const before = await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`);
    const B = JSON.parse(before);
    await evalIn(ws, `window.__mv.wheelEvt(${E.x}, ${E.y}, -3, 1)`);
    await wait(900);
    const after = await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`);
    const C = JSON.parse(after);
    t(C.s.zoom === B.s.zoom + 1, 'deltaMode=1 的滚轮同样一级（' + B.s.zoom + ' → ' + C.s.zoom + '）');
  }

  // 6) 键盘：方向键精确平移 + +/- 缩放
  {
    const before = await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), expect: window.__mv.unproject(384 + 270, 210) })`);
    const B = JSON.parse(before);
    const focused = await evalIn(ws, `window.__mv.focusCanvas()`);
    t(focused === true, '画布可获焦（tabindex 生效）');
    for (let i = 0; i < 3; i++) { await evalIn(ws, `window.__mv.key('ArrowLeft')`); await wait(280); }
    await evalIn(ws, `window.__mv.key('+')`);
    await wait(500);
    const after = await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`);
    const C = JSON.parse(after);
    dbg('keyboard before=', JSON.stringify(B), 'after=', JSON.stringify(C));
    t(geoDist(C.s.center, B.expect) < 0.003, '三次 ← 精确平移 270px（误差 ' + geoDist(C.s.center, B.expect).toExponential(2) + '°）');
    t(C.s.zoom === B.s.zoom + 1, '键盘 + 放大一级（' + B.s.zoom + ' → ' + C.s.zoom + '）');
  }

  // 7) 悬浮按钮：＋ / － / ◎ / ⤢
  {
    const s0 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`)).s;
    await evalIn(ws, `window.__mv.clickStack(0)`); await wait(500);
    const s1 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`)).s;
    await evalIn(ws, `window.__mv.clickStack(1)`); await wait(500);
    const s2 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`)).s;
    t(s1.zoom === s0.zoom + 1, '悬浮 ＋ 放大一级');
    t(s2.zoom === s0.zoom, '悬浮 － 缩小一级');
    await evalIn(ws, `window.__mv.clickStack(2)`); await wait(600);
    const s3 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`)).s;
    dbg('home button s0=', JSON.stringify(s0), 's3=', JSON.stringify(s3));
    t(geoDist(s3.center, [30.2741, 120.1551]) < 0.02, '◎ 回到出发地（误差 ' + geoDist(s3.center, [30.2741, 120.1551]).toExponential(2) + '°）');
    await evalIn(ws, `window.__mv.clickStack(3)`); await wait(700);
    const s4 = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state() })`)).s;
    t(s4.zoom < s3.zoom, '⤢ 显示全部投递点（' + s3.zoom + ' → ' + s4.zoom + '）');
  }

  // 8) 拖动 A：慢拖（每步之间停 200ms，松手前已停住不该甩）→ 落账位置必须精确
  {
    const S = await at(384, 210);
    // 拖动前：算好「拖动后应该出现在画面中心的点」
    const B = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), expect: window.__mv.unproject(384 - 160, 210 - 88) })`));
    await mouse(ws, 'mouseMoved', S.x, S.y);
    await mouse(ws, 'mousePressed', S.x, S.y);
    // 每一步都按「画布目标坐标」派发（at() 是 toCanvasPx 的精确逆映射）：
    // 页面收到的 pointermove 增量换算成画布像素后正好是 40/22，落账无缩放误差
    for (let i = 1; i <= 4; i++) {
      const M = await at(384 + 40 * i, 210 + 22 * i);
      await mouse(ws, 'mouseMoved', M.x, M.y);
      await wait(200);
    }
    const liveTf = await evalIn(ws, `window.__mv.layerTransform()`);
    t(/translate\(-?[\d.]+px,\s*-?[\d.]+px\)/.test(String(liveTf)), '拖动中图层实时跟手（transform=' + liveTf + '）');
    // 松手前再停 250ms：超过 100ms 静止判定，慢拖不该起惯性（惯性由拖动 B 单独验）
    await wait(250);
    const R = await at(544, 298);
    await mouse(ws, 'mouseReleased', R.x, R.y);
    await wait(250);
    const C = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), tf: window.__mv.layerTransform(), n: window.__mv.tiles() })`));
    dbg('dragA before=', JSON.stringify(B), 'after=', JSON.stringify(C));
    t(!C.s.momentum, '慢拖松手未触发惯性（momentum=' + C.s.momentum + '）');
    t(geoDist(C.s.center, B.expect) < 0.003, '慢拖落账位置精确（误差 ' + geoDist(C.s.center, B.expect).toExponential(2) + '°）');
    t(C.s.center[1] < B.s.center[1] && C.s.center[0] > B.s.center[0], '拖动方向正确（右下拖 → 视野左上移）');
    t(C.tf === '' || C.tf == null, '落账后当前图层 transform 归零');
    if (netOk) t(C.n > 0, '拖动后新图层有瓦片（' + C.n + ' 块）');
  }

  // 9) 拖动 B：快甩松手 → 惯性滑行并最终停住
  {
    const S = await at(384, 210);
    await mouse(ws, 'mouseMoved', S.x, S.y);
    await mouse(ws, 'mousePressed', S.x, S.y);
    for (let i = 1; i <= 4; i++) {
      const M = await at(384 + 45 * i, 210 + 25 * i);
      await mouse(ws, 'mouseMoved', M.x, M.y);
      await wait(40);
    }
    const R = await at(384 + 180, 210 + 100);
    await mouse(ws, 'mouseReleased', R.x, R.y);
    const inertia = JSON.parse(await evalIn(ws, `
      (async () => {
        const mv = window.__mv;
        const a = mv.unproject(384, 210);
        await mv.sleep(1100);
        const b = mv.unproject(384, 210);
        await mv.sleep(900);
        const c = mv.unproject(384, 210);
        const pa = mv.project(a[0], a[1]);
        return JSON.stringify({ glide: Math.hypot(pa[0] - 384, pa[1] - 210), drift: Math.hypot(b[0] - c[0], b[1] - c[1]) });
      })()
    `, 20000));
    t(inertia.glide > 25, '快甩松手后有惯性滑行（滑行 ' + inertia.glide.toFixed(0) + 'px）');
    t(inertia.drift < 1e-4, '惯性最终停住（残余 ' + inertia.drift.toExponential(2) + '°）');
  }

  // 10) 双指捏合：缩放生效 + 锚点固定
  {
    const p1 = await at(250, 180), p2 = await at(350, 240), p3 = await at(460, 320);
    const B = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(355, 250) })`));
    await evalIn(ws, `window.__mv.pinch(${p1.x}, ${p1.y}, ${p2.x}, ${p2.y}, ${p3.x}, ${p3.y})`);
    await wait(1000);
    const C = JSON.parse(await evalIn(ws, `JSON.stringify({ s: window.__mv.state(), g: window.__mv.unproject(355, 250) })`));
    dbg('pinch before=', JSON.stringify(B), 'after=', JSON.stringify(C));
    t(C.s.zoom >= B.s.zoom + 2, '捏合放大生效（' + B.s.zoom + ' → ' + C.s.zoom + '）');
    t(geoDist(B.g, C.g) < 0.005, '捏合锚点固定（漂移 ' + geoDist(B.g, C.g).toExponential(2) + '°）');
  }

  // 11) 状态行 + 比例尺 + 幽灵层清理
  {
    const r = JSON.parse(await evalIn(ws, `JSON.stringify({ ro: window.__mv.readout(), sc: window.__mv.scale(), ghosts: window.__mv.ghosts() })`));
    t(/^中心 -?\d+\.\d{4}, -?\d+\.\d{4} · \d+(\.\d)? 级/.test(r.ro), '状态行显示实时中心坐标与级别（' + r.ro + '）');
    t(r.sc && r.sc.w >= 30 && r.sc.w <= 130 && /^\d+(\.\d)? (m|km)$/.test(r.sc.label),
      '比例尺正常（' + (r.sc && r.sc.label) + ' / ' + (r.sc && r.sc.w) + 'px）');
    await wait(1500);
    const g2 = await evalIn(ws, `window.__mv.ghosts()`);
    t(g2 === 0, '幽灵层已全部清掉（剩 ' + g2 + '）');
  }

  // 12) 单击点选：近原点（<30km）直接存；远点（>30km）必须弹确认——取消不变、确认才存
  // （真实事故防护：fitAll 视野下用户点屏幕中间想选自己，出发地跑偏 660km）
  {
    // 12a) ◎ 回到出发地后点画布中心 → 就是原点本身，直接存、不弹确认
    await evalIn(ws, `window.__mv.clickStack(2)`); await wait(600);
    const P = await at(384, 210);
    const B = JSON.parse(await evalIn(ws, `(async () => JSON.stringify({ g: window.__mv.unproject(384, 210), tag: window.__mv.tag(), origin: await window.__mv.origin() }))()`));
    await mouse(ws, 'mouseMoved', P.x, P.y);
    await mouse(ws, 'mousePressed', P.x, P.y);
    await mouse(ws, 'mouseReleased', P.x, P.y);
    await wait(900);
    const C = JSON.parse(await evalIn(ws, `(async () => JSON.stringify({ origin: await window.__mv.origin(), tag: window.__mv.tag(), has: window.__mv.has(), modal: window.__mv.modal() }))()`));
    t(!C.modal, '近原点单击不弹确认框');
    t(!!C.origin && geoDist([C.origin.lat, C.origin.lng], B.g) < 0.002,
      '近原点单击直接存入精确坐标（误差 ' + (C.origin ? geoDist([C.origin.lat, C.origin.lng], B.g).toExponential(2) : 'N/A') + '°）');
    t(C.has === true, '点选后地图重建且可用');

    // 12b) 拉远视野后点远处 → 弹确认；取消则出发地不变
    await evalIn(ws, `window.__mv.clickStack(3)`); await wait(700); // ⤢ 显示全部 → z5 全国视野
    const F = await at(500, 300);
    const gFar = JSON.parse(await evalIn(ws, `JSON.stringify(window.__mv.unproject(500, 300))`));
    const before2 = await evalIn(ws, `(async () => JSON.stringify({ origin: await window.__mv.origin() }))()`);
    await mouse(ws, 'mouseMoved', F.x, F.y);
    await mouse(ws, 'mousePressed', F.x, F.y);
    await mouse(ws, 'mouseReleased', F.x, F.y);
    await wait(500);
    const modal = await evalIn(ws, `window.__mv.modal()`);
    t(!!modal && /出发地/.test(modal.title + modal.msg),
      '远点单击弹出确认框（' + (modal ? modal.msg.slice(0, 46) + '…' : 'N/A') + '）');
    const cancelled = await evalIn(ws, `window.__mv.clickModal('cancel')`);
    t(cancelled === true, '确认框可取消');
    await wait(400);
    const after2 = JSON.parse(await evalIn(ws, `(async () => JSON.stringify({ origin: await window.__mv.origin(), modal: window.__mv.modal() }))()`));
    t(JSON.stringify(after2.origin) === JSON.stringify(JSON.parse(before2).origin) && !after2.modal, '取消后出发地未被改写');

    // 12c) 再点同一远点 → 确认 → 精确落入
    await mouse(ws, 'mouseMoved', F.x, F.y);
    await mouse(ws, 'mousePressed', F.x, F.y);
    await mouse(ws, 'mouseReleased', F.x, F.y);
    await wait(500);
    const okClicked = await evalIn(ws, `window.__mv.clickModal('ok')`);
    t(okClicked === true, '确认框可确认');
    await wait(900);
    const C3 = JSON.parse(await evalIn(ws, `(async () => JSON.stringify({ origin: await window.__mv.origin(), has: window.__mv.has() }))()`));
    t(!!C3.origin && geoDist([C3.origin.lat, C3.origin.lng], gFar) < 0.002,
      '确认后出发地精确落到点选位置（误差 ' + (C3.origin ? geoDist([C3.origin.lat, C3.origin.lng], gFar).toExponential(2) : 'N/A') + '°）');
    t(C3.has === true, '点选后地图重建且可用');
  }

  clearInterval(keepalive);
  try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  console.log('\n地图交互诊断完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  app_exit(child);
}

function app_exit(child) {
  try { child.kill(); } catch (_) { /* 忽略 */ }
  process.exit(process.exitCode || 0);
}

run().catch((e) => {
  console.error('诊断异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
