'use strict';

// ============================================================
//  多平台记录页路由探测（一次性侦察工具）
//
//  目的：把 CANDIDATE_URLS 里「猜的地址」全部换成「实测地址」，
//        让智联/前程无忧/实习僧/猎聘等平台达到 BOSS 直聘同级的
//        产品化对齐度（直达路由 + 按归属过滤 + 明确报错）。
//
//  方法：对每个平台的每条候选地址：
//    1) loadURL → 等待 → 读最终 URL / 标题 / 登录墙特征；
//    2) 汇总该页面发出的 XHR/fetch（由 CAPTURE_SCRIPT 捕获，主进程落盘）；
//    3) 输出 JSON 报告 → scripts/platform-routes-report.json
//
//  用法：
//    node scripts/probe-platform-routes.js            # 全部平台
//    node scripts/probe-platform-routes.js zhaopin 51job
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_MAIN = path.join(ROOT, 'dist', 'main', 'main.js');
const PORT = 9447;
const REPORT = path.join(__dirname, 'platform-routes-report.json');
const log = (...a) => console.log('[probe]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 探测目标：与 src/main/job-sync.ts 的 CANDIDATE_URLS 保持同源（复制粘贴时注意同步）
const PROBE_TARGETS = {
  zhaopin: {
    applied: [
      'https://i.zhaopin.com/jobs/delivered',
      'https://i.zhaopin.com/personal-center/delivered',
      'https://i.zhaopin.com/resume/apply',
      'https://i.zhaopin.com/'
    ],
    collected: [
      'https://i.zhaopin.com/jobs/favorite',
      'https://i.zhaopin.com/personal-center/favorite',
      'https://i.zhaopin.com/resume/collect'
    ]
  },
  '51job': {
    applied: [
      'https://my.51job.com/deliveredrecord',
      'https://my.51job.com/my/apply-record',
      'https://www.51job.com/userset/my_apply.php',
      'https://my.51job.com/'
    ],
    collected: [
      'https://my.51job.com/my/favorite',
      'https://my.51job.com/favorite',
      'https://www.51job.com/userset/my_collect.php'
    ]
  },
  shixiseng: {
    applied: ['https://www.shixiseng.com/user/deliver', 'https://www.shixiseng.com/'],
    collected: ['https://www.shixiseng.com/user/collect', 'https://www.shixiseng.com/']
  },
  liepin: {
    applied: ['https://www.liepin.com/zhaopin/', 'https://www.liepin.com/'],
    collected: ['https://www.liepin.com/collect/', 'https://www.liepin.com/']
  },
  lagou: {
    applied: ['https://www.lagou.com/', 'https://gate.lagou.com/personalCenter/deliver'],
    collected: ['https://www.lagou.com/']
  },
  iguopin: {
    applied: ['https://www.iguopin.com/', 'https://www.iguopin.com/personal/deliver'],
    collected: ['https://www.iguopin.com/personal/collect', 'https://www.iguopin.com/']
  }
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
    throw new Error('页面内执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
  }
  return r.result && r.result.value;
}

async function findTargets() {
  return httpJson('/json/list');
}

/** 通过主窗口 API 打开某平台同步窗口并返回平台视图 target */
async function openPlatform(main, platformId) {
  const openRes = await evalIn(main.webSocketDebuggerUrl,
    'window.api.jobSync.open("' + platformId + '").then(r=>JSON.stringify(r))', 30000);
  log(platformId, 'open =>', openRes);
  await wait(6000);
  const targets = await findTargets();
  const view = targets.filter((t) => t.type === 'page').find((t) => {
    const u = t.url || '';
    return !/index\.html/.test(u) && u.startsWith('http');
  });
  return view || null;
}

/** 读平台视图当前状态（最终 URL / 标题 / 登录墙 / 正文长度） */
async function readView(view) {
  try {
    return await evalIn(view.webSocketDebuggerUrl,
      'JSON.stringify({url: location.href, title: document.title,'
      + ' readyState: document.readyState, bodyLen: document.body ? document.body.innerText.length : -1,'
      + ' loginWall: /login|passport|signin|verify|captcha/i.test(location.href) || /登录|注册/.test(document.title)})', 15000);
  } catch (e) {
    return JSON.stringify({ url: view.url, error: e.message });
  }
}

async function run() {
  const only = process.argv.slice(2);
  const report = {};
  log('启动应用（dev 方式，复用默认 userData 登录态）');
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: undefined });
  const child = spawn(ELECTRON, [APP_MAIN, '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + PORT], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => { /* 静默：探测输出太多 */ });
  child.stderr.on('data', () => { /* 静默 */ });

  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try { await httpJson('/json/version'); ready = true; break; } catch (_) { await wait(500); }
  }
  if (!ready) { log('devtools 端点未就绪'); child.kill(); process.exit(2); }
  await wait(4000);
  const targets = await findTargets();
  const main = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url || ''));
  if (!main) { log('找不到主窗口 target'); child.kill(); process.exit(2); }

  const platformIds = only.length ? only : Object.keys(PROBE_TARGETS);
  for (const pid of platformIds) {
    const conf = PROBE_TARGETS[pid];
    if (!conf) { log('未知平台: ' + pid); continue; }
    report[pid] = { applied: {}, collected: {} };
    for (const kind of ['applied', 'collected']) {
      for (const url of conf[kind]) {
        log(pid, kind, '→', url);
        let view = await openPlatform(main, pid);
        if (!view) { log(pid, '同步窗口视图未找到，跳过'); report[pid][kind][url] = { error: 'no view' }; continue; }
        // 通过 CDP 直接驱动平台视图导航（只读侦察，不碰应用内部状态）
        try {
          await cdp(view.webSocketDebuggerUrl, 'Page.navigate', { url }, 25000);
        } catch (e) { log('导航异常(继续):', e.message); }
        await wait(9000);
        const state = await readView(view);
        report[pid][kind][url] = JSON.parse(state);
        log(pid, kind, '结果:', state);
      }
    }
    // 每个平台结束后关闭窗口，避免多窗口干扰下一平台的视图识别
    try {
      await evalIn(main.webSocketDebuggerUrl,
        'window.api.jobSync.close("' + pid + '").then(r=>JSON.stringify(r))', 15000);
    } catch (_) { /* 忽略 */ }
    await wait(1500);
  }

  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  log('报告已写入', REPORT);
  child.kill();
  await wait(800);
  process.exit(0);
}

run().catch((e) => { console.error('[probe] fatal:', e); process.exit(2); });
