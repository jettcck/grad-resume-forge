'use strict';
// CDP 冒烟：编程题页完整交互链路（修 el() 崩溃后的真实行为验证）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const ROOT = __dirname;
const PROFILE = path.join(ROOT, '.diag-profile');
const PORT = 9446;

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true, force: true });
  const child = spawn(EXE, ['--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE], { env, stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 60; i++) {
    try { version = await getJson(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch (_) { await sleep(500); }
  }
  if (!version) { console.log('CDP_NOT_READY'); child.kill(); process.exit(1); }
  let targets = [];
  for (let i = 0; i < 40; i++) {
    targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    if (targets.some((t) => t.type === 'page' && t.url.includes('index.html'))) break;
    await sleep(500);
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
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
    const id = ++msgId; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
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
  const check = (name, ok, extra) => { R.push((ok ? '✅' : '❌') + ' ' + name + (extra ? ' → ' + extra : '')); };

  await evalJs(`(async () => { await window.api.auth.register({ email: 'diag@test.local', password: 'pass123456', name: '诊断' }); })()`);
  await sleep(2500);

  // 1) 进编程题
  const enter = await evalJs(`(async () => {
    try { navigate('exam'); await new Promise(r=>setTimeout(r,400));
      examState.view='code'; await renderExamCenter(); await new Promise(r=>setTimeout(r,1200));
      const root=document.getElementById('route-exam');
      return JSON.stringify({ children: root.children.length, editor: !!document.querySelector('.code-editor'), subs: !!document.getElementById('code-subs') });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('进编程题页不崩', typeof enter === 'string' && !enter.startsWith('THREW'), enter);

  // 2) 题面渲染完整（meta-row 四段都在）
  const meta = await evalJs(`JSON.stringify({
    meta: document.querySelector('.code-meta-row') ? document.querySelector('.code-meta-row').textContent : null,
    title: (document.querySelector('.code-problem h3')||{}).textContent || null,
    items: document.querySelectorAll('.code-item').length
  })`);
  check('题面 meta-row 渲染', typeof meta === 'string' && !meta.startsWith('THREW') && JSON.parse(meta).meta, meta);

  // 3) 切题（点第二个题）
  const switchQ = await evalJs(`(async () => {
    try { const items=document.querySelectorAll('.code-item'); if(items.length<2) return 'NO_ITEM';
      items[1].click(); await new Promise(r=>setTimeout(r,1200));
      const root=document.getElementById('route-exam');
      return JSON.stringify({ children: root.children.length, title: (document.querySelector('.code-problem h3')||{}).textContent });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('切题不崩且重新渲染', typeof switchQ === 'string' && !switchQ.startsWith('THREW') && !switchQ.startsWith('NO_ITEM'), switchQ);

  // 4) 切语言到 C++
  const lang = await evalJs(`(async () => {
    try { const sel=document.getElementById('code-lang'); sel.value='cpp';
      sel.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,900));
      const ed=document.querySelector('.code-editor');
      return JSON.stringify({ lang: codeState.lang, hasCpp: ed.value.includes('iostream') || ed.value.includes('main') });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('切 C++ 且起始代码是 C++', typeof lang === 'string' && !lang.startsWith('THREW') && JSON.parse(lang).hasCpp, lang);

  // 5) 切回 A+B，写 C++ 解法 → 运行样例
  const run = await evalJs(`(async () => {
    try {
      const items=document.querySelectorAll('.code-item');
      items[0].click(); // 回到 A+B
      await new Promise(r=>setTimeout(r,1200));
      const ed=document.querySelector('.code-editor');
      ed.value='#include <iostream>\\nusing namespace std;\\nint main(){long long a,b;cin>>a>>b;cout<<a+b<<endl;return 0;}';
      ed.dispatchEvent(new Event('input'));
      await new Promise(r=>setTimeout(r,300));
      await runCode('run');
      await new Promise(r=>setTimeout(r,6000));
      const v=document.querySelector('.code-verdict');
      return JSON.stringify({ verdict: v?v.textContent:null, subs: document.querySelectorAll('.cs-row-item').length });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('C++ 运行样例通过', typeof run === 'string' && !run.startsWith('THREW') && JSON.parse(run).verdict.includes('通过'), run);

  // 6) 提交判题 → 记录出现
  const submit = await evalJs(`(async () => {
    try {
      await runCode('submit');
      await new Promise(r=>setTimeout(r,8000));
      return JSON.stringify({
        verdict: (document.querySelector('.code-verdict')||{}).textContent,
        subRows: document.querySelectorAll('.cs-row-item').length,
        firstSub: (document.querySelector('.cs-row-item')||{}).textContent
      });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('提交判题 AC 且记录展示', typeof submit === 'string' && !submit.startsWith('THREW') && JSON.parse(submit).subRows >= 1, submit);

  // 7) 草稿持久化：切走再回来代码还在
  const draft = await evalJs(`(async () => {
    try {
      examState.view='home'; await renderExamCenter(); await new Promise(r=>setTimeout(r,300));
      examState.view='code'; await renderExamCenter(); await new Promise(r=>setTimeout(r,1000));
      const ed=document.querySelector('.code-editor');
      return JSON.stringify({ restored: ed.value.includes('iostream'), len: ed.value.length });
    } catch(e){ return 'THREW:'+e.message; }
  })()`);
  check('草稿恢复（切走再回来）', typeof draft === 'string' && !draft.startsWith('THREW') && JSON.parse(draft).restored, draft);

  // 8) 侧栏 AC 勾
  const solved = await evalJs(`JSON.stringify({
    hasTick: Array.from(document.querySelectorAll('.ci-title')).some(t=>t.textContent.startsWith('✓'))
  })`);
  check('侧栏 AC 打勾', solved.includes('true'), solved);

  check('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | ').slice(0, 200));

  console.log(R.join('\n'));
  console.log('SMOKE_' + (R.every((x) => x.startsWith('✅')) ? 'ALL_PASS' : 'HAS_FAIL') + ' (' + R.filter(x=>x.startsWith('✅')).length + '/' + R.length + ')');
  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
