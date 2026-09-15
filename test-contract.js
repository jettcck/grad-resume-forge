'use strict';

// ============================================================
//  契约自测：渲染层 ↔ preload ↔ 主进程 handler ↔ 截图 mock 是否对得上
//
//  为什么需要它：投递看板的 applications:save / applications:delete 曾经
//  「preload 暴露了、主进程没注册」——真实应用里存投递直接报
//  No handler registered，看板实际只读；而 store 测试直接调函数、
//  截图 mock 又把它注册了，两条测试路径都绕过了这个缺口，谁也没发现。
//  这一层静态契约检查就是用来堵这类漏洞的。
// ============================================================
const fs = require('fs');
const path = require('path');

const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const appSrc = R('src/renderer/app.js');
const preloadSrc = R('src/main/preload.ts');
const mainSrc = R('src/main/main.ts');
const mockSrc = R('scripts/screenshot.js');
const iconsSrc = R('src/renderer/icons.js');
const htmlSrc = R('src/renderer/index.html');

// ---------- 1) preload 暴露面 ----------
const nsBlocks = [...preloadSrc.matchAll(/^  (\w+):\s*\{$/gm)].map((m) => m[1]);
const exposed = new Set();
nsBlocks.forEach((ns) => {
  const start = preloadSrc.indexOf('  ' + ns + ': {');
  const rest = preloadSrc.slice(start + 1);
  const nextIdx = rest.search(/\n  \w+: \{/);
  const block = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
  [...block.matchAll(/^\s{4}(\w+):/gm)].forEach((m) => exposed.add(ns + '.' + m[1]));
});
assert(exposed.size > 30, 'preload 暴露 ' + exposed.size + ' 个方法');

// ---------- 2) 渲染层调用的接口都必须在 preload 里 ----------
const calls = new Set([...appSrc.matchAll(/window\.api\.(\w+)\.(\w+)\(/g)].map((m) => m[1] + '.' + m[2]));
const missingExpose = [...calls].filter((c) => !exposed.has(c));
assert(missingExpose.length === 0,
  '渲染层调用的接口都已暴露（缺：' + (missingExpose.join(', ') || '无') + '）');

// ---------- 3) preload 用的每个 channel 都必须在 main 注册 ----------
// 这是本次真正抓到 bug 的那一条
const preChannels = new Set([...preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]));
const mainHandles = new Set([...mainSrc.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1]));
const missingHandler = [...preChannels].filter((ch) => !mainHandles.has(ch));
assert(missingHandler.length === 0,
  'preload 用到的 ' + preChannels.size + ' 个 channel 全部已在主进程注册（缺：' + (missingHandler.join(', ') || '无') + '）');

// ---------- 4) 截图 mock 必须覆盖渲染层会用到的 channel ----------
// 否则 UI 测试会对「未注册的接口」视而不见（快照卡与 applications 两次都栽在这里）
const mockChannels = new Set([...mockSrc.matchAll(/\bh\('([^']+)'/g)].map((m) => m[1]));
const chanByApi = {};
[...preloadSrc.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g)].forEach((m) => {
  chanByApi[m[1]] = m[2];
});
const mockMissing = [];
[...calls].forEach((c) => {
  const ch = chanByApi[c.split('.')[1]];
  if (ch && !mockChannels.has(ch)) mockMissing.push(c + ' → ' + ch);
});
assert(mockMissing.length === 0,
  '截图 mock 覆盖渲染层用到的 channel（缺：' + (mockMissing.join(', ') || '无') + '）');

// ---------- 5) 图标名必须存在 ----------
const pathsBlock = iconsSrc.slice(iconsSrc.indexOf('const PATHS'));
const iconNames = new Set([...pathsBlock.matchAll(/^\s{2}(\w+):\s*'/gm)].map((m) => m[1]));
const usedIcons = new Set([
  ...[...appSrc.matchAll(/ico\('(\w+)'/g)].map((m) => m[1]),
  ...[...appSrc.matchAll(/Icons\.icon\('(\w+)'/g)].map((m) => m[1])
]);
const missingIcons = [...usedIcons].filter((n) => !iconNames.has(n));
assert(missingIcons.length === 0,
  '渲染层用到的 ' + usedIcons.size + ' 个图标全部存在（缺：' + (missingIcons.join(', ') || '无') + '）');

// ---------- 6) 顶层重复声明（向后追加代码最容易撞车）----------
const decls = {};
[...appSrc.matchAll(/^(?:function|const|let)\s+(\w+)/gm)].forEach((m) => {
  decls[m[1]] = (decls[m[1]] || 0) + 1;
});
const dups = Object.keys(decls).filter((k) => decls[k] > 1);
assert(dups.length === 0, 'app.js 无顶层重复声明（重复：' + (dups.join(', ') || '无') + '）');

// ---------- 7) 查询的 DOM id 必须存在（HTML 静态 或 JS 动态创建）----------
const idsInHtml = new Set([...htmlSrc.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsCreated = new Set([...appSrc.matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1]));
const idsQueried = new Set([...appSrc.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]));
const missingIds = [...idsQueried].filter((id) => !idsInHtml.has(id) && !idsCreated.has(id));
assert(missingIds.length === 0, '查询的 ' + idsQueried.size + ' 个 id 都存在（缺：' + (missingIds.join(', ') || '无') + '）');

// ---------- 8) 四个路由容器齐全（新增路由最容易漏 index.html 那一半）----------
['profile', 'resume', 'apps', 'interview'].forEach((r) => {
  assert(idsInHtml.has('route-' + r) && new RegExp('data-route="' + r + '"').test(htmlSrc),
    '路由 ' + r + ' 的容器与导航项都在 index.html');
});

// ---------- 9) 通道方向必须与主进程注册方式一致 ----------
// invoke 配 handle、send 配 on。配错了不会报错，只会「消息静默不执行」——
// 比如渲染层 send('embedded:status') 而主进程用 handle 接，状态就永远上不去。
const invokeChans = new Map(); // channel -> 'ns.method'
const sendChans = new Map();
nsBlocks.forEach((ns) => {
  const start = preloadSrc.indexOf('  ' + ns + ': {');
  const rest = preloadSrc.slice(start + 1);
  const nextIdx = rest.search(/\n  \w+: \{/);
  const block = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
  [...block.matchAll(/^\s{4}(\w+):\s*(?:async\s*)?\([^)]*\)\s*=>\s*ipcRenderer\.(invoke|send)\('([^']+)'/gm)]
    .forEach((m) => {
      const target = m[2] === 'invoke' ? invokeChans : sendChans;
      target.set(m[3], ns + '.' + m[1]);
    });
});
const mainHandled = new Set([...mainSrc.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
const mainOn = new Set([...mainSrc.matchAll(/ipcMain\.on\('([^']+)'/g)].map((m) => m[1]));
const dirBad = [];
[...invokeChans].forEach(([ch, api]) => { if (!mainHandled.has(ch)) dirBad.push(api + ' 用 invoke，但主进程没 handle(' + ch + ')'); });
[...sendChans].forEach(([ch, api]) => { if (!mainOn.has(ch)) dirBad.push(api + ' 用 send，但主进程没 on(' + ch + ')'); });
assert(dirBad.length === 0,
  '通道方向与主进程注册方式一致（invoke↔handle ' + invokeChans.size + ' 个 · send↔on ' + sendChans.size + ' 个；问题：' + (dirBad.join('；') || '无') + '）');

// ---------- 10) 截图 mock 的注册方向也要一致 ----------
// mock 用 handle 去接渲染层的 send，不会报错、只会静默失效，UI 测试会假装通过。
// 只对「渲染层真的会调用」的接口要求 mock —— 没人调的接口不需要在 mock 里存在。
const mockH = new Set([...mockSrc.matchAll(/(?:\bh\(|ipcMain\.handle\()'([^']+)'/g)].map((m) => m[1]));
const mockOn = new Set([...mockSrc.matchAll(/ipcMain\.on\('([^']+)'/g)].map((m) => m[1]));
const mockDirBad = [];
[...invokeChans].forEach(([ch, api]) => { if (calls.has(api) && !mockH.has(ch)) mockDirBad.push(api + '（mock 缺 handle ' + ch + '）'); });
[...sendChans].forEach(([ch, api]) => { if (calls.has(api) && !mockOn.has(ch)) mockDirBad.push(api + '（mock 缺 on ' + ch + '）'); });
assert(mockDirBad.length === 0,
  '截图 mock 的注册方向与主进程一致（问题：' + (mockDirBad.join('；') || '无') + '）');

// ---------- 11) 点击处理引用的函数必须存在（点了没反应）----------
const KEYWORDS = new Set(['async', 'await', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'typeof', 'void', 'this']);
const definedFns = new Set();
[...appSrc.matchAll(/^\s*(?:async\s+)?function\s+(\w+)/gm)].forEach((m) => definedFns.add(m[1]));
[...appSrc.matchAll(/^\s*(?:const|let|var)\s+(\w+)\s*=/gm)].forEach((m) => definedFns.add(m[1]));
[...appSrc.matchAll(/^\s*(\w+):\s*(?:async\s*)?(?:function\b|\()/gm)].forEach((m) => definedFns.add(m[1]));
[...appSrc.matchAll(/^\s*(\w+)\s*\([^)]*\)\s*\{/gm)].forEach((m) => definedFns.add(m[1]));
const clicked = new Set();
[...appSrc.matchAll(/(?:onclick:\s*|addEventListener\('click',\s*)(?:\(\s*\)\s*=>\s*)?(?:async\s+)?(?!\.)([A-Za-z_$][\w$]*)\s*\(/g)]
  .forEach((m) => clicked.add(m[1]));
const BUILTIN = new Set(['alert', 'confirm', 'console', 'window', 'document', 'print', 'String', 'Number', 'JSON', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'call', 'then', 'catch']);
const brokenClicks = [...clicked].filter((n) => !definedFns.has(n) && !BUILTIN.has(n) && !KEYWORDS.has(n));
assert(brokenClicks.length === 0,
  '点击处理引用的 ' + clicked.size + ' 个函数都有定义（缺：' + (brokenClicks.join(', ') || '无') + '）');

// ---------- 12) 不该出现新的「暴露了却没人调用」的接口 ----------
// 这类接口通常是「写了一半忘了接线」，会影响用户对功能是否存在的判断。
// 允许清单里的两个是有意保留的完整实现（无 UI 入口，将来可能接上），不是半成品。
const UNUSED_ALLOW = ['resume.audit', 'snapshots.get'];
const usedCalls = new Set([...appSrc.matchAll(/window\.api\.(\w+)\.(\w+)/g)].map((m) => m[1] + '.' + m[2]));
const unusedApi = [...exposed].filter((k) => !usedCalls.has(k) && !UNUSED_ALLOW.includes(k));
assert(unusedApi.length === 0,
  '没有新增「暴露但渲染层无人调用」的接口（新增：' + (unusedApi.join(', ') || '无') + '）');

// ---------- 13) 用户数据接口必须从主进程会话取 userId ----------
// 「信任 renderer 传来的 userId」等于谁都能报别人的 id 读数据。凡是按账号隔离的接口，
// 都必须出现 sessionUserId(_e)，并且不再把参数直接透传给 store。
const USER_DATA_CHANNELS = [
  'profile:get', 'profile:save',
  'applications:list', 'applications:save', 'applications:delete',
  'snapshots:save', 'snapshots:list', 'snapshots:get', 'snapshots:restore', 'snapshots:delete',
  'versions:list', 'versions:get', 'versions:save', 'versions:rename', 'versions:delete',
  'settings:get', 'settings:save'
];
const authMissing = [];
USER_DATA_CHANNELS.forEach((ch) => {
  const at = mainSrc.indexOf("ipcMain.handle('" + ch + "'");
  if (at < 0) { authMissing.push(ch + '（未注册）'); return; }
  // 取到该 handler 的体（到下一个 ipcMain.handle 之前）
  const next = mainSrc.indexOf('ipcMain.handle(', at + 10);
  const body = mainSrc.slice(at, next < 0 ? mainSrc.length : next);
  if (!/sessionUserId\(_e\)/.test(body)) authMissing.push(ch);
});
assert(authMissing.length === 0,
  USER_DATA_CHANNELS.length + ' 个用户数据接口都从主进程会话取 userId（缺：' + (authMissing.join(', ') || '无') + '）');

// ---------- 14) 高危入口必须有运行时校验（TS 类型运行时不存在）----------
const needValidation = [
  ["profile:save", /assertSize\(profile, LIMITS\.profileJson/],
  ["resume:generate", /assertSize\(profile, LIMITS\.profileJson/],
  ["agent:run", /assertSize\(jdText, LIMITS\.jdText/],
  ["settings:save", /assertSize\(value, LIMITS\.settingJson/],
  ["resume:exportPdf", /assertSize\(html, LIMITS\.exportHtml/],
  ["applications:save", /assertSize\(application, LIMITS\.notes/]
];
const noValidation = needValidation.filter(([ch, re]) => {
  const at = mainSrc.indexOf("ipcMain.handle('" + ch + "'");
  const next = mainSrc.indexOf('ipcMain.handle(', at + 10);
  const body = mainSrc.slice(at, next < 0 ? mainSrc.length : next);
  return !re.test(body);
}).map(([ch]) => ch);
assert(noValidation.length === 0, '高危入口都有体积/形状校验（缺：' + (noValidation.join(', ') || '无') + '）');

// ---------- 15) 密钥不得回显给渲染层 ----------
assert(/function maskAgentConfig/.test(mainSrc) && /maskAgentConfig\(/.test(mainSrc),
  '主进程会把 apiKey 抹掉后再返回给渲染层（只留 hasKey）');
assert(!/return ok\(decryptAgentConfig\(/.test(mainSrc),
  '不存在「把解密后的完整配置直接返回」的路径');
assert(/store\.getSetting<LlmConfig>\('agent', userId\)/.test(mainSrc),
  '保存时按账号读取原有配置，用于「留空 = 保留原密钥」');

// ---------- 16) 单实例锁：数据层没有多进程写队列，双开必须被机制挡住 ----------
// 「别双开」如果只写在 README 里就是口头约定；主进程必须在启动时申请锁，
// 第二实例不初始化任何东西就退出，且已有实例收到 second-instance 会聚焦窗口。
const guardCount = (mainSrc.match(/if \(!gotTheLock\) return;/g) || []).length;
assert(/app\.requestSingleInstanceLock\(\)/.test(mainSrc), '主进程启动即申请单实例锁');
assert(/app\.on\('second-instance'/.test(mainSrc) && /mainWindow\.focus\(\)/.test(mainSrc),
  '已有实例收到二次启动事件时会聚焦已有窗口');
assert(guardCount >= 2, '第二实例的启动回调有守卫：不建窗口、不动数据、不查更新（实际 ' + guardCount + ' 处）');

// ---------- 17) 技能分隔符：渲染层的计数与引擎的解析必须一致 ----------
// 踩过的坑：导入器把技能分节各行用「、」拼起来，行内却是「·」和空格分隔的
// （「教学 语法教学 · 教案设计 · …」）。渲染层只认逗号/顿号 → 数出 2 项，
// 于是「技能 ≥ 4 项」明明够了却一直显示未完成；引擎也按同一套错误规则切，
// 导出的技能区跟着残缺。两处逻辑漂移过一次的东西，就要用测试钉住。
{
  const appSrc2 = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'app.js'), 'utf8');
  const sepLine = appSrc2.match(/const SKILL_SEP_RE = .*;/);
  const fnSrc = appSrc2.match(/function splitSkills\(raw\) \{[\s\S]*?\n\}/);
  assert(!!sepLine && !!fnSrc, '渲染层存在统一的技能分隔符与 splitSkills()');
  if (sepLine && fnSrc) {
    const vm = require('vm');
    const box = { globalThis: {} };
    vm.createContext(box);
    vm.runInContext(sepLine[0] + '\n' + fnSrc[0] + '\nglobalThis.__split = splitSkills;', box);
    const rendererSplit = box.globalThis.__split;
    const engine = require('./dist/main/resume-engine');
    const samples = [
      '教学 语法教学 · 教案设计 · 作业反馈 · 课堂观察 · 课外文化活动',
      'Java, Go, MySQL, Redis',
      'Excel（数据透视 / 函数）、用友 U8、CPA',
      'Machine Learning, CI/CD, Go',
      'Python；SQL｜Tableau\n沟通'
    ];
    const mismatch = samples.filter((s) => {
      const res = engine.generate({ name: 'x', skills: s, education: [{ school: '某大学', major: 'x' }], projects: [], internships: [] }, {});
      return (res.resume.skills || []).length !== rendererSplit(s).length;
    });
    assert(mismatch.length === 0,
      '5 组技能串在渲染层与引擎中切分一致（不一致：' + JSON.stringify(mismatch) + '）');
    assert(rendererSplit('教学 语法教学 · 教案设计 · 作业反馈 · 课堂观察').length === 4,
      '带「·」的技能串按 4 项计（不再整串算 1 项）');
  }
}

console.log('\n契约自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
