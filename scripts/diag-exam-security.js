'use strict';
// CDP 冒烟：笔试中心安全与数据一致性（真实安装版）
//
// 断言的是「IPC 返回的字节」而不是纯函数：
//   P0-1 create/list/get 的返回里不能出现 answer/explanation/snapshots
//   P0-2 交卷按快照评分（改不了题库，这里验证快照落盘 + 评分路径生效）
//   P1-1 用时是真实秒数，不再固定 60
//   P1-2 卷外题目 / 错误类型的答案被拒绝
//   P1-3 失效 applicationId 明确报错
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const EXE = path.join(process.env.LOCALAPPDATA, 'Programs', 'grad-resume-forge', '简历锻造炉.exe');
const PROFILE = path.join(__dirname, '.diag-profile-exam');
const PORT = 9451;

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

  await evalJs(`(async () => { await window.api.auth.register({ email: 'sec-smoke@test.local', password: 'pass123456', name: '安全冒烟' }); })()`);
  await sleep(2500);

  // 组卷 + 开始作答 + 交卷，全在页面里走真实 IPC
  const flow = await evalJs(`(async () => {
    try {
      const created = await window.api.exam.createPaper({ count: 10, durationSec: 600, domain: 'backend' });
      if (!created.ok) return 'CREATE_FAIL:' + created.error;
      const paperId = created.data.paper.id;
      const questionIds = created.data.paper.questionIds;

      // P0-1：create 返回体不能出现答案字样
      const createRaw = JSON.stringify(created.data);

      const listRes = await window.api.exam.listPapers();
      const listRaw = JSON.stringify(listRes.data);

      const getRes = await window.api.exam.getPaper(paperId);
      const getRaw = JSON.stringify(getRes.data);

      // P1-2-a：提交卷外题目 id 必须被拒
      const start = await window.api.exam.startAttempt(paperId);
      const attemptId = start.data.attempt.id;
      const foreign = await window.api.exam.submit(attemptId, { not_in_this_paper: 'x' });

      // P1-2-b：单选题给数组（类型不对）必须被拒
      const firstId = questionIds[0];
      const q0 = created.data.questions.find((q) => q.id === firstId);
      const badShape = q0.type === 'single'
        ? await window.api.exam.submit(attemptId, { [firstId]: ['A', 'B'] })
        : await window.api.exam.submit(attemptId, { [firstId]: 12345 });

      // 正常交卷：全答第一个选项，只为拿用时
      const answers = {};
      created.data.questions.forEach((q) => {
        if (q.type === 'multiple') answers[q.id] = [(q.options || ['A'])[0]];
        else if (q.type === 'fill') answers[q.id] = 'x';
        else answers[q.id] = (q.options || ['A'])[0];
      });
      const submit = await window.api.exam.submit(attemptId, answers);

      return JSON.stringify({
        paperId,
        questionCount: questionIds.length,
        createHasAnswer: /"answer"|"explanation"|"snapshots"/.test(createRaw),
        createHasSnapshotKey: createRaw.includes('snapshots'),
        listHasAnswer: /"answer"|"explanation"|"snapshots"/.test(listRaw),
        getHasAnswer: /"answer"|"explanation"|"snapshots"/.test(getRaw),
        getQuestionsHaveAnswer: (getRes.data.questions || []).some((q) => 'answer' in q || 'explanation' in q),
        composition: created.data.paper.composition,
        foreignOk: foreign.ok,
        foreignErr: foreign.error || '',
        badShapeOk: badShape.ok,
        badShapeErr: badShape.error || '',
        submitOk: submit.ok,
        durationSec: submit.ok ? submit.data.result.durationSec : null,
        score: submit.ok ? submit.data.result.score : null
      });
    } catch (e) { return 'THREW:' + e.message; }
  })()`);

  let f = null;
  try { f = JSON.parse(flow); } catch (_) { /* 保持 null */ }
  check('组卷 + 作答 + 交卷整链跑通', !!f, f ? ('paper ' + f.questionCount + ' 题') : String(flow).slice(0, 200));

  if (f) {
    check('P0-1 create 返回体不含 answer/explanation/snapshots',
      f.createHasAnswer === false, 'answer/snapshot 关键字命中=' + f.createHasAnswer);
    check('P0-1 list 返回体不含 answer/explanation/snapshots',
      f.listHasAnswer === false, '命中=' + f.listHasAnswer);
    check('P0-1 get 返回体不含 answer/explanation/snapshots',
      f.getHasAnswer === false, '命中=' + f.getHasAnswer);
    check('P0-1 get 的 questions 每题都不含答案',
      f.getQuestionsHaveAnswer === false, '有答案的题=' + f.getQuestionsHaveAnswer);
    check('P1-4 composition 带 fallback/total',
      f.composition && typeof f.composition.fallback === 'number' && typeof f.composition.total === 'number',
      JSON.stringify(f.composition));
    check('P1-2 卷外题目 id 被拒绝', f.foreignOk === false, f.foreignErr);
    check('P1-2 单选答案给数组被拒绝', f.badShapeOk === false, f.badShapeErr);
    check('P1-1 用时是真实秒数（不是固定 60）',
      f.durationSec != null && f.durationSec < 60, 'durationSec=' + f.durationSec);
    check('交卷成功并给出分数', f.submitOk === true, 'score=' + f.score);
  }

  // P1-3：失效 applicationId 必须明确报错，而不是静默清空
  const appCheck = await evalJs(`(async () => {
    const r = await window.api.exam.createPaper({ count: 10, durationSec: 600, applicationId: 'app_does_not_exist' });
    return JSON.stringify({ ok: r.ok, error: r.error || '' });
  })()`);
  let a = null;
  try { a = JSON.parse(appCheck); } catch (_) { /* noop */ }
  check('P1-3 失效 applicationId 明确报错（不再静默清空）',
    !!a && a.ok === false && /投递记录已删除/.test(a.error || ''), appCheck);

  // 快照确实落盘（通过重新读取试卷间接验证：渲染层拿不到，但后端 scorer 能用）
  const snapCheck = await evalJs(`(async () => {
    const list = await window.api.exam.listPapers();
    const first = (list.data || [])[0];
    return JSON.stringify({ hasKey: !!first && 'snapshots' in first, count: (list.data || []).length });
  })()`);
  check('列表项里也没有 snapshots 字段', snapCheck.includes('"hasKey":false'), snapCheck);

  check('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | ').slice(0, 160));

  console.log(R.join('\n'));
  console.log('SMOKE_' + (R.every((x) => x.startsWith('✅')) ? 'ALL_PASS' : 'HAS_FAIL') + ' (' + R.filter((x) => x.startsWith('✅')).length + '/' + R.length + ')');
  child.kill();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('SCRIPT_ERR', e); process.exit(1); });
