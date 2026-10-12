'use strict';

// ============================================================
//  招聘平台投递记录同步（主进程侧）
//
//  为什么不是「爬 HTML」：
//    招聘平台的投递记录在登录态后面，前端自己会带着 cookie、token 和
//    请求签名去调它自己的数据接口。我们**不逆向签名、不伪造请求**，
//    而是开一个独立窗口让平台页面自己完成鉴权与请求，然后用 Chromium
//    调试协议（CDP）旁路读取它**自己发出去的 JSON 响应**。
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
//  纯逻辑（平台表 / 响应体归一化）在 job-sync-core.ts，本文件只管窗口与 CDP。
// ============================================================

import { app, BrowserWindow, BrowserView, session } from 'electron';
import type { Session, WebContents } from 'electron';
import fs from 'fs';
import path from 'path';

import { SYNC_PLATFORMS, findPlatform, extractRecords } from './job-sync-core';
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
const JSON_MIME = /json|javascript|text\/plain/i;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** 累积响应条数上限：够覆盖分页，又不会把内存吃满 */
const MAX_CAPTURED = 400;

interface SyncSession {
  platformId: string;
  win: BrowserWindow;
  view: BrowserView;
  /** 当前平台页面的 webContents，独立于本地诊断容器 */
  platformContents: WebContents;
  /** 累积捕获到的 JSON 响应（跨页面导航保留） */
  bodies: Array<{ url: string; json: unknown }>;
  /** 已取过响应体的 requestId，避免重复 */
  seen: Set<string>;
  /** requestId → URL */
  urlById: Map<string, string>;
  /** CDP 消息回调，关闭时用于解绑 */
  onMessage: (ev: unknown, method: string, params: Record<string, unknown>) => void;
  attached: boolean;
  /** 最近一次页面体检结果 */
  page: { title: string; finalUrl: string; bodyText: string; blockReason: string };
  lastError: string;
  /** 用户点击同步窗口右上角 X 时只隐藏，不销毁会话，避免触发应用退出 */
  allowClose: boolean;
  /** 防止空白页一直留在用户面前 */
  emptyPageTimer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, SyncSession>();

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

async function showStatusPage(s: SyncSession, p: SyncPlatform, title: string, message: string): Promise<void> {
  if (s.win.isDestroyed()) return;
  const html = statusPageHtml(p, title, message);
  const script = 'document.open();document.write(' + JSON.stringify(html) + ');document.close();';
  // 本地容器从不加载远端页面，独立导航不会受平台请求影响。
  s.win.setBrowserView(null);
  await Promise.race([
    s.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)),
    waitMs(2000).then(() => { throw new Error('本地容器加载超时'); })
  ]);

  // 不再用 loadURL(data:) 绘制诊断页：第三方导航挂起时，同一个 webContents 的
  // 第二次导航也可能一直 pending。直接写本地容器 document，并对执行本身加超时。
  for (let i = 0; i < 3 && !s.win.isDestroyed(); i += 1) {
    if (await executeWithTimeout(s.win.webContents, script, 700)) break;
    await waitMs(120);
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
  const view = new BrowserView({
    webPreferences: {
      partition: partitionOf(p.id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.setBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 1040, height: 0 });
  view.setAutoResize({ width: true, height: false });
  // 初始阶段平台视图不占用可见区域，直到本地加载页已经完成绘制；
  // 这样第三方导航无论如何挂起，都不会把窗口变成纯白。
  const showPlatformView = (): void => {
    if (!win.isDestroyed() && !platformContents.isDestroyed()) {
      win.setBrowserView(view);
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
    urlById: new Map(),
    onMessage: () => { /* 下面替换 */ },
    attached: false,
    page: { title: '', finalUrl: '', bodyText: '', blockReason: '' },
    lastError: '',
    allowClose: false
  };
  sessions.set(p.id, s);

  // ---- CDP 旁路捕获：窗口活着就一直累积 ----
  s.onMessage = async (_ev, method, params) => {
    try {
      if (method === 'Network.responseReceived') {
        const requestId = String(params.requestId);
        const response = params.response as { url?: string; mimeType?: string } | undefined;
        const type = String(params.type || '');
        const url = String((response && response.url) || '');
        const mime = String((response && response.mimeType) || '');
        // 只留可能带结构化数据的响应，其它（图片/字体/CSS）不进表
        if (url && (type === 'XHR' || type === 'Fetch' || JSON_MIME.test(mime))) {
          s.urlById.set(requestId, url);
        }
      } else if (method === 'Network.loadingFinished') {
        const requestId = String(params.requestId);
        const url = s.urlById.get(requestId);
        if (!url || s.seen.has(requestId)) return;
        s.seen.add(requestId);
        if (s.bodies.length >= MAX_CAPTURED) return;
        try {
          const r = await s.platformContents.debugger.sendCommand('Network.getResponseBody', { requestId });
          const raw = r && r.base64Encoded
            ? Buffer.from(String(r.body || ''), 'base64').toString('utf8')
            : String((r && r.body) || '');
          if (!raw || raw.length > MAX_BODY_BYTES) return;
          const trimmed = raw.trim();
          if (trimmed[0] !== '{' && trimmed[0] !== '[') return;
          s.bodies.push({ url, json: JSON.parse(trimmed) });
        } catch (_) { /* 响应体取不到（跨域 / 已被回收）：跳过，不影响其它请求 */ }
      }
    } catch (_) { /* CDP 回调里绝不能让异常冒泡 */ }
  };

  try {
    const dbg = platformContents.debugger;
    if (!dbg.isAttached()) { dbg.attach('1.3'); s.attached = true; }
    dbg.on('message', s.onMessage as never);
    await dbg.sendCommand('Network.enable');
  } catch (err) {
    s.lastError = '无法附加调试协议：' + ((err as Error).message || err);
  }

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
    try {
      const dbg = platformContents.debugger;
      dbg.removeListener('message', s.onMessage as never);
      if (s.attached && dbg.isAttached()) dbg.detach();
    } catch (_) { /* 忽略 */ }
    sessions.delete(p.id);
  });

  // ---- 导航失败必须能报出来，不能白屏了事 ----
  let navFailed = '';
  platformContents.on('did-finish-load', () => {
    if (platformContents.getURL() === p.entryUrl || platformContents.getURL().startsWith(p.entryUrl + '/')) {
      showPlatformView();
    }
  });
  platformContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* -3 = ERR_ABORTED，用户自己中断的，不算错 */) {
      navFailed = '页面加载失败（' + desc + '，错误码 ' + code + '）';
    }
  });

  // 先给用户一个确定可见的本地加载页，再切到平台页面。加载页本身也不能无限等待。
  await showStatusPage(s, p, '正在打开 ' + p.name,
    '正在加载平台首页。网络较慢时请稍候，页面失败会显示具体原因。');
  // 本地诊断页写入后仍保持平台视图隐藏；平台视图只有 did-finish-load 才会显示。
  hidePlatformView();
  try { win.show(); win.focus(); } catch (_) { /* 窗口正在关闭 */ }

  // 导航超时必须在调用 loadURL 前启动：某些网络失败会让 loadURL 一直 pending，
  // 若把定时器放在 await 后面，诊断页永远没有机会显示。
  let timedOut = false;
  s.emptyPageTimer = setTimeout(async () => {
    if (s.win.isDestroyed()) return;
    timedOut = true;
    const msg = '平台首页加载超过 8 秒。可能是网络不可达、站点拦截或页面响应挂起。';
    s.lastError = msg;
    // 终止独立平台视图中的挂起导航；本地容器页面不会被清空。
    try { platformContents.stop(); } catch (_) { /* 窗口正在关闭 */ }
    hidePlatformView();
    await showStatusPage(s, p, '平台页面加载超时', msg);
  }, 8000);

  try {
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
    s.emptyPageTimer = setTimeout(async () => {
      if (s.win.isDestroyed()) return;
      await refreshPageState(s);
      if (s.page.blockReason === 'blank' && s.bodies.length === 0) {
        const msg = '平台首页没有返回可显示内容。可能是网络不可达、站点拦截或页面仍在加载。';
        s.lastError = msg;
        hidePlatformView();
        await showStatusPage(s, p, '平台页面为空', msg);
      }
    }, 1500);
  }
  return { session: s };
}

