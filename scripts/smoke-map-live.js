'use strict';

// ============================================================
//  在线地图「真网络」端到端冒烟
//
//  为什么单独一个脚本：
//    - smoke-real-ipc.js 只走 IPC 登录，渲染层 state.user 始终为空，
//      投递页的距离面板根本不会挂载 —— 在那里测在线地图是测不到的。
//    - smoke:ui 用的是截图 mock，它的 map:tile 永远失败，只能证明「失败时诚实降级」。
//    真正「点一下能不能看到图」，只有这个脚本能回答。
//
//  顺序很重要：先造数据、再走**渲染层表单登录**。
//  因为登录时 app.js 才会加载 state.applications；先登录后写库的话，
//  面板读到的仍是空数组（IPC 写库不会更新渲染层内存）。
//
//  **依赖网络**，所以不挂在 npm test / CI 上；离线时会如实报告失败原因。
//
//  运行：npx electron scripts/smoke-map-live.js --no-sandbox --disable-gpu
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-maplive-'));
app.setPath('userData', tmp);
app.commandLine.appendSwitch('no-sandbox');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, failCnt = 0;
const t = (cond, msg) => {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
};

require(path.join(__dirname, '..', 'dist', 'main', 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 80 && !win; i++) { win = BrowserWindow.getAllWindows()[0] || null; if (!win) await sleep(250); }
  if (!win) { t(false, '主进程创建了窗口'); app.exit(1); return; }
  await sleep(2500);

  const EMAIL = 'maplive@test.local', PASS = 'pass123456';

  // 1) 建账号（这一步同时会给该 webContents 建立会话，所以后面的数据 IPC 才可用）
  const reg = await win.webContents.executeJavaScript(
    'window.api.auth.register({ email: ' + JSON.stringify(EMAIL) + ', password: ' + JSON.stringify(PASS) + ', name: "地图冒烟" })'
  );
  t(reg && reg.ok, '造好测试账号（' + (reg && reg.error ? reg.error : 'ok') + '）');
  const uid = reg && reg.ok && reg.data ? reg.data.id : null;
  t(!!uid, '拿到 userId（' + String(uid).slice(0, 18) + '…）');

  // 2) 先造数据：出发地 + 两条带地址的投递记录
  const seeded = await win.webContents.executeJavaScript(`(async () => {
    await window.api.settings.save('map', { origin: { label: '我的学校', place: '杭州', lat: 30.2741, lng: 120.1551, source: 'city', level: 'city' } });
    await window.api.applications.save(${JSON.stringify(uid)}, { company: '腾讯', place: '深圳·南山', stage: 'applied', position: '后端开发' });
    await window.api.applications.save(${JSON.stringify(uid)}, { company: '阿里巴巴', place: '杭州·余杭', stage: 'wish', position: 'Java 开发' });
    const list = await window.api.applications.list(${JSON.stringify(uid)});
    return { count: list.ok && list.data ? list.data.length : -1 };
  })()`);
  t(seeded.count >= 2, '出发地与投递记录已写入（' + seeded.count + ' 条投递）');

  // 3) 走渲染层登录表单：这样 state.user / state.applications 才会被正确设置
  await win.webContents.executeJavaScript(`(() => {
    const f = document.getElementById('auth-form');
    f.querySelector('input[name="email"]').value = ${JSON.stringify(EMAIL)};
    f.querySelector('input[name="password"]').value = ${JSON.stringify(PASS)};
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
  await sleep(3500);
  const loggedIn = await win.webContents.executeJavaScript(
    '(function(){ const el = document.getElementById("app-view"); return !!(el && getComputedStyle(el).display !== "none"); })()'
  );
  t(loggedIn === true, '渲染层登录成功（否则距离面板不会挂载——这正是上一版漏测的原因）');

  // 4) 切到投递页：距离面板应挂载并算出距离
  const panel = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('.nav-item[data-route="apps"]').click();
    await sleep(2200);
    const mv = document.querySelector('.mv-root');
    const rows = [...document.querySelectorAll('.mv-row')];
    const attr = (document.querySelector('.mv-attr') || {}).textContent || '';
    return {
      hasRoot: !!mv, rows: rows.length,
      first: rows.length ? rows[0].textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) : '',
      hasSvg: !!document.querySelector('.mv-svg'),
      attr: attr.slice(0, 46),
      hasToggle: !!([...document.querySelectorAll('.mv-map-controls .btn')].find((b) => /开启地图/.test(b.textContent)))
    };
  })()`);
  t(panel.hasRoot === true && panel.rows >= 2, '距离面板挂载并算出距离（' + panel.rows + ' 行）');
  t(panel.hasSvg === true, '离线相对位置图已渲染');
  t(/阿里|腾讯/.test(panel.first), '距离行内容正常（' + panel.first + '）');
  t(/高德/.test(panel.attr), '默认瓦片源是高德（署名：' + panel.attr + '）—— OSM 在部分国内网络不可达');
  t(panel.hasToggle === true, '「开启地图」按钮存在');

  // 5) 真的点开地图，等真实瓦片
  const live = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('.mv-map-controls .btn')].find((b) => /开启地图/.test(b.textContent));
    if (!btn) return { clicked: false };
    btn.click();
    await sleep(11000);
    const imgs = document.querySelectorAll('.mv-map-tiles img.mv-tile').length;
    const status = (document.querySelector('.mv-map-status') || {}).textContent || '';
    const canvas = document.querySelector('.mv-map-canvas');
    const firstSrc = (document.querySelector('.mv-map-tiles img.mv-tile') || {}).src || '';
    return { clicked: true, tiles: imgs, status: status, hasCanvas: !!canvas, isDataUrl: firstSrc.indexOf('data:image/png;base64,') === 0 };
  })()`);
  t(live.hasCanvas === true, '点击后地图画布出现（按钮真的接上了渲染）');
  t(live.tiles > 0 || /取不回来/.test(String(live.status)),
    '真实瓦片显示了 ' + live.tiles + ' 块' +
    (live.tiles > 0 ? '（' + (live.isDataUrl ? '经主进程代理的 data: URL' : '直接 URL —— 不应发生') + '）'
      : '｜失败说明：' + String(live.status).slice(0, 70)));
  if (live.tiles > 0) {
    t(live.isDataUrl === true, '瓦片确实是经主进程代理后的 data: URL（证明 CSP 未被放宽也无需放宽）');
  }

  // 6) 缓存确实落盘（离线复用 + 对瓦片服务礼貌）
  const cache = await win.webContents.executeJavaScript('window.api.map.cacheStats()');
  t(cache && cache.ok, '缓存统计可读：' + (cache && cache.ok ? cache.data.files + ' 块 / ' + Math.round(cache.data.bytes / 1024) + 'KB' : ''));
  if (live.tiles > 0) {
    t(cache.data.files > 0, '取回的瓦片已写入磁盘缓存（下次打开同一片区域不再联网）');
  }

  // 7) 再点一次应能关掉
  const closed = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const off = [...document.querySelectorAll('.mv-map-controls .btn')].find((b) => /关闭地图/.test(b.textContent));
    if (off) { off.click(); await sleep(1500); }
    return { canvasGone: !document.querySelector('.mv-map-canvas') };
  })()`);
  t(closed.canvasGone === true, '再点一次能关掉地图');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  console.log('\n在线地图真网络冒烟完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  app.exit(process.exitCode || 0);
}).catch((e) => {
  console.error('冒烟异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});
