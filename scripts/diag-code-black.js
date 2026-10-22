'use strict';
// CDP 诊断：安装版应用「编程题全黑」复现 + 抓渲染进程报错
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const ROOT = __dirname;
const PROFILE = path.join(ROOT, '.diag-profile');
const PORT = 9445;

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
  const child = spawn(EXE, [
    '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE
  ], { env, stdio: 'ignore' });

  // 等 CDP 就绪
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
  if (!page) { console.log('NO_PAGE_TARGET'); child.kill(); process.exit(1); }

  // Node 22 内置 WebSocket
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const exceptions = [];
  const consoleErrs = [];

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push((m.params.args || []).map((a) => a.description || a.value).join(' '));
    }
  };

  const send = (method, params) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await new Promise((r) => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.result && r.result.exceptionDetails) {
      return { __err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  // 1) 注册诊断账号（独立 profile 是空库）
  const reg = await evalJs(`(async () => {
    const r = await window.api.auth.register({ email: 'diag@test.local', password: 'pass123456', name: '诊断' });
    return JSON.stringify(r);
  })()`);
  console.log('REGISTER:', JSON.stringify(reg));

  await sleep(2500); // 等 UI 进主界面

  // 2) 检查 code API 完整性
  const api = await evalJs(`JSON.stringify({
    hasGetDraft: typeof window.api.code.getDraft,
    hasSaveDraft: typeof window.api.code.saveDraft,
    hasSubmissions: typeof window.api.code.submissions
  })`);
  console.log('CODE_API:', api);

  // 3) 导航到笔试中心 → 编程题
  await evalJs(`navigate('exam')`);
  await sleep(800);
  await evalJs(`examState.view = 'code'; renderExamCenter();`);
  await sleep(1500);

  // 4) 看 route-exam 内容
  const dom = await evalJs(`(async () => {
    const root = document.getElementById('route-exam');
    return JSON.stringify({
      children: root ? root.children.length : -1,
      htmlLen: root ? root.innerHTML.length : -1,
      hasEditor: !!document.getElementById('code-result'),
      hasSubs: !!document.getElementById('code-subs')
    });
  })()`);
  console.log('DOM:', dom);

  // 5) 手动调 renderCodeView 再抓一次
  const direct = await evalJs(`(async () => {
    try {
      await renderCodeView(document.getElementById('route-exam'));
      return 'OK children=' + document.getElementById('route-exam').children.length;
    } catch (e) {
      return 'THREW: ' + (e && e.stack ? e.stack.split('\\n').slice(0,4).join(' | ') : e);
    }
  })()`);
  console.log('DIRECT:', direct);

  console.log('EXCEPTIONS(' + exceptions.length + '):');
  exceptions.slice(0, 5).forEach((e) => console.log('  ❌', String(e).slice(0, 500)));
  console.log('CONSOLE_ERR(' + consoleErrs.length + '):');
  consoleErrs.slice(0, 5).forEach((e) => console.log('  ⚠', String(e).slice(0, 300)));

  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
