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
// 渲染层不止 app.js：map-view.js 等模块也会调 window.api。
// 只扫 app.js 会把「在新模块里正常调用的接口」误报成「暴露了没人调用」。
const rendererSrc = fs.readdirSync(path.join(__dirname, 'src', 'renderer'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => R('src/renderer/' + f))
  .join('\n');
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
const calls = new Set([...rendererSrc.matchAll(/window\.api\.(\w+)\.(\w+)\(/g)].map((m) => m[1] + '.' + m[2]));
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

// ---------- 3.5) 招聘平台同步：采集链路 ----------
// 2026-10-13 三次回归，任何一条再犯都会退回「已捕获 0 个响应」：
//  ① preload 路径写成 dist/renderer（tsconfig 排除 src/renderer，目录不存在）→ preload 静默失败
//  ② preload 里直接包 window.fetch（隔离世界包不到页面主世界的 fetch）
//  ③ 用 event.source !== window 过滤消息（两个世界的 window 不是同一对象，全丢）
const jobsyncPreload = R('src/renderer/jobsync-capture-preload.js');
const jobsyncMain = R('src/main/job-sync.ts');
assert(!/createElement\('script'\)/.test(jobsyncPreload),
  'preload 不用 <script> 注入（会被页面 CSP 拦掉，且重复实现易漂移）');
assert(!/event\.source !== window/.test(jobsyncPreload),
  'preload 不用 event.source 过滤消息（否则主世界采集消息全被丢弃）');
assert(/webFrame\.executeJavaScript/.test(jobsyncPreload),
  'preload 在 document-start 用 webFrame 把钩子注入页面主世界（早于页面自己的脚本）');
assert(/ipcRenderer\.sendSync\('jobsync:script'\)/.test(jobsyncPreload),
  'preload 通过 sendSync 取采集脚本（单一来源，不与主进程各写一份）');
assert(/__grfJobsync/.test(jobsyncPreload) && /ipcRenderer\.send\(CHANNEL/.test(jobsyncPreload),
  'preload 负责把主世界 postMessage 转成 IPC 回传主进程');
assert(/jobsync:probe/.test(jobsyncPreload),
  'preload 转发采集脚本的就绪回执');
// preload 路径必须指向 src/renderer（打包态与开发态都在应用根下）
assert(/path\.join\(__dirname, '\.\.', '\.\.', 'src', 'renderer', 'jobsync-capture-preload\.js'\)/.test(jobsyncMain),
  'preload 路径指向 src/renderer（不是不存在的 dist/renderer）');
// 脚本单一来源 + 主进程兜底注入
assert(/const CAPTURE_SCRIPT/.test(jobsyncMain) && /export const CAPTURE_SCRIPT/.test(jobsyncMain),
  '采集钩子脚本由主进程持有并导出（单一来源）');
assert(/ipcMain\.on\('jobsync:script'/.test(jobsyncMain) && /event\.returnValue = CAPTURE_SCRIPT/.test(jobsyncMain),
  '主进程用 sendSync 把采集脚本交给 preload');
assert(/executeWithTimeout\(platformContents, CAPTURE_SCRIPT/.test(jobsyncMain),
  '主进程兜底注入（webFrame 注入被拦时 SPA 数据请求仍接得到）');
assert(/platformContents\.on\('dom-ready', injectCapture\)/.test(jobsyncMain)
  && /platformContents\.on\('did-frame-finish-load'/.test(jobsyncMain)
  && /platformContents\.on\('did-navigate', injectCapture\)/.test(jobsyncMain),
  '每次主框架导航后兜底重注入采集钩子（SPA 路由切换也能接上）');
assert(/responseType[\s\S]{0,140}["']json["']/.test(jobsyncMain),
  'XHR responseType=json 的响应也能被采集');
assert(/__grfJobsyncHooks|__grfJobsyncHooked/.test(jobsyncMain),
  '注入脚本幂等（重复注入不会叠加包装）');
// 自动抓取：collect 支持 auto 模式，且窗口后台运行、不抢焦点
assert(/export async function collect\(platformId: string, kind: 'applied' \| 'collected', auto = false\)/.test(jobsyncMain),
  'collect 支持 auto 参数（点抓取即自动导航）');
assert(/showInactive/.test(jobsyncMain),
  '自动抓取时窗口先后台显示，不抢用户焦点');
assert(/CANDIDATE_URLS/.test(jobsyncMain) && /findNavTargets/.test(jobsyncMain),
  '自动抓取有「已知路由 + DOM 发现」双通道');
assert(/waitForRecords/.test(jobsyncMain),
  '自动抓取会等待页面自己发出数据请求');
assert(!/扫码登录\|请先登录\|立即登录/.test(jobsyncMain),
  '登录墙判定不信正文关键词（否则用户被按在 120 秒等待上）');
// 登录态必须看凭证 cookie，不能看 cookie 数量：站点都会先塞一堆匿名访客 cookie
// （__c/__g/ab_guid/Hm_*/isOHPC），按数量判断会把没登录显示成已登录
assert(/LOGIN_COOKIES/.test(jobsyncMain) && /hasLoginCredential/.test(jobsyncMain),
  '登录态按登录凭证 cookie 判定（不是按 cookie 数量）');
assert(/__zp_stoken__/.test(jobsyncMain),
  'BOSS 的登录凭证 cookie 已纳入判定');
assert(!/loggedIn: cookieCount > 0/.test(jobsyncMain),
  '不再用 cookieCount > 0 冒充登录态');
// 登录闸门：候选页落在登录墙上时等用户登录并重试，而不是直接报「站点改版」
assert(/const ensureLoggedIn = async/.test(jobsyncMain),
  '自动抓取内置登录闸门（等用户登录后自动继续）');
assert(/web\/user\//.test(jobsyncMain),
  'BOSS 未登录落点 /web/user/ 已纳入登录墙识别');
assert(/注册/.test(jobsyncMain),
  '登录墙标题识别覆盖「注册」字样');
const collectCall = [...preloadSrc.matchAll(/collect:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('jobsync:collect'[^\n]*/g)].join('');
assert(/auto/.test(collectCall),
  'preload.collect 透传 auto 参数');
assert(/jobSync\.collect\(String\(platformId \|\| ''\), k, auto === true\)/.test(mainSrc),
  '主进程 handler 把 auto 传给 jobSync.collect');

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

// ---------- 8) 每个路由容器都必须有同名导航按钮（新增路由最容易漏 index.html 那一半）----------
// 动态发现所有 route-xxx 容器，而不是硬编码路由列表 —— 否则新增页面时
// 「容器在、按钮不在」会静默通过（岗位池首次上线就踩过：页面有容器却没入口）。
const routeIds = [...idsInHtml].filter((id) => id.startsWith('route-')).map((id) => id.slice(6));
assert(routeIds.length > 0, 'index.html 至少有一个 route-xxx 容器');
const routesWithoutNav = routeIds.filter((r) => !new RegExp('data-route="' + r + '"').test(htmlSrc));
assert(routesWithoutNav.length === 0,
  '每个路由容器都有同名导航按钮（' + routeIds.length + ' 个路由；缺按钮：' + (routesWithoutNav.join(', ') || '无') + '）');
// 反向：导航按钮指向的路由也必须有容器，避免点了空白
const navRoutes = [...htmlSrc.matchAll(/data-route="([\w-]+)"/g)].map((m) => m[1]);
const navWithoutRoute = [...new Set(navRoutes)].filter((r) => !routeIds.includes(r));
assert(navWithoutRoute.length === 0,
  '每个导航按钮都有对应路由容器（缺容器：' + (navWithoutRoute.join(', ') || '无') + '）');

// navigate() 的「显隐数组」必须覆盖所有路由容器 —— 漏一个就会点了导航却整页空白
// （岗位池上线时正是漏在这里：按钮有、容器有、renderJobs 有，但数组没加 jobs）
const toggleMatch = appSrc.match(/\[([^\]]*)\]\.forEach\(\(r\)\s*=>\s*\{\s*document\.getElementById\('route-'\s*\+\s*r\)/);
assert(!!toggleMatch, 'navigate() 存在批量显隐路由的数组写法');
const toggled = [...toggleMatch[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
const notToggled = routeIds.filter((r) => !toggled.includes(r));
assert(notToggled.length === 0,
  'navigate() 显隐数组覆盖所有路由（漏：' + (notToggled.join(', ') || '无') + '）');

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
const usedCalls = new Set([...rendererSrc.matchAll(/window\.api\.(\w+)\.(\w+)/g)].map((m) => m[1] + '.' + m[2]));
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
  ["agent:run", /assertString\(jdText, LIMITS\.jdText/],
  ["snapshots:save", /assertSize\(profile, LIMITS\.profileJson/],
  ["versions:save", /assertSize\(input\.profile, LIMITS\.profileJson/],
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
assert(/backups:restore[\s\S]{0,1400}sessions\.clear\(\)/.test(mainSrc) &&
  /backups:restore[\s\S]{0,1600}requiresLogin: true/.test(mainSrc),
  '整库恢复后清理内存会话并要求重新登录');
assert(/const safeStem = path\.basename\(String\(suggestedName/.test(mainSrc) &&
  /defaultPath: safeStem \+ '\.pdf'/.test(mainSrc),
  'PDF 导出会净化用户可编辑的默认文件名');
assert(/app\.whenReady\(\)\.then[\s\S]{0,700}\.catch\(\(err\) =>/.test(mainSrc) &&
  /startup-failed/.test(mainSrc) && /showErrorBox\('简历锻造炉无法启动'/.test(mainSrc),
  '启动初始化失败会显示可诊断错误，而不是静默退出');

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

// ---------- 14) 同步面板失败时不能留空壳 ----------
// 实测过：platforms() 失败时，旧实现只弹一个 2.6 秒后自动消失的 toast，
// 面板主体保持空白 —— 用户看到的是「无缘无故的空白面板」，无从排查。
const syncViewSrc = R('src/renderer/job-sync-view.js');
assert(/function errorBox\(/.test(syncViewSrc), '同步面板有失败态渲染（errorBox）');
assert(/body\.appendChild\(errorBox\(errText\)\)/.test(syncViewSrc),
  '同步面板读取失败时把原因写进面板主体（不再只弹 toast 留空壳）');
assert(/jobSync\.platforms !== 'function'/.test(syncViewSrc),
  '同步面板会区分「接口缺失（新旧版本不一致）」与普通业务报错');
assert(/updater\.status\(\)/.test(syncViewSrc),
  '同步面板显示当前运行版本，便于用户自查是否为旧版');

// ---------- 15) 独立同步窗口不能触发应用退出，也不能白屏 ----------
const syncMainSrc = R('src/main/job-sync.ts');
const mainEntrySrc = R('src/main/main.ts');
assert(/show:\s*false/.test(syncMainSrc),
  '同步窗口先隐藏，先渲染本地加载页再展示，避免网络页初始化时出现白屏');
assert(/BrowserView/.test(syncMainSrc) && /platformContents/.test(syncMainSrc),
  '同步窗口使用本地容器与独立平台视图，第三方导航不会清空诊断页');
assert(/showPlatformView/.test(syncMainSrc) && /hidePlatformView/.test(syncMainSrc)
  && /did-finish-load/.test(syncMainSrc),
  '平台视图仅在加载完成后显示，失败或超时恢复本地诊断页');
assert(/win\.on\('close',\s*\(event\)/.test(syncMainSrc) && /event\.preventDefault\(\)[\s\S]{0,100}win\.hide\(\)/.test(syncMainSrc),
  '点击同步窗口 X 只隐藏窗口，不销毁会话');
assert(/statusPageHtml/.test(syncMainSrc) && /正在打开/.test(syncMainSrc),
  '同步窗口有本地加载/诊断页，网络失败时不显示纯白窗口');
assert(/document\.open\(\);document\.write\(/.test(syncMainSrc)
  && /executeWithTimeout/.test(syncMainSrc)
  && !/s\.win\.loadURL\(dataUrl\)/.test(syncMainSrc),
  '诊断页直接写入当前文档并带执行超时，不再依赖第二次 data URL 导航');
assert(/Promise\.race\(\[\s*platformContents\.loadURL\(p\.entryUrl\)/.test(syncMainSrc)
  && /platformContents\.stop\(\)/.test(syncMainSrc),
  '第三方导航有硬超时并会停止挂起请求，诊断页不会被迟到响应覆盖');
assert(/s\.allowClose\s*=\s*true/.test(syncMainSrc),
  '应用真正退出时允许主进程显式关闭同步窗口');
assert(/let isQuitting\s*=\s*false/.test(mainEntrySrc) && /isQuitting\s*=\s*true/.test(mainEntrySrc),
  '主进程用退出标志区分用户关辅助窗口与应用真正退出');

// ---- 采集通道：必须靠 preload 钩子，绝不使用 CDP ----
assert(!/\.debugger\.attach\s*\(/.test(syncMainSrc) && !/attachCapture/.test(syncMainSrc),
  '同步采集不再使用 CDP debugger.attach，避免冻结 webContents 首帧导致纯白窗口');
assert(/preload:\s*capturePreloadPath\(\)/.test(syncMainSrc)
  && /jobsync-capture-preload\.js/.test(syncMainSrc),
  '平台视图通过 preload 注入采集钩子');
assert(/ipcMain\.on\('jobsync:captured'/.test(syncMainSrc)
  && /ipcMain\.removeListener\('jobsync:captured'/.test(syncMainSrc),
  '主进程注册并按会话解绑采集 IPC，会话关闭后不泄漏监听');
// 多平台窗口并存时，ipcMain.on 是全局广播：监听器必须校验 event.sender 是本会话
// 的平台视图，否则 A 平台的响应会串进 B 平台的缓冲（实测审出的串流 bug）。
assert(/sender\.id !== platformContents\.id/.test(syncMainSrc),
  '采集 IPC 与 probe 回执都校验 event.sender 归属，多平台窗口并存时不串数据');
const capturePreloadSrc = fs.readFileSync('src/renderer/jobsync-capture-preload.js', 'utf8');
assert(/'jobsync:captured'/.test(capturePreloadSrc) && /ipcRenderer\.send\(/.test(capturePreloadSrc),
  '采集 preload 负责把主世界消息回传主进程');
// 钩子本体在主进程的 CAPTURE_SCRIPT 里（注入主世界），preload 不再自己包 fetch
assert(/window\.fetch\s*=/.test(syncMainSrc) && /XMLHttpRequest\.prototype\.open/.test(syncMainSrc),
  '采集钩子（fetch/XHR）由主进程脚本持有并注入页面主世界');

assert(/dom-ready/.test(syncMainSrc) && /did-frame-finish-load/.test(syncMainSrc)
  && /revealOnFirstPaint/.test(syncMainSrc),
  '平台视图在主框架开始渲染时就显示，不再死等 did-finish-load（否则首页异步请求期间会长时间白屏）');
assert(/hasTitle/.test(syncMainSrc),
  '页面空内容判定会排除「仅渲染被冻结导致 innerText 为空」的误报（标题非空即视为已加载）');

// ---- 抓取链路的稳健性（自检 bug 回归钉）----
// 1) refreshPageState 的 executeJavaScript 曾无超时：平台导航挂起时
//    looksLikeLoginWall/status 一起卡死，「抓取」按钮永久转圈。
assert(/executeJsonWithTimeout/.test(syncMainSrc) && /refreshPageState[\s\S]{0,600}executeJsonWithTimeout/.test(syncMainSrc),
  '页面体检的 executeJavaScript 带超时，导航挂起不会把抓取流程卡死');
// 2) 空白页兜底定时器曾在抓取途中触发：卸掉平台视图、闪诊断页。
assert(/s\.collecting/.test(syncMainSrc) && /s\.win\.isDestroyed\(\) \|\| s\.collecting/.test(syncMainSrc),
  '抓取进行中（collecting）时空白页兜底定时器让路，不再把平台视图卸掉闪诊断页');
assert(/markNavigationStart[\s\S]{0,400}clearTimeout\(s\.emptyPageTimer\)/.test(syncMainSrc),
  '每次导航开始时作废残留的空白页兜底定时器');
// 3) 自动抓取进度必须实时可观测（曾经只能面对一个转圈的按钮等一两分钟）。
assert(/emitProgress/.test(syncMainSrc) && /webContents\.send\('jobsync:progress'/.test(syncMainSrc),
  '抓取进度通过 jobsync:progress 实时推送给应用窗口');
assert(/onProgress/.test(fs.readFileSync('src/main/preload.ts', 'utf8'))
  && /jobSync\.onProgress/.test(R('src/renderer/job-sync-view.js')),
  'preload 暴露进度订阅、同步面板消费进度并显示实时状态行');
// 4) 候选页去重：DOM 发现阶段不重跑 Step 3 已失败过的直达页（每条白等 12 秒）。
assert(/const tried = new Set<string>\(\)/.test(syncMainSrc) && /tried\.has\(url\)/.test(syncMainSrc),
  '自动抓取的候选 URL 跨步骤去重，失败的直达页不会重跑');

// ---- 授权导入的增量合并：同步只补数据，不抹用户状态 ----
// 曾经的 bug：patch 无条件写 stage/place/url/notes，用户在手盘上推进到「面试中」
// 后一次再同步被打回「已投递」，手填地点/备注被平台回来的空值清空。
assert(/stage: hit \? \(hit\.stage \|\| 'applied'\)/.test(mainEntrySrc),
  '授权导入更新时保留用户已有的阶段（只进不退，不打回「已投递」）');
assert(/place: String\(x\.place[\s\S]{0,80}\|\| \(hit \? hit\.place/.test(mainEntrySrc)
  && /notes: String\(x\.notes[\s\S]{0,80}\|\| \(hit \? hit\.notes/.test(mainEntrySrc),
  '授权导入更新时，平台没给的地点/备注保留用户已填内容');
assert(/place: c\.place \|\| \(hit \? hit\.place/.test(R('src/renderer/job-import.js')),
  '粘贴导入同样遵守「新值为空保留旧值」');
// 时间归一化用本地日期：UTC 会把东八区清晨的投递算成前一天。
assert(/getFullYear\(\) \+ '-' \+ p\(d\.getMonth\(\)/.test(R('src/main/job-sync-core.ts'))
  && !/toISOString\(\)\.slice\(0, 10\)/.test(R('src/main/job-sync-core.ts')),
  '投递时间按本地日期归一化（清晨投递不再显示成昨天）');

// ---- GPU 兜底：没显卡的环境也要能起来 ----
assert(/enable-unsafe-swiftshader/.test(mainEntrySrc) && /'use-angle',\s*'swiftshader'/.test(mainEntrySrc),
  '主进程带 SwiftShader 软件渲染兜底，GPU 不可用时不会因离屏窗口直接崩溃退出');
assert(/render-process-gone/.test(mainEntrySrc),
  '渲染进程异常退出会被记录，不再表现为无声黑屏');

console.log('\n契约自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
