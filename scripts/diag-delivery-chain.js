'use strict';

// ============================================================
//  投递链路真实应用诊断（CDP 驱动，独立 user-data-dir）
//
//  验证 v1.12.22 自检 + 优化的四条链路在**真实应用**里成立：
//   1) 同步面板打开后有进度行（.js-progress），抓取期间按钮禁用（busy 守卫）
//   2) jobsync:progress 通道真的通：点面板「抓取投递记录」跑一次真实 autoCollect，
//      采样进度行文本（打开首页 / 查找入口 / 等待登录…）
//   3) 抓取结束（无论成败）按钮恢复可用，面板不卡死
//   4) 预览「已存在 · 将更新」标记 + importAuthorized 增量合并：
//      用户推进到「面试中」的记录，二次同步后阶段/地点/备注不被抹掉
//
//  运行：node scripts/diag-delivery-chain.js
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 9455;
// 每次运行都用全新 profile：复用旧目录会带上轮的账号/记录，断言全乱
const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'grf-delivery-diag-'));
const log = (...a) => console.log('[delivery-diag]', ...a);
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

async function run() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; // 否则 electron 退化成 Node
  log('启动应用（开发态 dist/main，独立 user-data-dir: ' + PROFILE_DIR + '）');
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

  // 1) 注册一个冒烟账号（register 即建立会话，后续 IPC 都认它）
  const reg = await evalIn(ws, `
    (async () => {
      const r = await window.api.auth.register({ email: 'delivery-diag@test.local', password: 'pass123456', name: '投递诊断' });
      return r.ok ? JSON.stringify({ id: r.data.id }) : JSON.stringify({ error: r.error });
    })()
  `, 20000).catch((e) => JSON.stringify({ error: e.message }));
  const regOut = JSON.parse(String(reg));
  if (regOut.error && /已注册|已存在|exists/i.test(regOut.error)) {
    // 复跑同一 profile 时账号已存在：改用登录
    const login = await evalIn(ws, `
      (async () => {
        const r = await window.api.auth.login({ email: 'delivery-diag@test.local', password: 'pass123456' });
        return r.ok ? JSON.stringify({ id: r.data.id }) : JSON.stringify({ error: r.error });
      })()
    `, 20000).catch((e) => JSON.stringify({ error: e.message }));
    Object.assign(regOut, JSON.parse(String(login)));
  }
  t(!regOut.error, '冒烟账号就绪（id=' + (regOut.id || '?') + (regOut.error ? ', err=' + regOut.error : '') + '）');

  // 2) 预置一条授权导入记录，并手动推进到「面试中」+ 补地点 + 写备注
  const seed = await evalIn(ws, `
    (async () => {
      const uid = ${JSON.stringify(regOut.id || '')};
      const imp = await window.api.applications.importAuthorized(uid, { source: '诊断平台', items: [
        { externalId: 'diag-001', company: '诊断某某科技', position: '后端工程师', place: '北京', url: 'https://example.com/diag/1', stage: 'applied', notes: '投递时间：2026-10-01' }
      ] });
      const list = await window.api.applications.list(uid);
      const rec = (list.data || []).find((a) => a.externalId === 'diag-001');
      if (!rec) return JSON.stringify({ error: '预置记录失败' });
      await window.api.applications.save(uid, { id: rec.id, stage: 'interview', place: '北京·海淀区', notes: 'HR 已约周三面试' });
      return JSON.stringify({ added: imp.data && imp.data.added, id: rec.id });
    })()
  `, 20000).catch((e) => JSON.stringify({ error: e.message }));
  const seedOut = JSON.parse(String(seed));
  t(!seedOut.error, '预置记录并推进到「面试中」（' + (seedOut.error || 'added=' + seedOut.added) + '）');

  // 3) 打开同步面板：进度行必须存在，按钮初始可用
  //    注意：platforms() 要读 9 个分区的 cookie，首轮约 4~5 秒，必须等行渲染出来再断言
  const panel = await evalIn(ws, `
    (async () => {
      if (!window.JobSync || !window.JobSync.openPanel) return 'JobSync-not-loaded';
      window.__diagPanel = window.JobSync.openPanel({ userId: ${JSON.stringify(regOut.id || '')}, onChanged: async () => {} });
      // 等平台行出现（最多 25 秒）
      for (let i = 0; i < 50; i++) {
        if (document.querySelectorAll('.js-row').length > 0) break;
        await new Promise(r => setTimeout(r, 500));
      }
      const progress = document.querySelector('.js-progress');
      const btns = [...document.querySelectorAll('.js-body button')];
      return JSON.stringify({
        hasProgressLine: !!progress,
        progressDisplay: progress ? progress.style.display : null,
        buttons: btns.length,
        allEnabled: btns.every((b) => !b.disabled),
        hasOnProgress: typeof window.api.jobSync.onProgress === 'function'
      });
    })()
  `, 40000).catch((e) => 'panel-failed: ' + e.message);
  const panelOut = JSON.parse(String(panel));
  t(panelOut.hasProgressLine === true, '同步面板有进度行元素（.js-progress）');
  t(panelOut.progressDisplay === 'none', '初始进度行隐藏（实得 ' + panelOut.progressDisplay + '）');
  t(panelOut.hasOnProgress === true, 'preload 暴露了 onProgress 订阅');
  t(panelOut.buttons > 0 && panelOut.allEnabled === true, '面板按钮初始全部可用（' + panelOut.buttons + ' 个）');

  // 4) 进度通道（事件流层面）：iguopin 是快速失败路径，三条进度在毫秒级发完，
  //    DOM 轮询抓不住，直接听 preload 事件流验证主进程 → 渲染层的推送。
  const stream = await evalIn(ws, `
    (async () => {
      const events = [];
      const unsub = window.api.jobSync.onProgress((p) => events.push({ note: p.note, captured: p.captured }));
      const t0 = Date.now();
      let res = null, err = null;
      try { res = await window.api.jobSync.collect('iguopin', 'applied', true); } catch (e) { err = e.message; }
      const dt = Date.now() - t0;
      unsub();
      // res 是 IPC 信封，业务结果在 data 里
      const data = res && res.data ? res.data : null;
      return JSON.stringify({ dt, err, bizOk: data && data.ok, bizError: data && data.error, events });
    })()
  `, 120000).catch((e) => JSON.stringify({ error: e.message }));
  const streamOut = JSON.parse(String(stream));
  const notes = (streamOut.events || []).map((e) => e.note).filter(Boolean);
  t(notes.length >= 2, '进度事件流推送过至少 2 个不同状态（实得 ' + notes.length + ' 个：' + notes.map((s) => s.slice(0, 16)).join(' → ') + '）');
  t(streamOut.bizOk === false && /没有找到|登录/.test(String(streamOut.bizError || '')),
    'iguopin 抓取走完自动流程并给出可读结论（' + String(streamOut.bizError).slice(0, 50) + '，耗时 ' + streamOut.dt + 'ms）');
  // 收掉 iguopin 的同步窗口，避免干扰后续 DOM 断言
  await evalIn(ws, `window.api.jobSync.close('iguopin')`, 15000).catch(() => {});

  // 5) 面板真实点击路径（DOM 层面）：点 BOSS 行的「抓取投递记录」。
  //    BOSS 未登录会停在登录墙上，「等待登录…」会持续显示 —— DOM 轮询抓得住。
  //    必须点在 BOSS 那一行：每行都有同名按钮。
  const clickRes = await evalIn(ws, `
    (async () => {
      const row = [...document.querySelectorAll('.js-row')].find((r) => /BOSS直聘/.test(r.textContent || ''));
      if (!row) return JSON.stringify({ error: '找不到 BOSS 行' });
      const btn = [...row.querySelectorAll('button')].find((b) => /抓取投递记录/.test(b.textContent || ''));
      if (!btn) return JSON.stringify({ error: 'BOSS 行里没有抓取按钮' });
      btn.click();
      return JSON.stringify({ clicked: true });
    })()
  `, 30000).catch((e) => JSON.stringify({ error: e.message }));
  const clickOut = JSON.parse(String(clickRes));
  t(clickOut.clicked === true, '点击了 BOSS 行的「抓取投递记录」（' + (clickOut.error || 'ok') + '）');

  // busy 守卫：按钮应立即全部禁用
  const busyState = await evalIn(ws, `
    (async () => {
      await new Promise(r => setTimeout(r, 500));
      const btns = [...document.querySelectorAll('.js-body button')];
      return JSON.stringify({ buttons: btns.length, allDisabled: btns.length > 0 && btns.every((b) => b.disabled) });
    })()
  `, 20000).catch((e) => JSON.stringify({ error: e.message }));
  const busyOut = JSON.parse(String(busyState));
  t(busyOut.allDisabled === true, '抓取期间面板按钮全部禁用（busy 守卫生效）');

  // 进度行必须显示实时状态（BOSS 会走到「等待登录」并停在那里）
  const firstNote = await evalIn(ws, `
    (async () => {
      for (let i = 0; i < 60; i++) {
        const p = document.querySelector('.js-progress');
        const txt = p && p.style.display !== 'none' ? String(p.textContent || '') : '';
        if (/⏳/.test(txt)) return JSON.stringify({ text: txt });
        await new Promise(r => setTimeout(r, 500));
      }
      return JSON.stringify({ text: '' });
    })()
  `, 40000).catch((e) => JSON.stringify({ error: e.message }));
  const firstOut = JSON.parse(String(firstNote));
  t(/⏳/.test(String(firstOut.text)), '进度行显示实时状态（实得「' + String(firstOut.text).slice(0, 44) + '」）');

  // 主动收尾：关闭 BOSS 同步窗口 → autoCollect 随窗口销毁退出 → doCollect 走失败分支 → 按钮恢复
  await evalIn(ws, `window.api.jobSync.close('boss')`, 15000).catch(() => {});
  const after = await evalIn(ws, `
    (async () => {
      for (let i = 0; i < 80; i++) {
        const btns = [...document.querySelectorAll('.js-body button')];
        if (btns.length && btns.every((b) => !b.disabled)) break;
        await new Promise(r => setTimeout(r, 500));
      }
      const btns = [...document.querySelectorAll('.js-body button')];
      const progress = document.querySelector('.js-progress');
      return JSON.stringify({
        buttons: btns.length,
        allEnabled: btns.every((b) => !b.disabled),
        progressDisplay: progress ? progress.style.display : null
      });
    })()
  `, 50000).catch((e) => JSON.stringify({ error: e.message }));
  const afterOut = JSON.parse(String(after));
  t(afterOut.allEnabled === true, '抓取结束后按钮恢复可用（面板不卡死）');
  t(afterOut.progressDisplay === 'none', '抓取结束后进度行收起（实得 ' + afterOut.progressDisplay + '）');

  // 6) 预览「已存在 · 将更新」标记 + 完整导入回路（阶段不被抹掉）
  //    注意：此时有两个 modal-overlay（同步面板 + 预览），预览是后打开的那个
  const merge = await evalIn(ws, `
    (async () => {
      const uid = ${JSON.stringify(regOut.id || '')};
      const existing = (await window.api.applications.list(uid)).data || [];
      const items = [
        // 平台这次没给地点（place 为空）—— 用户手填的「北京·海淀区」必须保留
        { company: '诊断某某科技', position: '后端工程师', place: '', url: '', externalId: 'diag-001', stage: 'applied', notes: '' },
        { company: '全新公司甲', position: '前端工程师', place: '杭州', url: '', externalId: 'diag-002', stage: 'applied', notes: '' }
      ];
      const p = window.JobSync._internal.showPreview(items, '诊断平台', 'applied', existing);
      await new Promise(r => setTimeout(r, 600));
      const overlays = [...document.querySelectorAll('.modal-overlay')];
      const preview = overlays[overlays.length - 1];
      const dupTags = [...preview.querySelectorAll('.ji-tag-dup')];
      const title = preview.querySelector('.modal-title');
      const before = { dupCount: dupTags.length, titleText: title ? title.textContent : null };
      // 两条都勾选 → 点导入
      const submit = [...preview.querySelectorAll('button')].find((b) => /导入选中的/.test(b.textContent || ''));
      submit.click();
      const picked = await p;
      if (!picked || !picked.length) return JSON.stringify(Object.assign(before, { error: 'no picked' }));
      const stat = await window.api.applications.importAuthorized(uid, { source: '诊断平台', items: picked });
      const list = (await window.api.applications.list(uid)).data || [];
      const rec = list.find((a) => a.externalId === 'diag-001');
      const fresh = list.find((a) => a.externalId === 'diag-002');
      return JSON.stringify({
        dupCount: before.dupCount, titleText: before.titleText,
        added: stat.data && stat.data.added, updated: stat.data && stat.data.updated,
        stage: rec && rec.stage, place: rec && rec.place, notes: rec && rec.notes,
        freshAdded: !!fresh
      });
    })()
  `, 40000).catch((e) => JSON.stringify({ error: e.message }));
  const mergeOut = JSON.parse(String(merge));
  t(mergeOut.dupCount === 1, '预览里已有记录被打上「已存在 · 将更新」（实得 ' + mergeOut.dupCount + ' 个）');
  t(/其中 1 条将更新已有记录/.test(String(mergeOut.titleText)), '预览标题标注更新条数');
  t(mergeOut.updated === 1 && mergeOut.added === 1, '导入走新增 1 + 更新 1（实得 added=' + mergeOut.added + ', updated=' + mergeOut.updated + '）');
  t(mergeOut.stage === 'interview', '二次同步后阶段仍是「面试中」（实得 ' + mergeOut.stage + '）');
  t(mergeOut.place === '北京·海淀区', '手填地点被保留（实得 ' + mergeOut.place + '）');
  t(/HR 已约周三面试/.test(String(mergeOut.notes)), '手写备注被保留');
  t(mergeOut.freshAdded === true, '新记录正常新增');

  // 6) 截图留证
  try {
    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, 15000);
    if (shot && shot.data) {
      const out = path.join(ROOT, 'scripts', 'delivery-diag-screenshot.png');
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      log('截图已存: ' + out);
    }
  } catch (e) { log('截图失败: ' + e.message); }

  child.kill();
  await wait(600);
  console.log('\n投递链路诊断完成: ' + pass + ' passed, ' + failCnt + ' failed | exitCode = ' + (process.exitCode || 0));
  process.exit(failCnt === 0 ? 0 : 1);
}

run().catch((e) => { console.error('[delivery-diag] fatal:', e); process.exit(2); });
