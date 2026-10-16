'use strict';

// ============================================================
//  招聘平台投递记录同步（主进程侧）
//
//  为什么不是「爬 HTML」：
//    招聘平台的投递记录在登录态后面，前端自己会带着 cookie、token 和
//    请求签名去调它自己的数据接口。我们**不逆向签名、不伪造请求**，
//    而是开一个独立窗口让平台页面自己完成鉴权与请求，再用一个轻量
//    preload 钩住页面自己的 fetch / XMLHttpRequest，把它**自己发出去的
//    JSON 响应**抄一份回主进程。
//
//  关键设计：不硬编码「投递记录页」深链接。
//    2026-10-11 实测：zhipin 的 /web/geek/job/apply 直接 302 到 404 页，
//    zhaopin / 51job / shixiseng / liepin 的记录页全部被重定向回首页或登录页。
//    一旦写死深链接，平台改版后用户只能看到一个空白窗口，还查不出原因。
//    所以改成：
//      打开窗口 → 只加载实测可达的**首页** → 用户在窗口里登录并自己点进
//      「投递记录」页 → 页面自然发出的数据请求被**持续累积** → 用户点抓取时才归一化。
//    这样无论平台怎么改版，只要用户能看到记录，我们就能读到。
//
//  边界：
//    - 每个平台一个独立持久化分区（persist:jobsync-<id>），互不串 cookie
//    - 只读：全程不向平台提交任何写操作（不投递、不取消、不修改）
//    - 抓不到就明确说清是「没登录 / 页面空白 / 撞滑块 / 改版」，绝不编造记录
//    - 记录只在用户勾选确认后才落库（复用 applications:importAuthorized）
//
//  纯逻辑（平台表 / 响应体归一化）在 job-sync-core.ts，本文件只管窗口与采集。
// ============================================================

import { app, BrowserWindow, BrowserView, session, ipcMain } from 'electron';
import type { Session, WebContents } from 'electron';
import fs from 'fs';
import path from 'path';

import { SYNC_PLATFORMS, findPlatform, extractRecords, filterBodiesByTab as coreFilterBodiesByTab } from './job-sync-core';
import type { SyncPlatform, SyncRecord } from './job-sync-core';

export { SYNC_PLATFORMS, findPlatform, extractRecords };
export type { SyncPlatform, SyncRecord };

// ---------------- 分区 ----------------
function partitionOf(platformId: string): string {
  return 'persist:jobsync-' + platformId;
}

function sessionOf(platformId: string): Session {
  return session.fromPartition(partitionOf(platformId));
}

// ---------------- 同步会话（窗口 + 持续累积捕获） ----------------
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** 累积响应条数上限：够覆盖分页，又不会把内存吃满 */
const MAX_CAPTURED = 400;

/** 注入到平台页面的采集 preload 路径（开发态与打包态都在 app.asar 内） */
export function capturePreloadPath(): string {
  // 打包态 __dirname = <app.asar>/dist/main，应用根 = <app.asar>；
  // 开发态 __dirname = <项目>/dist/main，应用根 = <项目>。
  // 两种情况下 src/renderer 都在应用根下，且 src/renderer/** 已列入 build.files。
  // （历史 bug：曾写成 __dirname/../renderer，即 dist/renderer —— tsconfig 排除了
  //  src/renderer，该目录不存在，preload 静默加载失败，表现为「已捕获 0 个响应」。）
  return path.join(__dirname, '..', '..', 'src', 'renderer', 'jobsync-capture-preload.js');
}

/**
 * 采集钩子（注入到平台页面**主世界**）。
 *
 * 为什么由主进程用 executeJavaScript 注入，而不是只在 preload 里包 fetch：
 *  1) preload 跑在隔离世界，直接包 window.fetch 包不到页面自己脚本里的 fetch；
 *  2) preload 里用 <script> 注入会受页面 CSP 限制（zhipin 用 nonce+strict-dynamic，
 *     动态插入的无 nonce 脚本会被拦）；
 *  3) 主进程 executeJavaScript 不受页面 CSP 约束，且必然跑在主世界。
 * 注入是幂等的（__grfJobsyncHooked 守卫），每次主框架导航后重注入一次即可。
 * 页面把抓到的 JSON 用 postMessage 抛给隔离世界的 preload，由它转给主进程。
 *
 * 导出仅供测试/诊断使用（smoke-jobsync-capture.js、diag-jobsync-capture.js）。
 */
export const CAPTURE_SCRIPT = [
  '(function(){',
  '  if (window.__grfJobsyncHooked) return;',
  '  window.__grfJobsyncHooked = true;',
  '  window.__grfJobsyncReady = true;',
  '  window.__grfJobsyncHits = { fetch: 0, xhr: 0, report: 0 };',
  '  var MAX = 4194304;',
  '  var CH = "__grf_jobsync_capture";',
  '  function report(url, text) {',
  '    try {',
  '      if (!text) return;',
  '      var s = String(text).trim();',
  '      if (s.length > MAX) return;',
  '      var c = s.charAt(0);',
  '      if (c !== "{" && c !== "[") return;',
  '      window.__grfJobsyncHits.report += 1;',
  '      window.postMessage({ __grfJobsync: CH, url: String(url || ""), body: s }, location.origin);',
  '    } catch (e) {}',
  '  }',
  '  var of = window.fetch;',
  '  if (typeof of === "function") {',
  '    window.fetch = function () {',
  '      var args = arguments;',
  '      var t = args[0];',
  '      var url = typeof t === "string" ? t : ((t && t.url) || "");',
  '      var p = of.apply(this, args);',
  '      try {',
  '        p.then(function (res) {',
  '          window.__grfJobsyncHits.fetch += 1;',
  '          try { res.clone().text().then(function (txt) { report(url, txt); }).catch(function () {}); } catch (e) {}',
  '        }).catch(function () {});',
  '      } catch (e) {}',
  '      return p;',
  '    };',
  '  }',
  '  var open = XMLHttpRequest.prototype.open;',
  '  var send = XMLHttpRequest.prototype.send;',
  '  XMLHttpRequest.prototype.open = function () {',
  '    try { this.__grfUrl = String(arguments[1] || ""); } catch (e) {}',
  '    return open.apply(this, arguments);',
  '  };',
  '  XMLHttpRequest.prototype.send = function () {',
  '    var xhr = this;',
  '    try {',
  '      xhr.addEventListener("load", function () {',
  '        try {',
  '          window.__grfJobsyncHits.xhr += 1;',
  '          var t = xhr.responseType;',
  '          if (t === "" || t === "text") { report(xhr.__grfUrl, xhr.responseText); }',
  '          else if (t === "json" && xhr.response) { report(xhr.__grfUrl, JSON.stringify(xhr.response)); }',
  '        } catch (e) {}',
  '      });',
  '    } catch (e) {}',
  '    return send.apply(this, arguments);',
  '  };',
  '  try { window.postMessage({ __grfJobsyncReady: true, url: location.href }, location.origin); } catch (e) {}',
  '})();'
].join('\n');