/** 刷新页面体检结果（标题/正文/是否撞验证或 404） */
async function refreshPageState(s: SyncSession): Promise<void> {
  try {
    s.page.finalUrl = s.platformContents.getURL();
    s.page.title = s.platformContents.getTitle();
  } catch (_) { /* 窗口已销毁 */ }
  try {
    const r = await s.platformContents.executeJavaScript(
      'JSON.stringify({ text: (document.body ? document.body.innerText : "").slice(0, 400) })'
    );
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
  try { cookieCount = (await sessionOf(p.id).cookies.get({})).length; } catch (_) { /* 忽略 */ }
  const state = readSyncState()[p.id];

  return {
    id: p.id,
    name: p.name,
    syncable: p.syncable,
    note: p.note || '',
    entryUrl: p.entryUrl,
    recordHint: p.recordHint,
    open,
    loggedIn: cookieCount > 0,
    cookieCount,
    captured: open && s ? s.bodies.length : 0,
    pageState: open && s ? s.page.blockReason : '',
    pageTitle: open && s ? s.page.title : '',
    pageUrl: open && s ? s.page.finalUrl : '',
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
 * 抓取当前累积到的数据。
 * 注意：这里**不重新加载页面**，完全依赖用户已经在该窗口里翻到的记录页所发出的请求。
 */
export async function collect(platformId: string, kind: 'applied' | 'collected'): Promise<CollectResult> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  if (!p.syncable) return { ok: false, error: p.name + '：' + p.recordHint };

  const s = sessions.get(p.id);
  if (!s || s.win.isDestroyed()) {
    return { ok: false, error: '同步窗口还没打开。请先点「打开同步窗口」，登录并进入记录页。', hint: p.recordHint };
  }
  await refreshPageState(s);
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

  const items = extractRecords(s.bodies, kind);
  diag.matchedResponses = s.bodies.filter((b) => extractRecords([b], kind).length > 0).length;

  if (items.length === 0) {
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
  s.urlById = new Map();
  s.lastError = '';
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
