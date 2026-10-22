'use strict';
// ⚠️ 未完成（2026-10-22）：这个脚本在本机跑会卡住，暂时不要用。
//
// 现象：4 张图全部截到登录页首帧，且进程跑 11 分钟不退出。
// 判断：Page.captureScreenshot 在「窗口未真正显示」时返回缓存帧，
//       脚本里的 await 因此挂住；smoke:ui 的截图脚本用的是 webContents.capturePage
//       （主进程侧 API），不是同一条路径，所以那边能出图。
// 结论：作品集截图先用手动录屏（docs/demo-script.md），或用 npm run smoke:ui 出的那批。
//
// 以下是原始实现，保留作为后续排查的起点（改成在主进程内调 capturePage 即可）。

// 用 CDP 驱动打包版应用，为作品集补拍「笔试中心 / 答题页 / 编程题 / 判题结果」四张图
//
// 为什么单独写：`npm run smoke:ui` 的截图脚本覆盖的是简历生成链路，
// 不含笔试中心与判题结果——而这两块恰好是「工程能力」最直观的证据。
//
// 用法：node scripts/shots-for-portfolio.js
// 产物：shots/09-exam-home.png / 10-exam-answering.png / 11-code-problem.png / 12-code-judged.png
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const PROFILE = path.join(ROOT, '.diag-profile-shots');
const SHOTS = path.join(ROOT, 'shots');
const PORT = 9460;

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

(async () => {
  if (!fs.existsSync(EXE)) { console.log('找不到安装版应用：' + EXE); process.exit(1); }
  fs.mkdirSync(SHOTS, { recursive: true });
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });

  const child = spawn(EXE, ['--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE], { env, stdio: 'ignore' });

  for (let i = 0; i < 60; i++) {
    try { await getJson(`http://127.0.0.1:${PORT}/json/version`); break; } catch (_) { await sleep(500); }
  }
  let targets = [];
  for (let i = 0; i < 40; i++) {
    targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    if (targets.some((t) => t.type === 'page' && t.url.includes('index.html'))) break;
    await sleep(500);
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) { console.log('没找到主窗口'); child.kill(); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id; pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await new Promise((r) => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // capturePage 在刚切路由时会拿到旧帧（项目里 774 行也记了这个坑），所以每张图前多重等一会儿
  const shot = async (name) => {
    await sleep(900);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const data = r.result && r.result.data;
    if (!data) { console.log('  截图失败:', name); return false; }
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64'));
    console.log('  ✓ ' + name + '.png');
    return true;
  };

  // 登录（诊断用独立 profile，库里是空的）
  await evalJs(`(async () => {
    const r = await window.api.auth.register({ email: 'shots@demo.local', password: 'demo123456', name: '演示用户' });
    return r && r.ok;
  })()`);
  await sleep(2600);

  console.log('开始截图 →', SHOTS);

  // 1) 笔试中心首页
  await evalJs(`(async () => {
    navigate('exam');
    await new Promise(r => setTimeout(r, 700));
    examState.view = 'home';
    await renderExamCenter();
  })()`);
  await shot('09-exam-home');

  // 2) 答题页（组一套 10 题）
  const started = await evalJs(`(async () => {
    try {
      await startExam({ count: 10, durationSec: 1800, passScore: 60, domain: 'backend' });
      await new Promise(r => setTimeout(r, 1200));
      // 选一个选项，让界面有「已作答」状态
      const opt = document.querySelector('.exam-opt');
      if (opt) opt.click();
      await new Promise(r => setTimeout(r, 400));
      return examState.view;
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  if (started === 'answering') {
    await shot('10-exam-answering');
  } else {
    console.log('  答题页没进去（' + started + '），跳过该图');
  }

  // 3) 编程题页（A+B，C++ 起始代码）
  const codeReady = await evalJs(`(async () => {
    try {
      examState.view = 'code';
      await renderExamCenter();
      await new Promise(r => setTimeout(r, 1400));
      const sel = document.getElementById('code-lang');
      if (sel) { sel.value = 'cpp'; sel.dispatchEvent(new Event('change')); }
      await new Promise(r => setTimeout(r, 900));
      return JSON.stringify({ editor: !!document.querySelector('.code-editor'), lang: codeState.lang });
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  await shot('11-code-problem');

  // 4) 判题结果：写一份 C++ 解法，跑「运行样例」，留下 AC 结果
  await evalJs(`(async () => {
    try {
      const ed = document.querySelector('.code-editor');
      if (!ed) return 'NO_EDITOR';
      ed.value = '#include <iostream>\\nusing namespace std;\\nint main(){long long a,b;if(!(cin>>a>>b))return 0;cout<<a+b<<endl;return 0;}';
      ed.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 300));
      await runCode('run');
      await new Promise(r => setTimeout(r, 5000));
      return 'OK';
    } catch (e) { return 'ERR:' + e.message; }
  })()`);
  await shot('12-code-judged');

  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  console.log('完成。产物在', SHOTS);
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