interface SyncSession {
  platformId: string;
  win: BrowserWindow;
  view: BrowserView;
  /** 当前平台页面的 webContents，独立于本地诊断容器 */
  platformContents: WebContents;
  /** 累积捕获到的 JSON 响应（跨页面导航保留） */
  bodies: Array<{ url: string; json: unknown; at?: number }>;
  /** 已收录的 URL，避免同一响应重复入库 */
  seen: Set<string>;
  /** 收到采集 IPC 时按 platformId 找到会话用 */
  ipcListener?: (ev: unknown, payload: { url?: string; body?: string }) => void;
  /** 最近一次页面体检结果 */
  page: { title: string; finalUrl: string; bodyText: string; blockReason: string };
  lastError: string;
  /** 用户点击同步窗口右上角 X 时只隐藏，不销毁会话，避免触发应用退出 */
  allowClose: boolean;
  /** 防止空白页一直留在用户面前 */
  emptyPageTimer?: ReturnType<typeof setTimeout>;
  /** 自动抓取模式：窗口全程后台运行，成功或失败前不抢焦点 */
  auto?: boolean;
  /** 自动抓取进度说明（界面可直接展示） */
  statusNote?: string;
  /** 抓取进行中：抓取期间的页面体检兜底定时器一律让路，避免把平台视图卸掉闪诊断页 */
  collecting?: boolean;
  /** 采集钩子是否确认注入到页面主世界（jobsync:probe 回写） */
  mainWorldReady?: boolean;
}

const sessions = new Map<string, SyncSession>();

// preload 在 document-start 用 webFrame.executeJavaScript 注入采集脚本时需要内容，
// 走 sendSync 同步取（单一来源：脚本只在这里维护一份）。
ipcMain.on('jobsync:script', (event) => {
  try { event.returnValue = CAPTURE_SCRIPT; } catch (_) { /* 忽略 */ }
});

function statusPageHtml(platform: SyncPlatform, title: string, message: string): string {
  const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] || c));
  return '<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title>'
    + '<style>html,body{margin:0;height:100%;font-family:Segoe UI,Microsoft YaHei,sans-serif;background:#f7f8fa;color:#20252d}'
    + '.box{box-sizing:border-box;max-width:720px;margin:12vh auto;padding:32px;border:1px solid #dfe3e8;border-radius:12px;background:#fff;box-shadow:0 8px 30px #00000012}'
    + 'h1{font-size:22px;margin:0 0 14px}p{line-height:1.7;color:#59636e}.hint{font-size:13px;color:#7a8490}code{word-break:break-all}</style>'
    + '<main class="box"><h1>' + esc(title) + '</h1><p>' + esc(message) + '</p>'
    + '<p class="hint">平台：' + esc(platform.name) + '<br>入口：<code>' + esc(platform.entryUrl) + '</code></p>'
    + '<p class="hint">窗口没有关闭应用。你可以关闭本窗口后回到主界面重试。</p></main>';
}

// ---------------- 自动抓取（点「抓取」就自己走到记录页） ----------------
const AUTO_WAIT_MS = 12000;
const AUTO_LOGIN_WAIT_MS = 120000;

/**
 * 关键页面候选：2026-10-16 用户截图核实 BOSS 路由。
 * BOSS 的「投递记录」与「感兴趣（收藏）」共用 /web/geek/recommend 页，
 * 靠 tab 参数区分：tab=148 沟通（含已投递）、tab=48 感兴趣（即收藏）。
 * 其余平台用 DOM 发现兜底。
 */
const CANDIDATE_URLS: Record<string, Record<'applied' | 'collected', string[]>> = {
  boss: {
    // 「沟通」页签：站点自己的「已投递」入口
    applied: ['https://www.zhipin.com/web/geek/recommend?tab=148&sub=1', 'https://www.zhipin.com/web/geek/recommend'],
    // 「感兴趣」页签（用户口中的「收藏」）；旧的 /web/geek/collect、/favorite 均不存在
    collected: ['https://www.zhipin.com/web/geek/recommend?tab=48&sub=1', 'https://www.zhipin.com/web/geek/recommend?tab=48']
  },
  zhaopin: {
    applied: ['https://i.zhaopin.com/resume/apply', 'https://i.zhaopin.com/'],
    collected: ['https://i.zhaopin.com/resume/collect', 'https://i.zhaopin.com/']
  },
  '51job': {
    applied: ['https://www.51job.com/userset/my_apply.php', 'https://www.51job.com/'],
    collected: ['https://www.51job.com/userset/my_collect.php', 'https://www.51job.com/']
  },
  shixiseng: {
    applied: ['https://www.shixiseng.com/user/deliver', 'https://www.shixiseng.com/'],
    collected: ['https://www.shixiseng.com/user/collect', 'https://www.shixiseng.com/']
  },
  liepin: {
    applied: ['https://www.liepin.com/zhaopin/', 'https://www.liepin.com/'],
    collected: ['https://www.liepin.com/collect/', 'https://www.liepin.com/']
  }
};

/** 各类页面导航关键词（用于在平台自己的菜单里找入口，命中即点） */
function keywordsFor(kind: 'applied' | 'collected'): string[] {
  return kind === 'collected'
    ? ['我的收藏', '收藏', '感兴趣', '已收藏', '职位收藏']
    : ['投递记录', '已投递', '投递', '沟通过', '已沟通', '我的投递', '申请记录'];
}

/**
 * BOSS recommend 页多页签混流问题：捕获缓冲里可能同时有 tab=148（沟通）
 * 与 tab=48（感兴趣）的响应。过滤规则在 job-sync-core（可单测），
 * 这里只做接线。
 */
function bodiesForKind(
  s: SyncSession,
  kind: 'applied' | 'collected'
): Array<{ url: string; json: unknown; at?: number }> {
  return coreFilterBodiesByTab(s.platformId, kind, s.bodies);
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : '';
}

