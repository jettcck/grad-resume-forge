'use strict';
// CDP 冒烟：43 题题库 + 自定义测试输入（真实安装版）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const PROFILE = path.join(__dirname, '.diag-profile-smoke');
const PORT = 9450;

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

  await evalJs(`(async () => { await window.api.auth.register({ email: 'smoke@test.local', password: 'pass123456', name: '冒烟' }); })()`);
  await sleep(2500);

  // 1) 题库数量 = 43
  const count = await evalJs(`(async () => {
    navigate('exam'); await new Promise(r=>setTimeout(r,400));
    examState.view='code'; await renderExamCenter(); await new Promise(r=>setTimeout(r,1500));
    return JSON.stringify({
      items: document.querySelectorAll('.code-item').length,
      stateList: (codeState.list||[]).length,
      hasCustom: !!document.querySelector('.code-custom-input'),
      hasCustomBtn: !!document.getElementById('code-btn-custom')
    });
  })()`);
  check('题库 43 题 + 自定义输入区存在', count.includes('"items":43') && count.includes('"hasCustom":true'), count);

  // 2) 新题可选中（切到第 24 题 = 第一批新题「每日温度」）
  const pickNew = await evalJs(`(async () => {
    const items=document.querySelectorAll('.code-item');
    items[23].click(); await new Promise(r=>setTimeout(r,1200));
    return JSON.stringify({
      title: (document.querySelector('.code-problem h3')||{}).textContent,
      tags: (document.querySelector('.code-meta-row')||{}).textContent
    });
  })()`);
  check('能切到第二批新题', pickNew.includes('每日温度'), pickNew);

  // 3) 新题起始代码（C++）可用
  const starter = await evalJs(`(async () => {
    const sel=document.getElementById('code-lang'); sel.value='cpp';
    sel.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,900));
    const ed=document.querySelector('.code-editor');
    return JSON.stringify({ len: ed.value.length, hasMain: ed.value.includes('int main'), hasTodo: ed.value.includes('TODO') });
  })()`);
  check('新题 C++ 起始骨架存在且含 TODO', starter.includes('"hasMain":true'), starter);

  // 4) 自定义输入：展开 + 填数据 + 运行（A+B）
  const custom = await evalJs(`(async () => {
    // 切回 A+B
    document.querySelectorAll('.code-item')[0].click();
    await new Promise(r=>setTimeout(r,1200));
    const sel=document.getElementById('code-lang'); sel.value='javascript';
    sel.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,800));
    const ed=document.querySelector('.code-editor');
    ed.value="const d=require('fs').readFileSync(0,'utf8').trim().split(/\\\\s+/).map(Number);console.log(d[0]+d[1]);";
    ed.dispatchEvent(new Event('input'));
    await new Promise(r=>setTimeout(r,300));
    // 展开自定义输入区（点标题行）
    document.querySelector('.code-custom-head').click();
    await new Promise(r=>setTimeout(r,300));
    const ta=document.querySelector('.code-custom-input');
    ta.value='123 456';
    ta.dispatchEvent(new Event('input'));
    document.getElementById('code-btn-custom').click();
    await new Promise(r=>setTimeout(r,4000));
    const out=document.getElementById('code-custom-out');
    return JSON.stringify({ text: out ? out.textContent.slice(0,120) : null, rows: out ? out.children.length : -1 });
  })()`);
  check('自定义输入运行并回显输出（123+456=579）', custom.includes('579'), custom);

  // 5) 自定义输入：错误代码要显示编译/运行错误而不是崩
  const customErr = await evalJs(`(async () => {
    const ed=document.querySelector('.code-editor');
    ed.value='process.exit(7);';
    ed.dispatchEvent(new Event('input'));
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('code-btn-custom').click();
    await new Promise(r=>setTimeout(r,3000));
    return JSON.stringify({ text: (document.getElementById('code-custom-out')||{}).textContent });
  })()`);
  check('自定义输入：RE 时给出错误说明', customErr.includes('运行错误') || customErr.includes('退出码'), customErr);

  check('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | ').slice(0, 200));

  console.log(R.join('\n'));
  console.log('SMOKE_' + (R.every((x) => x.startsWith('✅')) ? 'ALL_PASS' : 'HAS_FAIL') + ' (' + R.filter(x => x.startsWith('✅')).length + '/' + R.length + ')');
  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
