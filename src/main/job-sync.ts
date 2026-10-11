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
//  这样做的好处：
//    - 不需要猜接口签名算法（BOSS 的 __zp_stoken__ 之类的加密参数由页面自己生成）
//    - 不需要维护脆弱的 DOM 选择器（改版时抓不到就如实报错，而不是抓到脏数据）
//    - 请求频率与用户手动翻页一致，不构成高频抓取
//
//  边界：
//    - 每个平台一个独立持久化分区（persist:jobsync-<id>），互不串 cookie
//    - 只读：全程不向平台提交任何写操作（不投递、不取消、不修改）
//    - 抓不到就明确返回「需要登录 / 没识别到记录」，绝不编造记录
//    - 记录只在用户勾选确认后才落库（复用 applications:importAuthorized）
//
//  纯逻辑（平台表 / 响应体归一化）在 job-sync-core.ts，本文件只管窗口与 CDP。
// ============================================================

import { app, BrowserWindow, session } from 'electron';
import type { Session } from 'electron';
import fs from 'fs';
import path from 'path';

import { SYNC_PLATFORMS, findPlatform, extractRecords } from './job-sync-core';
import type { SyncPlatform, SyncRecord } from './job-sync-core';

export { SYNC_PLATFORMS, findPlatform, extractRecords };
export type { SyncPlatform, SyncRecord };

// ---------------- 分区与窗口 ----------------
const windows = new Map<string, BrowserWindow>();

function partitionOf(platformId: string): string {
  return 'persist:jobsync-' + platformId;
}

function sessionOf(platformId: string): Session {
  return session.fromPartition(partitionOf(platformId));
}

/**
 * 取（或创建）该平台的同步窗口。
 * 刻意用独立 BrowserWindow 而不是内置 <webview>：它不继承应用页面的 CSP，
 * 也不挂我们的 preload —— 平台页面跑的就是它自己的脚本，边界更干净。
 */
function getWindow(p: SyncPlatform, show: boolean): BrowserWindow {
  const existing = windows.get(p.id);
  if (existing && !existing.isDestroyed()) {
    if (show && !existing.isVisible()) existing.show();
    return existing;
  }
  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    show,
    title: p.name + ' · 投递记录同步',
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: partitionOf(p.id),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 隐藏/后台窗口若被节流，页面可能不发请求，会导致「什么都抓不到」
      backgroundThrottling: false
    }
  });
  windows.set(p.id, win);
  win.on('closed', () => { windows.delete(p.id); });
  return win;
}

export function closeWindow(platformId: string): void {
  const w = windows.get(platformId);
  if (w && !w.isDestroyed()) w.close();
}

export function closeAll(): void {
  for (const id of Array.from(windows.keys())) closeWindow(id);
}

// ---------------- 网络响应旁路捕获 ----------------
const JSON_MIME = /json|javascript|text\/plain/i;
const LOGIN_WALL_RE = /(\/login|\/passport|\/signin|login\.php|passport\.)/i;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface CaptureResult {
  bodies: Array<{ url: string; json: unknown }>;
  finalUrl: string;
  loginWall: boolean;
  timedOut: boolean;
  error?: string;
}

/**
 * 打开目标页，旁路读取它自己发出的 JSON 响应。
 * 用 CDP 的 Network 域而不是 webRequest：webRequest 拿不到响应体。
 */
async function captureJson(
  win: BrowserWindow,
  targetUrl: string,
  opts: { maxMs?: number; idleMs?: number } = {}
): Promise<CaptureResult> {
  const maxMs = opts.maxMs || 30000;
  const idleMs = opts.idleMs || 2000;
  const dbg = win.webContents.debugger;
  const bodies: Array<{ url: string; json: unknown }> = [];
  const urlById = new Map<string, string>();
  const seen = new Set<string>();
  let timedOut = false;

  let idleTimer: NodeJS.Timeout | null = null;
  let resolveIdle: (() => void) | null = null;
  const idle = new Promise<void>((res) => { resolveIdle = res; });
  const bump = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (resolveIdle) resolveIdle(); }, idleMs);
  };

  const onMessage = async (_ev: unknown, method: string, params: Record<string, unknown>): Promise<void> => {
    try {
      if (method === 'Network.responseReceived') {
        const requestId = String(params.requestId);
        const response = params.response as { url?: string; mimeType?: string } | undefined;
        const type = String(params.type || '');
        const url = String((response && response.url) || '');
        const mime = String((response && response.mimeType) || '');
        if (url) urlById.set(requestId, url);
        // 只关心可能带结构化数据的响应，其它（图片/字体/CSS）直接不取体
        if (type !== 'XHR' && type !== 'Fetch' && !JSON_MIME.test(mime)) {
          urlById.delete(requestId);
        }
      } else if (method === 'Network.loadingFinished') {
        const requestId = String(params.requestId);
        const url = urlById.get(requestId);
        if (!url || seen.has(requestId)) return;
        seen.add(requestId);
        try {
          const r = await dbg.sendCommand('Network.getResponseBody', { requestId });
          const raw = r && r.base64Encoded
            ? Buffer.from(String(r.body || ''), 'base64').toString('utf8')
            : String((r && r.body) || '');
          if (!raw || raw.length > MAX_BODY_BYTES) return;
          const trimmed = raw.trim();
          if (trimmed[0] !== '{' && trimmed[0] !== '[') return;
          bodies.push({ url, json: JSON.parse(trimmed) });
          bump();
        } catch (_) { /* 响应体取不到（跨域 / 已被回收）：跳过，不影响其它请求 */ }
      }
    } catch (_) { /* CDP 回调里绝不能让异常冒泡 */ }
  };

  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    dbg.on('message', onMessage as never);
    await dbg.sendCommand('Network.enable');
  } catch (err) {
    return {
      bodies: [], finalUrl: win.webContents.getURL(), loginWall: false, timedOut: false,
      error: '无法附加调试协议：' + ((err as Error).message || err)
    };
  }

  try {
    await win.webContents.loadURL(targetUrl);
  } catch (_) { /* 页面加载失败也继续：可能已经拿到部分响应 */ }

  bump();
  const timeout = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), maxMs));
  const raced = await Promise.race([idle.then(() => 'idle' as const), timeout]);
  timedOut = raced === 'timeout';

  // 停一会让收尾的请求落地
  if (!timedOut) await new Promise((r) => setTimeout(r, 400));

  try {
    dbg.removeListener('message', onMessage as never);
    if (attached) dbg.detach();
  } catch (_) { /* 忽略 */ }
  if (idleTimer) clearTimeout(idleTimer);

  const finalUrl = win.webContents.getURL();
  return { bodies, finalUrl, loginWall: LOGIN_WALL_RE.test(finalUrl), timedOut };
}