/**
 * 各平台登录态对应的 cookie 名（实测 + 站点约定）。
 * 匿名访客 cookie（__c、__g、__l、__a、ab_guid、Hm_ 系列、isOHPC、HMACCOUNT 等）
 * 一律不算数——只匹配登录凭证本身。
 */
const LOGIN_COOKIES: Record<string, string[]> = {
  boss: ['__zp_stoken__', 'zp_token', 'geek_auth'],
  zhaopin: ['zhilian_login', 'at', 'rt', 'FECPUID'],
  '51job': ['51job_login', 'userlogin', 'nickname'],
  shixiseng: ['shixiseng_login', 'user_token', 'SESSION'],
  liepin: ['lt_auth', 'user_token', 'XSRF-TOKEN'],
  lagou: ['user_trace_token', 'LGSID', 'login'],
  iguopin: ['iguopin_token', 'user_token'],
  chinahr: ['chinahr_login', 'user_token']
};

/** 是否真的带着登录凭证（而不是一堆匿名访客 cookie） */
function hasLoginCredential(platformId: string, cookieNames: string[]): boolean {
  const keys = LOGIN_COOKIES[platformId];
  if (!keys || !keys.length) return cookieNames.length > 0;
  return cookieNames.some((n) => keys.indexOf(n) >= 0);
}

/** 登录/注册墙的 URL 特征（各平台被弹去登录时的落点） */
const LOGIN_URL_PATTERNS = [
  /login|passport|signin|sign-in|verify|verif|captcha|slider/i,
  /zhipin\.com\/web\/user\//i,      // BOSS 未登录时的落点
  /zhaopin\.com\/login|i\.zhaopin\.com\/login/i,
  /51job\/login|51job\/userset\//i,
  /liepin\.com\/login|liepin\.com\/passport/i,
  /shixiseng\.com\/login/i,
  /lagou\.com\/login|lagou\.com\/frontLogin/i
];

function setNote(s: SyncSession, note: string): void {
  if (s.statusNote === note) return;
  s.statusNote = note;
  // 抓取动辄几十秒到两分钟，进度必须实时推到界面，否则用户面对一个
  // 一直转圈的按钮完全不知道卡在哪（登录等待/查找入口/已抓到几个响应）。
  emitProgress(s);
}

/** 把抓取进度推给应用窗口（同步窗口自己不需要） */
function emitProgress(s: SyncSession): void {
  const payload = {
    platformId: s.platformId,
    note: String(s.statusNote || ''),
    captured: s.bodies.length,
    auto: !!s.auto
  };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send('jobsync:progress', payload);
    } catch (_) { /* 窗口正在关闭 */ }
  }
}

/** 已捕获（且晚于 since）的响应里，有没有能解析成目标类型的记录 */
function hasRecordsSince(s: SyncSession, kind: 'applied' | 'collected', since: number): boolean {
  const fresh = bodiesForKind(s, kind).filter((b) => (b.at || 0) >= since);
  return extractRecords(fresh, kind).length > 0;
}

/** 等页面自己发出数据请求：轮询 + 滚动触发懒加载，拿到就提前返回 */
async function waitForRecords(s: SyncSession, kind: 'applied' | 'collected', since: number, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  let scrolls = 0;
  while (Date.now() < deadline) {
    if (s.win.isDestroyed()) return false;
    if (hasRecordsSince(s, kind, since)) return true;
    if (scrolls < 4) {
      scrolls += 1;
      await executeWithTimeout(s.platformContents, 'window.scrollTo(0, document.body.scrollHeight);', 1500).catch(() => {});
    }
    await waitMs(700);
  }
  return hasRecordsSince(s, kind, since);
}

/** 读页面上的导航入口（不猜选择器：全量扫 <a>，按文字关键词匹配） */
async function findNavTargets(s: SyncSession, entryUrl: string, kind: 'applied' | 'collected'): Promise<string[]> {
  const keywords = keywordsFor(kind);
  const script = `(function(){
    var kws=${JSON.stringify(keywords)};
    var host=${JSON.stringify(hostOf(entryUrl))};
    var out=[];
    var as=document.querySelectorAll('a[href]');
    for(var i=0;i<as.length;i++){
      var a=as[i], text=(a.innerText||a.textContent||'').replace(/\\s+/g,'');
      var href=a.href||'';
      if(!href||href.indexOf('javascript:')===0||href.charAt(0)==='#') continue;
      if(href.indexOf('http')!==0) continue;
      if(host && href.indexOf(host)<0) continue;
      var score=0;
      for(var j=0;j<kws.length;j++){ if(text.indexOf(kws[j])>=0) score++; }
      if(score>0 && text.length<30) out.push({href:href,score:score,text:text});
    }
    out.sort(function(a,b){return b.score-a.score;});
    return out.slice(0,6).map(function(x){return x.href;});
  })();`;
  try {
    const r = await executeWithTimeout(s.platformContents, script, 4000);
    const arr = JSON.parse(String(r));
    return Array.isArray(arr) ? arr.map((x) => String(x)) : [];
  } catch (_) {
    return [];
  }
}

/** 是否被弹到登录/验证墙（登录态失效时最常见） */
async function looksLikeLoginWall(s: SyncSession): Promise<boolean> {
  try {
    await refreshPageState(s);
  } catch (_) { /* 忽略 */ }
  const url = String(s.page.finalUrl || '');
  const title = String(s.page.title || '');
  // 只信 URL 与标题：正文里出现「登录」二字太常见（首页也有一堆登录入口），
  // 用正文判断会把用户按在 120 秒等待上，这是实测过的误报。
  // 标题要连「注册」一起判：BOSS 未登录落点 /web/user/ 的标题是
  // 「【BOSS直聘注册登录】…」，只匹配「登录」开头会漏掉。
  if (LOGIN_URL_PATTERNS.some((re) => re.test(url))) return true;
  if (s.page.blockReason === 'captcha') return true;
  if (/登录|登陆|注册/.test(title)) return true;
  return false;
}

/** 清空缓冲并记录起点，之后只评估新捕获的数据（避免把首页推荐混进来） */
function markNavigationStart(s: SyncSession): number {
  const now = Date.now();
  s.bodies = [];
  s.seen = new Set();
  // 新导航一开始，openSession 留下的「空白页兜底」定时器就失效了：
  // 它晚点触发会把平台视图卸掉、往用户面前闪一个诊断页（抓取途中复现过）。
  if (s.emptyPageTimer) { clearTimeout(s.emptyPageTimer); s.emptyPageTimer = undefined; }
  return now;
}

