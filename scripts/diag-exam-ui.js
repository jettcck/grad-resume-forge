'use strict';
// CDP 冒烟：笔试中心答题页 / 结果页的真实渲染（改过题目来源与文案后必测）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const PROFILE = path.join(__dirname, '.diag-profile-examui');
const PORT = 9452;

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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
    }
  };
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id; pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  await new Promise((r) => ws.onopen = r);
  await send('Runtime.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const R = [];
  const check = (name, ok, extra) => R.push((ok ? '✅' : '❌') + ' ' + name + (extra ? ' → ' + extra : ''));

  await evalJs(`(async () => { await window.api.auth.register({ email: 'examui@test.local', password: 'pass123456', name: 'UI冒烟' }); })()`);
  await sleep(2500);

  // 1) 首页能渲染（含周进度/岗位计划新文案）
  const home = await evalJs(`(async () => {
    navigate('exam'); await new Promise(r=>setTimeout(r,900));
    const root=document.getElementById('route-exam');
    return JSON.stringify({
      htmlLen: root ? root.innerHTML.length : -1,
      hasCompose: !!document.getElementById('exam-job-select'),
      emptyText: root ? root.textContent.includes('还没有考试记录') : null
    });
  })()`);
  check('笔试中心首页渲染', home.includes('"hasCompose":true'), home);

  // 2) 组卷 → 答题页：题干/选项/进度条都在
  const answering = await evalJs(`(async () => {
    try {
      await startExam({ count: 10, durationSec: 600, passScore: 60, domain: 'backend' });
      await new Promise(r=>setTimeout(r,1200));
      const box=document.getElementById('exam-q-box');
      return JSON.stringify({
        view: examState.view,
        stem: (document.querySelector('.exam-q-stem')||{}).textContent ? (document.querySelector('.exam-q-stem')||{}).textContent.slice(0,24) : null,
        opts: document.querySelectorAll('.exam-opt').length,
        progress: (document.getElementById('exam-progress')||{}).textContent,
        navItems: document.querySelectorAll('#exam-nav button').length,
        compText: (document.querySelector('.exam-comp')||{}).textContent,
        // 答题页绝不能出现答案/解析字样
        leak: /正确答案|解析：/.test(box ? box.textContent : '')
      });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('答题页渲染题干与选项', answering.includes('"view":"answering"') && !answering.includes('"opts":0'), answering);
  check('答题页不泄漏答案/解析', answering.includes('"leak":false'), answering);
  check('组卷构成显示兜底数（0 时不显示）', answering.includes('"compText"'), answering);

  // 3) 选中一个选项 → 进度更新
  const pick = await evalJs(`(async () => {
    const opt=document.querySelector('.exam-opt');
    if(!opt) return 'NO_OPT';
    opt.click();
    await new Promise(r=>setTimeout(r,300));
    return JSON.stringify({ progress: (document.getElementById('exam-progress')||{}).textContent });
  })()`);
  check('选中选项后进度更新', /已答 [1-9]/.test(pick), pick);

  // 4) 交卷 → 结果页
  const result = await evalJs(`(async () => {
    try {
      await submitExam(true); // 跳过确认弹窗
      await new Promise(r=>setTimeout(r,1500));
      return JSON.stringify({
        view: examState.view,
        score: (document.querySelector('.exam-score')||{}).textContent,
        verdict: (document.querySelector('.exam-verdict')||{}).textContent,
        hasDuration: /用时|分钟|秒/.test(document.body.textContent)
      });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('交卷后进结果页并显示分数', result.includes('"view":"result"'), result);

  check('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | ').slice(0, 160));

  console.log(R.join('\n'));
  console.log('SMOKE_' + (R.every((x) => x.startsWith('✅')) ? 'ALL_PASS' : 'HAS_FAIL') + ' (' + R.filter(x => x.startsWith('✅')).length + '/' + R.length + ')');
  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