// ---------------- 对外操作 ----------------
export interface PullResult {
  ok: boolean;
  items?: SyncRecord[];
  /** 抓到的 JSON 响应条数与其中识别出记录的条数：便于区分「没登录」还是「站点改版」 */
  diagnostics?: { jsonResponses: number; matchedResponses: number; finalUrl: string };
  error?: string;
  needLogin?: boolean;
}

/** 打开登录窗口；登录状态由平台页面完成，保存在该平台独立分区里 */
export async function openLogin(platformId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  try {
    const win = getWindow(p, true);
    win.setTitle(p.name + ' · 请在此登录（登录状态只保存在本机）');
    await win.webContents.loadURL(p.loginUrl);
    return { ok: true, url: win.webContents.getURL() };
  } catch (err) {
    return { ok: false, error: '打开登录页失败：' + ((err as Error).message || err) };
  }
}

/** 轻量判断该平台分区是否已有登录态（只看 cookie，不额外发请求） */
export async function loginState(platformId: string): Promise<{ loggedIn: boolean; cookieCount: number }> {
  const p = findPlatform(platformId);
  if (!p) return { loggedIn: false, cookieCount: 0 };
  try {
    const cookies = await sessionOf(p.id).cookies.get({});
    const meaningful = cookies.filter((c) => /token|login|auth|session|ticket|uid|user/i.test(c.name));
    return { loggedIn: meaningful.length > 0 || cookies.length > 6, cookieCount: cookies.length };
  } catch (_) {
    return { loggedIn: false, cookieCount: 0 };
  }
}

/** 同步一次：打开记录页并旁路读取数据 */
export async function pull(platformId: string, kind: 'applied' | 'collected'): Promise<PullResult> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  if (!p.syncable) return { ok: false, error: p.name + ' 不提供个人投递记录，无法同步' };
  const target = kind === 'collected' ? (p.collectUrl || p.applyUrl) : p.applyUrl;
  if (!target) return { ok: false, error: p.name + ' 没有配置记录页地址' };

  const win = getWindow(p, true);
  try {
    win.setTitle(p.name + ' · 正在读取记录（请勿关闭本窗口）');
    const cap = await captureJson(win, target);
    if (cap.error) return { ok: false, error: cap.error };

    const items = extractRecords(cap.bodies, kind);
    const matched = cap.bodies.filter((b) => extractRecords([b], kind).length > 0).length;
    win.setTitle(p.name + ' · 同步完成');

    if (cap.loginWall && items.length === 0) {
      return {
        ok: false,
        needLogin: true,
        error: '需要先登录：请在同步窗口里完成登录，然后回到应用点「同步」重试',
        diagnostics: { jsonResponses: cap.bodies.length, matchedResponses: 0, finalUrl: cap.finalUrl }
      };
    }
    if (items.length === 0) {
      const label = kind === 'collected' ? '收藏' : '投递';
      return {
        ok: false,
        error: cap.timedOut
          ? '等待页面数据超时，没有读到记录。可在同步窗口内手动翻到「' + label + '记录」页再点一次同步。'
          : '页面已加载，但没有识别到' + label + '记录。'
            + (cap.bodies.length === 0
              ? '（本次没有捕获到任何 JSON 数据响应，最常见原因是未登录或站点改版）'
              : '（捕获到 ' + cap.bodies.length + ' 个 JSON 响应，但字段结构与预期不符，可能是站点改版）'),
        diagnostics: { jsonResponses: cap.bodies.length, matchedResponses: 0, finalUrl: cap.finalUrl }
      };
    }
    return {
      ok: true,
      items,
      diagnostics: { jsonResponses: cap.bodies.length, matchedResponses: matched, finalUrl: cap.finalUrl }
    };
  } catch (err) {
    return { ok: false, error: '同步失败：' + ((err as Error).message || err) };
  }
}

/** 解除该平台的登录态：清空整个分区的存储并关闭窗口 */
export async function logout(platformId: string): Promise<{ ok: boolean; error?: string }> {
  const p = findPlatform(platformId);
  if (!p) return { ok: false, error: '未知平台：' + platformId };
  try {
    closeWindow(platformId);
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