async function navigateAndWait(s: SyncSession, url: string, kind: 'applied' | 'collected', budgetMs: number): Promise<boolean> {
  const since = markNavigationStart(s);
  setNote(s, '正在打开目标页面…');
  try {
    await s.platformContents.loadURL(url);
  } catch (_) { /* 导航失败按未命中处理，由后续分支给结论 */ }
  return waitForRecords(s, kind, since, budgetMs);
}

/**
 * 自动抓取：自动开窗口 → 自动走到「投递记录 / 收藏」页 → 抓数据。
 * 全程只读：不登录、不代填、不提交任何写操作；需要登录时把窗口交给用户，
 * 用户登录成功后自动继续，不需要再点一次「抓取」。
 *
 * 包一层只为保证 collecting 标志在任何返回路径上都被清掉：
 * 漏清一次，「抓取」按钮的 busy 状态就会永远卡在主进程侧。
 */
async function autoCollect(s: SyncSession, p: SyncPlatform, kind: 'applied' | 'collected'): Promise<CollectResult> {
  try {
    return await autoCollectInner(s, p, kind);
  } finally {
    s.collecting = false;
  }
}

async function autoCollectInner(s: SyncSession, p: SyncPlatform, kind: 'applied' | 'collected'): Promise<CollectResult> {
  s.auto = true;
  s.collecting = true;
  // 后台运行：先起窗口，导航一旦开始就收起，不抢用户焦点。
  try { s.win.showInactive(); } catch (_) { /* 忽略 */ }
  setNote(s, '正在打开 ' + p.name + '…');
  const diag = () => ({
    jsonResponses: s.bodies.length,
    matchedResponses: bodiesForKind(s, kind).filter((b) => extractRecords([b], kind).length > 0).length,
    pageTitle: s.page.title,
    pageUrl: s.page.finalUrl,
    pageState: s.page.blockReason
  });
  const succeed = (): CollectResult => {
    setNote(s, '已抓到数据');
    try { s.win.hide(); } catch (_) { /* 忽略 */ }
    return { ok: true, items: extractRecords(bodiesForKind(s, kind), kind), hint: p.recordHint, diagnostics: diag() };
  };
  const needLogin = (msg: string): CollectResult => ({
    ok: false, needLogin: true, error: msg, hint: p.recordHint, diagnostics: diag()
  });

  // 登录闸门：被弹去登录/注册页时，把窗口交给用户；登录成功后返回 true 继续抓。
  const ensureLoggedIn = async (): Promise<boolean> => {
    if (!(await looksLikeLoginWall(s))) return true;
    setNote(s, '等待登录…（在同步窗口里登录后会自动继续）');
    try { s.win.show(); s.win.focus(); } catch (_) { /* 忽略 */ }
    const deadline = Date.now() + AUTO_LOGIN_WAIT_MS;
    while (Date.now() < deadline && !s.win.isDestroyed()) {
      await waitMs(1500);
      if (!(await looksLikeLoginWall(s))) { setNote(s, '已登录，继续抓取…'); return true; }
    }
    return !(await looksLikeLoginWall(s));
  };

  // 1) 先确保停在平台首页（已打开的会话会保留登录态，不重复导航）
  if (hostOf(s.page.finalUrl) !== hostOf(p.entryUrl)) {
    const since = markNavigationStart(s);
    setNote(s, '正在打开 ' + p.name + ' 首页…');
    try { await s.platformContents.loadURL(p.entryUrl); } catch (_) { /* 忽略 */ }
    await waitForRecords(s, kind, since, 4000).catch(() => {});
    await refreshPageState(s);
  }

  // 2) 首页就是登录墙：等用户登录再继续
  if (!(await ensureLoggedIn())) {
    return needLogin('还没有登录 ' + p.name + '。已在同步窗口里打开登录页，请在窗口里登录（会自动继续）。');
  }

  // 3) 直达候选页（BOSS 等已知路由）；落在登录墙上就等登录后重试同一页
  //    tried 跨步骤共享：DOM 发现阶段不再把 Step 3 已经失败过的直达页重跑一遍
  //    （BOSS 每条候选要等满 12 秒，重复尝试就是白等二十几秒）
  const tried = new Set<string>();
  const direct = (CANDIDATE_URLS[p.id] && CANDIDATE_URLS[p.id][kind]) || [];
  for (const url of direct) {
    tried.add(url);
    if (await navigateAndWait(s, url, kind, AUTO_WAIT_MS)) return succeed();
    if (await looksLikeLoginWall(s)) {
      if (!(await ensureLoggedIn())) {
        return needLogin('打开「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」时需要登录 '
          + p.name + '。已在同步窗口里打开登录页，登录后会自动继续。');
      }
      if (await navigateAndWait(s, url, kind, AUTO_WAIT_MS)) return succeed();
    }
  }

  // 4) DOM 发现：平台改版后深链接会失效，这时从首页菜单里找入口
  setNote(s, '正在查找「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」入口…');
  const entryHost = hostOf(s.page.finalUrl) || hostOf(p.entryUrl);
  const navTargets = await findNavTargets(s, p.entryUrl, kind);
  const seenUrls = new Set<string>();
  for (const url of navTargets) {
    if (seenUrls.has(url) || tried.has(url)) continue;
    seenUrls.add(url);
    if (hostOf(url) !== entryHost) continue; // 只走同站链接
    tried.add(url);
    if (await navigateAndWait(s, url, kind, AUTO_WAIT_MS)) return succeed();
    if (await looksLikeLoginWall(s) && !(await ensureLoggedIn())) {
      return needLogin('打开「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」时需要登录 '
        + p.name + '。已在同步窗口里打开登录页，登录后会自动继续。');
    }
  }

  // 5) 都不命中：把窗口亮出来给用户自己点，同时说清卡在哪
  await refreshPageState(s);
  const onLogin = await looksLikeLoginWall(s);
  setNote(s, '');
  try { s.win.show(); s.win.focus(); } catch (_) { /* 忽略 */ }
  if (onLogin) {
    return needLogin('自动走到了登录/验证页：' + p.name + ' 的登录态可能已失效。请在同步窗口里重新登录，然后重试「抓取」。');
  }
  return {
    ok: false,
    error: '自动打开了 ' + p.name + '，但没有找到「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」页的数据。'
      + '站点可能又改版了：请在同步窗口里手动点进记录页，然后重试「抓取」。',
    hint: p.recordHint,
    diagnostics: diag()
  };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeWithTimeout(contents: WebContents, code: string, ms: number): Promise<boolean> {
  try {
    await Promise.race([
      contents.executeJavaScript(code, true),
      waitMs(ms).then(() => { throw new Error('executeJavaScript timeout'); })
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 执行一段返回 JSON 字符串的脚本，带超时。
 *
 * 为什么必须有超时：平台页面主框架导航挂起时（网络黑洞/站点不响应），
 * executeJavaScript 的 Promise 可能**永远不 resolve**。refreshPageState
 * 没有任何保护时，looksLikeLoginWall / status 会一起卡死 —— 表现为
 * 「抓取」按钮一直转圈、进度停在同一句，用户只能杀进程。
 * 超时后返回 null，调用方保留上一次的体检结果，不猜、不报错。
 */
async function executeJsonWithTimeout(contents: WebContents, code: string, ms: number): Promise<unknown | null> {
  try {
    return await Promise.race([
      contents.executeJavaScript(code, true),
      waitMs(ms).then(() => { throw new Error('executeJavaScript timeout'); })
    ]);
  } catch (_) {
    return null;
  }
}

async function showStatusPage(s: SyncSession, p: SyncPlatform, title: string, message: string): Promise<void> {
  if (s.win.isDestroyed()) return;
  const html = statusPageHtml(p, title, message);
  const script = 'document.open();document.write(' + JSON.stringify(html) + ');document.close();';
  // 本地容器从不加载远端页面，独立导航不会受平台请求影响。
  // 这里不能再调用 loadURL(data:)：即使是本地 data URL，在某些 Chromium/网络
  // 挂起状态下也会让导航 Promise 卡住，窗口最终只剩系统绘制的纯白背景。
  // about:blank 的 webContents 可以直接执行 document.open/write，无需导航。
  // 同样只在确实挂着平台视图时才拆卸，避免重复调用累积内部监听
  if (s.win.getBrowserView()) s.win.setBrowserView(null);
  // 先无条件把窗口显示出来，并同步写一份兜底内容。
  // 之前的 8 秒超时分支调用的正是本函数，而本函数自己会 await 一个卡住的
  // executeJavaScript —— 于是窗口停在 show:false，用户看到"标题栏有、客户区全白"。
  try { s.win.show(); s.win.focus(); } catch (_) { /* 窗口正在关闭 */ }
  for (let i = 0; i < 6 && !s.win.isDestroyed(); i += 1) {
    if (await executeWithTimeout(s.win.webContents, script, 1200)) break;
    await waitMs(180);
  }
  try { s.win.show(); s.win.focus(); } catch (_) { /* 窗口正在关闭 */ }
}

/** 页面体检：识别「空白页 / 滑块验证 / 404」这三类最常见失败 */
function detectBlockReason(title: string, finalUrl: string, bodyText: string): string {
  const t = String(title || '');
  const u = String(finalUrl || '');
  const body = String(bodyText || '');
  if (/404|页面不存在|无法找到|出错|错误/i.test(t) || /\/404|404\.html/i.test(u)) return 'notfound';
  if (/验证|滑动|人机|安全校验|captcha/i.test(t) || /按住滑块|拖动到最右/.test(body)) return 'captcha';
  if (body.replace(/\s+/g, '').length < 30) return 'blank';
  return '';
}

/**
 * 取（或创建）该平台的同步会话并开始持续累积捕获。
 * 刻意用独立 BrowserWindow 而不是内置 <webview>：它不继承应用页面的 CSP，
 * 也不挂我们的 preload —— 平台页面跑的就是它自己的脚本，边界更干净。
 */
async function openSession(p: SyncPlatform): Promise<{ session: SyncSession; error?: string }> {
  const existing = sessions.get(p.id);
  if (existing && !existing.win.isDestroyed()) {
    if (!existing.win.isVisible()) existing.win.show();
    existing.win.focus();
    return { session: existing };
  }

  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    // 本地容器先显示；第三方页面放进独立 BrowserView，不能清空容器页面。
    show: false,
    title: p.name + ' · 同步窗口',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  if (process.env.GRF_JOBSYNC_DEBUG) {
    console.log('[jobsync] openSession 新建同步窗口 platform=' + p.id
      + ' sessions=' + sessions.size
      + ' closedListeners=' + win.listenerCount('closed'));
  }
  // Electron 内部（setBrowserView / 视图挂载）也会往窗口上追加 'closed' 监听，
  // 长会话多次导航后可能越过默认 10 个的上限刷 MaxListenersExceededWarning。
  // 同步窗口生命周期内监听数量本就该远超 10，直接抬高上限。
  win.setMaxListeners(0);
  const view = new BrowserView({
    webPreferences: {
      partition: partitionOf(p.id),
      preload: capturePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 需要能读 ipcRenderer 才能把抓到的响应回传主进程；
      // sandbox:true 下 preload 仍可 require('electron')，保持沙箱更安全。
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 1040, height: 0 });
  view.setAutoResize({ width: true, height: false });
  // 初始阶段平台视图不占用可见区域，直到本地加载页已经完成绘制；
  // 这样第三方导航无论如何挂起，都不会把窗口变成纯白。
  // 注意：setBrowserView 每次调用都会在窗口上挂内部监听，
  // 重复调用会累积到触发 MaxListenersExceededWarning（11 closed listeners）。
  // 已挂同视图时只更新 bounds，不再重复 setBrowserView。
  const showPlatformView = (): void => {
    if (!win.isDestroyed() && !platformContents.isDestroyed()) {
      if (win.getBrowserView() !== view) win.setBrowserView(view);
      const [width, height] = win.getContentSize();
      view.setBounds({ x: 0, y: 0, width, height });
    }
  };
  const hidePlatformView = (): void => {
    if (!win.isDestroyed()) view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  };
  const platformContents = view.webContents;
  // 平台视图只在目标导航完成后显示，不能监听初始 about:blank 的完成事件。
  // 去掉 Electron 默认的 File/Edit/View/Window/Help 菜单栏：
  // 这是个给用户看平台页面的窗口，顶上挂一排应用菜单既没意义也让人以为点错了
  win.setMenu(null);

  const s: SyncSession = {
    platformId: p.id,
    win,
    view,
    platformContents,
    bodies: [],
    seen: new Set(),
    page: { title: '', finalUrl: '', bodyText: '', blockReason: '' },
    lastError: '',
    allowClose: false,
    auto: false,
    statusNote: '',
    mainWorldReady: false
  };
  sessions.set(p.id, s);

  // ---- 数据采集：页面内注入 fetch/XHR 钩子（不用 CDP）----
  //
  // 为什么放弃 CDP：实测 debugger.attach('1.3') 之后，该 webContents 的
  // 首帧产出与脚本执行通道会一起冻结 —— loadURL 永不 resolve、executeJavaScript
  // 永不返回、连 win.show() 都会阻塞主进程。表现就是纯白窗口。
  // 改用 preload 注入钩子：页面自己发的每个 XHR/fetch 响应都被记下来，
  // 完全不碰调试器，窗口渲染与导航都不受影响。
  s.ipcListener = (_ev, payload) => {
    if (!payload || typeof payload.body !== 'string') return;
    const body = payload.body;
    if (body.length > MAX_BODY_BYTES) return;
    const head = body.trimStart().charAt(0);
    if (head !== '{' && head !== '[') return; // 只收 JSON
    const url = String(payload.url || '');
    if (s.seen.has(url) && s.bodies.some((b) => b.url === url)) {
      // 同一 URL 已有记录则覆盖最新一份（价格/状态这类字段会变）
      const idx = s.bodies.findIndex((b) => b.url === url);
      if (idx >= 0) { try { s.bodies[idx] = { url, json: JSON.parse(body), at: Date.now() }; } catch (_) { /* 忽略 */ } }
      return;
    }
    try {
      const json = JSON.parse(body);
      s.seen.add(url);
      s.bodies.push({ url, json, at: Date.now() });
      if (s.bodies.length > MAX_CAPTURED) s.bodies.splice(0, s.bodies.length - MAX_CAPTURED);
    } catch (_) { /* 非合法 JSON，丢弃 */ }
  };
  ipcMain.on('jobsync:captured', s.ipcListener as never);
  // 页面主世界回执：确认采集钩子真的挂上了（contextIsolation 下必须注入主世界）
  const probeListener = (_ev: unknown, payload: { ready?: boolean; url?: string }) => {
    s.mainWorldReady = !!(payload && payload.ready);
  };
  ipcMain.on('jobsync:probe', probeListener as never);

  win.on('close', (event) => {
    // 同步窗口不是应用主窗口：用户点 X 只隐藏，绝不能让 window-all-closed 误判为应用退出。
    // 真正退出时 closeAll() 会先置 allowClose，再调用 destroy/close。
    if (!s.allowClose) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (s.emptyPageTimer) clearTimeout(s.emptyPageTimer);
    if (s.ipcListener) {
      try { ipcMain.removeListener('jobsync:captured', s.ipcListener as never); } catch (_) { /* 忽略 */ }
    }
    try { ipcMain.removeListener('jobsync:probe', probeListener as never); } catch (_) { /* 忽略 */ }
    sessions.delete(p.id);
  });

  // ---- 采集注入：主进程侧执行，不受页面 CSP 约束 ----
  // preload 只负责「把页面主世界的 postMessage 转给主进程」，钩子本身由这里注入。
  // 每次主框架导航后重注入一次；脚本自带幂等守卫，重复注入无副作用。
  const injectCapture = (): void => {
    if (s.win.isDestroyed() || platformContents.isDestroyed()) return;
    // 不 await：个别网络挂起状态下 executeJavaScript 可能长时间不返回，
    // 用超时竞速丢开即可，绝不让它卡住导航链路。
    void executeWithTimeout(platformContents, CAPTURE_SCRIPT, 2500).catch(() => { /* 忽略 */ });
  };
  platformContents.on('dom-ready', injectCapture);
  platformContents.on('did-frame-finish-load', (_e, isMainFrame) => {
    if (isMainFrame) injectCapture();
  });
  platformContents.on('did-navigate', injectCapture);
  platformContents.on('did-navigate-in-page', injectCapture);

  // ---- 导航失败必须能报出来，不能白屏了事 ----
  let navFailed = '';
  // 关键：只要主框架开始产出首帧就立刻把平台视图显示出来。
  // 之前只在 did-finish-load 才显示，而招聘首页常年带大量异步请求/长连接，
  // did-finish-load 可能十几秒都不来 —— 用户在这段时间里看到的正是
  // 「标题栏有、客户区全白」。页面的首帧是可以立即显示的，不该再等。
  const revealOnFirstPaint = (): void => { showPlatformView(); };
  platformContents.on('dom-ready', revealOnFirstPaint);
  platformContents.on('did-frame-finish-load', (_e, isMainFrame) => {
    if (isMainFrame) revealOnFirstPaint();
  });
  platformContents.on('did-finish-load', revealOnFirstPaint);
  platformContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* -3 = ERR_ABORTED，用户自己中断的，不算错 */) {
      navFailed = '页面加载失败（' + desc + '，错误码 ' + code + '）';
    }
  });

  // ---- 顺序在这里是决定性的，也是"白屏"的真正根因 ----
  //
  // 反直觉但可复现：一旦先 debugger.attach() 再导航，该 webContents 的首帧就再也
  // 不会产出。于是 loadURL 的 Promise 永不 resolve、主进程首帧等待把事件循环卡死
  // （实测 setImmediate / setTimeout 全不触发），window 停在 show:false ——
  // 用户看到的就是"标题栏有、客户区全白"。
  //
  // 现在全程不再使用 CDP：窗口先显示、平台导航在其后进行、采集靠 preload 钩子。
  if (process.env.GRF_JOBSYNC_DEBUG) console.log('[jobsync] show window before navigation');
  try { win.show(); win.focus(); } catch (_) { /* 窗口正在关闭 */ }
  void showStatusPage(s, p, '正在打开 ' + p.name,
    '正在加载平台首页。网络较慢时请稍候，页面失败会显示具体原因。');
  // 本地诊断页写入后仍保持平台视图隐藏；平台视图只有 did-finish-load 才会显示。
  hidePlatformView();

  // 导航超时必须在调用 loadURL 前启动：某些网络失败会让 loadURL 一直 pending，
  // 若把定时器放在 await 后面，诊断页永远没有机会显示。
  let timedOut = false;
  s.emptyPageTimer = setTimeout(async () => {
    if (s.win.isDestroyed() || s.collecting) return;
    timedOut = true;
    const msg = '平台首页加载超过 8 秒。可能是网络不可达、站点拦截或页面响应挂起。';
    s.lastError = msg;
    // 终止独立平台视图中的挂起导航；本地容器页面不会被清空。
    try { platformContents.stop(); } catch (_) { /* 窗口正在关闭 */ }
    hidePlatformView();
    await showStatusPage(s, p, '平台页面加载超时', msg);
  }, 8000);
  s.emptyPageTimer.unref?.();

  try {
    // 平台视图尚未挂载到窗口，但它的 webContents 依然会正常导航。
    await Promise.race([
      platformContents.loadURL(p.entryUrl),
      new Promise<void>((resolve) => setTimeout(resolve, 8500))
    ]);
  } catch (err) {
    const msg = String((err as Error).message || err);
    // ERR_ABORTED 常见于页面内部跳转/被站点脚本取消，不当失败处理
    if (!/ERR_ABORTED|\(-3\)/.test(msg)) navFailed = '打开入口页失败：' + msg;
  }
  if (s.emptyPageTimer) { clearTimeout(s.emptyPageTimer); s.emptyPageTimer = undefined; }
  if (!timedOut && navFailed) {
    s.lastError = navFailed;
    hidePlatformView();
    await showStatusPage(s, p, '平台页面加载失败', navFailed);
  } else if (!timedOut) {
    // loadURL 已返回但页面可能仍是空 document，再做一次体检。
    // 注意：窗口可能已失去焦点并被 Chromium 冻结渲染，此时 innerText 会误报为空，
    // 所以只要「标题非空」或「已有捕获」就认定页面起来了，不显示误导性的诊断页。
    s.emptyPageTimer = setTimeout(async () => {
      if (s.win.isDestroyed() || s.collecting) return;
      await refreshPageState(s);
      const hasTitle = !!(s.page.title && s.page.title.trim());
      if (s.page.blockReason === 'blank' && !hasTitle && s.bodies.length === 0) {
        const msg = '平台首页没有返回可显示内容。可能是网络不可达、站点拦截或页面仍在加载。';
        s.lastError = msg;
        hidePlatformView();
        await showStatusPage(s, p, '平台页面为空', msg);
      }
    }, 2500);
  }
  return { session: s };
}

/** 刷新页面体检结果（标题/正文/是否撞验证或 404） */
async function refreshPageState(s: SyncSession): Promise<void> {
  try {
    s.page.finalUrl = s.platformContents.getURL();
    s.page.title = s.platformContents.getTitle();
  } catch (_) { /* 窗口已销毁 */ }
  const r = await executeJsonWithTimeout(s.platformContents,
    'JSON.stringify({ text: (document.body ? document.body.innerText : "").slice(0, 400) })', 2500);
  if (r == null) {
    // 导航挂起时拿不到正文：保留上一次的体检结果，绝不给用户误报「空白页」
    return;
  }
  try {
    const parsed = JSON.parse(String(r));
    s.page.bodyText = String((parsed && parsed.text) || '');
  } catch (_) {
    s.page.bodyText = '';
  }
  s.page.blockReason = detectBlockReason(s.page.title, s.page.finalUrl, s.page.bodyText);
}

// ---------------- 对外操作 ----------------
export interface PlatformStatus {
  id: string;
  name: string;
  syncable: boolean;
  note: string;
  entryUrl: string;
  recordHint: string;
  /** 同步窗口是否已打开 */
  open: boolean;
  /** 是否已有登录态（只看 cookie，不额外发请求） */
  loggedIn: boolean;
  cookieCount: number;
  /** 已累积捕获到的 JSON 响应数 */
  captured: number;
  /** 页面体检：'' 正常，其余为 notfound / captcha / blank */
  pageState: string;
  pageTitle: string;
  pageUrl: string;
  /** 自动抓取进度说明（正在打开首页 / 查找入口 / 等待登录…） */
  statusNote: string;
  /** 打开窗口/加载页面时的错误 */
  error: string;
  lastSyncAt: number;
  lastCount: number;
}

export async function status(platformId: string): Promise<PlatformStatus | null> {
  const p = findPlatform(platformId);
  if (!p) return null;
  const s = sessions.get(p.id);
  const open = !!(s && !s.win.isDestroyed());
  if (open && s) await refreshPageState(s);

  let cookieCount = 0;
  let cookieNames: string[] = [];
  try {
    const cookies = await sessionOf(p.id).cookies.get({});
    cookieCount = cookies.length;
    cookieNames = cookies.map((c) => String(c.name || ''));
  } catch (_) { /* 忽略 */ }
  // 登录态不能只看「有没有 cookie」：每个站点都会先塞一堆匿名访客 cookie
  // （__c/__g/ab_guid/Hm_*/isOHPC…），按数量判断会把没登录的用户显示成已登录，
  // 于是用户直接点抓取、拿到空结果，还以为是平台改版。必须匹配登录凭证本身。
  const loggedIn = hasLoginCredential(p.id, cookieNames);
  const state = readSyncState()[p.id];

  return {
    id: p.id,
    name: p.name,
    syncable: p.syncable,
    note: p.note || '',
    entryUrl: p.entryUrl,
    recordHint: p.recordHint,
    open,
    loggedIn,
    cookieCount,
    captured: open && s ? s.bodies.length : 0,
    pageState: open && s ? s.page.blockReason : '',
    pageTitle: open && s ? s.page.title : '',
    pageUrl: open && s ? s.page.finalUrl : '',
    statusNote: open && s ? String(s.statusNote || '') : '',
    error: (open && s && s.lastError) || '',
    lastSyncAt: (state && state.lastSyncAt) || 0,
    lastCount: (state && state.lastCount) || 0
  };
}

export async function statusAll(): Promise<PlatformStatus[]> {
  const out: PlatformStatus[] = [];
  for (const p of SYNC_PLATFORMS) {
    const st = await status(p.id);
    if (st) out.push(st);
  }
  return out;
}

/** 打开同步窗口：只加载实测可达的首页，之后由用户自己走到记录页 */
export async function open(platformId: string): Promise<{ ok: boolean; error?: string; hint?: string }> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  const { session: s, error } = await openSession(p);
  await refreshPageState(s);
  if (error) return { ok: false, error, hint: p.recordHint };
  if (s.page.blockReason === 'notfound') {
    return { ok: false, error: '入口页返回「页面不存在」，站点结构可能已调整', hint: p.recordHint };
  }
  if (s.page.blockReason === 'captcha') {
    return { ok: false, error: '页面要求人机验证：请在同步窗口里拖动滑块通过，然后重试', hint: p.recordHint };
  }
  return { ok: true, hint: p.recordHint };
}

export interface CollectResult {
  ok: boolean;
  items?: SyncRecord[];
  error?: string;
  needLogin?: boolean;
  hint?: string;
  diagnostics?: { jsonResponses: number; matchedResponses: number; pageTitle: string; pageUrl: string; pageState: string };
}

/**
 * 抓取数据。
 *
 * 两种模式：
 *  - auto=true ：点「抓取投递记录 / 抓取收藏」即自动开窗口、自动走到对应页面抓取，
 *                全程后台运行，不需要用户手动调出界面、也不需要自己点进记录页。
 *  - auto=false：老的手动模式 —— 沿用用户已经翻到的页面里累积捕获到的数据。
 * 注意：手动模式不重新加载页面，完全依赖用户已经在该窗口里翻到的记录页所发出的请求。
 */
export async function collect(platformId: string, kind: 'applied' | 'collected', auto = false): Promise<CollectResult> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  if (!p.syncable) return { ok: false, error: p.name + '：' + p.recordHint };

  const s = sessions.get(p.id);
  if (!s || s.win.isDestroyed()) {
    // 自动模式：用户没开过窗口也照样抓 —— 这里直接开一个后台会话
    if (auto) {
      const opened = await openSession(p);
      if (opened.error || !opened.session) return { ok: false, error: opened.error || '无法打开同步窗口', hint: p.recordHint };
      const s2 = opened.session;
      await refreshPageState(s2);
      return autoCollect(s2, p, kind);
    }
    return { ok: false, error: '同步窗口还没打开。请先点「打开同步窗口」，登录并进入记录页。', hint: p.recordHint };
  }
  await refreshPageState(s);
  if (auto) return autoCollect(s, p, kind);
  // 手动抓取同样要占住 collecting：用户点开窗口后 2.5 秒内就点抓取时，
  // 空白页兜底定时器还在跑，不占住它会把平台视图卸掉闪诊断页。
  s.collecting = true;
  try {
    return collectFromOpenPage(s, p, kind);
  } finally {
    s.collecting = false;
  }
}

/** 手动模式：沿用用户已经翻到的页面里累积捕获到的数据（不重新加载页面） */
function collectFromOpenPage(s: SyncSession, p: SyncPlatform, kind: 'applied' | 'collected'): CollectResult {
  const diag = {
    jsonResponses: s.bodies.length,
    matchedResponses: 0,
    pageTitle: s.page.title,
    pageUrl: s.page.finalUrl,
    pageState: s.page.blockReason
  };

  if (s.page.blockReason === 'notfound') {
    return { ok: false, error: '当前窗口停在「页面不存在」上，请回到平台首页再走进投递记录页。', hint: p.recordHint, diagnostics: diag };
  }
  if (s.page.blockReason === 'captcha') {
    return { ok: false, error: '当前窗口停在人机验证页：请在窗口里拖动滑块通过，再点抓取。', hint: p.recordHint, diagnostics: diag };
  }

  const scoped = bodiesForKind(s, kind);
  const items = extractRecords(scoped, kind);
  diag.matchedResponses = scoped.filter((b) => extractRecords([b], kind).length > 0).length;

  if (items.length === 0) {
    if (scoped.length === 0 && s.bodies.length > 0) {
      // 缓冲非空但全被页签过滤掉了：用户停在另一个页签上
      return {
        ok: false,
        error: '捕获到的都是「' + (kind === 'collected' ? '沟通/已投递' : '感兴趣') + '」页签的数据，不是目标页签。'
          + '请在同步窗口里切到「' + (kind === 'collected' ? '感兴趣（收藏）' : '沟通') + '」页签后再点抓取。',
        hint: p.recordHint,
        diagnostics: diag
      };
    }
    if (s.bodies.length === 0) {
      return {
        ok: false,
        needLogin: true,
        error: '还没有捕获到任何数据请求。最常见的原因是尚未登录，或还没点到「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」页面。',
        hint: p.recordHint,
        diagnostics: diag
      };
    }
    return {
      ok: false,
      error: '已捕获 ' + s.bodies.length + ' 个数据响应，但里面没有识别出' + (kind === 'collected' ? '收藏' : '投递') + '记录。'
        + '请确认窗口里打开的确实是「' + (kind === 'collected' ? '我的收藏' : '投递记录') + '」页，而不是首页或职位搜索页。',
      hint: p.recordHint,
      diagnostics: diag
    };
  }
  return { ok: true, items, hint: p.recordHint, diagnostics: diag };
}

/** 清空累积缓冲：换账号或走错页面时用，避免把旧数据一起带进来 */
export function reset(platformId: string): { ok: boolean; error?: string } {
  const s = sessions.get(platformId);
  if (!s || s.win.isDestroyed()) return { ok: false, error: '同步窗口未打开' };
  s.bodies = [];
  s.seen = new Set();
  s.lastError = '';
  s.auto = false;
  s.statusNote = '';
  emitProgress(s); // 界面上的抓取进度行随之清空
  return { ok: true };
}

export function close(platformId: string): { ok: boolean } {
  const s = sessions.get(platformId);
  if (s && !s.win.isDestroyed()) {
    s.allowClose = true;
    s.win.close();
  }
  return { ok: true };
}

export function closeAll(): void {
  for (const id of Array.from(sessions.keys())) close(id);
}

/** 解除该平台的登录态：清空整个分区的存储并关闭窗口 */
export async function logout(platformId: string): Promise<{ ok: boolean; error?: string }> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  try {
    close(platformId);
    const ses = sessionOf(platformId);
    await ses.clearStorageData();
    await ses.clearCache();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: '清除登录态失败：' + ((err as Error).message || err) };
  }
}

// ---------------- 上次同步时间（落盘，供界面显示） ----------------
const stateFile = (): string =>
  path.join(app.getPath('userData'), 'grad-resume-data', 'job-sync-state.json');

export function readSyncState(): Record<string, { lastSyncAt: number; lastCount: number }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function writeSyncState(platformId: string, count: number): void {
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const state = readSyncState();
    state[platformId] = { lastSyncAt: Date.now(), lastCount: count };
    const tmp = file + '.tmp'; // 原子写：断电不会留下半截 JSON
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (_) { /* 写状态失败不影响同步本身 */ }
}
