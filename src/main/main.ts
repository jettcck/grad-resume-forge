'use strict';

// ============================================================
//  主进程入口（TypeScript 版）
// ============================================================

import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

// ---------------- GPU 兜底（必须在 app ready 之前） ----------------
// 为什么需要：离线导出 PDF 用的离屏窗口（webPreferences.offscreen）硬依赖 GPU 进程。
// 在显卡驱动异常、远程桌面/虚拟机、或无 GPU 的服务器环境里，GPU 进程会反复崩溃，
// Chromium 最终直接 FATAL: "GPU process isn't usable. Goodbye."，应用连主窗口都开不出来。
// 这里只做一件事：允许回退到 SwiftShader 软件渲染，保证「没显卡也能用」。
// 显式传了 --use-gl / --disable-gpu 的环境不加干预，尊重使用者/CI 的选择。
if (!process.argv.some((a) => /^--(use-gl|use-angle|disable-gpu)/.test(a))) {
  // Vulkan/SwiftShader 软件栈；同时禁用 GPU 合成，让 Chromium 完全走软件光栅。
  // 只加 swiftshader 不足以在「没有可用 GPU 进程」的机器上过关：仍需关掉合成器。
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
}
// 渲染进程连续崩溃时不再无限重试，直接如实报错，避免用户面对一个反复闪退的黑窗口。
app.on('render-process-gone', (_e, _wc, details) => {
  if (details && details.reason && details.reason !== 'clean-exit') {
    console.error('[render-process-gone]', details.reason, details.exitCode);
  }
});

import * as store from './store';
import * as auth from './auth';
import * as engine from './resume-engine';
import { createLlmClient } from '../../packages/llm-adapters/dist/index';
import { detectLocalServices } from './local-detect';
import * as interview from './interview';
import * as secureStore from './secure-store';
import { LIMITS, assertSize, assertString, assertPlainObject } from './validate';
// 运行记录与回放来自 agent-core（与 Electron 解耦的 Agent Runtime）
import { createFileRunStore, replayRun } from '../../packages/agent-core/dist/index';
import type { IpcResult, Profile, LlmConfig, Application } from './types';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

/** 清除某个 webContents 上的登录态，并连带清掉它对应的「仅本次会话」密钥 */
function forgetSession(webContentsId: number): void {
  const uid = sessions.get(webContentsId);
  if (uid) sessionKeys.delete(uid);
  sessions.delete(webContentsId);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1115',
    show: false,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 主窗口不需要 Node：渲染层只用 DOM + window.api（preload 通过 contextBridge 暴露），
      // preload 本身只用 contextBridge/ipcRenderer 和 process.env 里的一个自检开关。
      // 开沙箱后渲染进程即使被攻破也拿不到 Node 能力（导出 PDF 的离屏窗口早就这么设了）。
      sandbox: true
    }
  });

  // dist/main → 渲染层源码在 src/renderer（TS 编译只处理主进程）
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

  const wcId = mainWindow.webContents.id;

  // ---------------- 导航守卫 ----------------
  // 为什么必须有：安全边界不是「preload 本身」，而是「这个窗口只加载本应用自己的页面」。
  // 一旦窗口被导航到远端站点，那个站点的脚本会连同 preload 一起加载，于是能直接调用
  // window.api 下的全部 IPC 通道（等于把整库读写、备份恢复、Agent 运行都交出去）。
  // 所以：除应用自身页面外一律拦下，http/https 外链交给系统浏览器
  // （应用里所有外链本来就走的 shell:openExternal，二者行为一致）。
  const rendererDirUrl = pathToFileURL(
    path.join(__dirname, '..', '..', 'src', 'renderer')
  ).href; // 例：file:///C:/.../app.asar/src/renderer（打包后仍在 asar 内，__dirname 已指向 asar）
  const isOwnPage = (url: string): boolean =>
    url === rendererDirUrl || url.indexOf(rendererDirUrl + '/') === 0;
  const openExternalIfHttp = (rawUrl: string): void => {
    try {
      const u = new URL(rawUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') void shell.openExternal(u.href);
    } catch (_) { /* 非法 URL：丢掉，不抛错打断导航处理 */ }
  };
  // 只放行应用自己渲染目录下的页面（含刷新）；其余一律 preventDefault。
  // 用目录前缀而不是精确比对一个 index.html，是为了打包后路径形态变化时不会误拦自己的页面
  // （误拦的后果是白屏，比漏拦更难排查）。
  // 注意 did-navigate-in-page（#hash 跳转）不走这里，预览页内的锚点不受影响。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(url)) return;
    event.preventDefault();
    console.log('[nav-blocked]', String(url).slice(0, 200));
    openExternalIfHttp(url);
  });
  // 新窗口一律不开：要么转交系统浏览器，要么丢弃。
  // 不回 { action: 'allow' } 是因为新窗口默认不带 preload/CSP 约束，等于绕过上面这条。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[window-open-blocked]', String(url).slice(0, 200));
    openExternalIfHttp(url);
    return { action: 'deny' };
  });

  const levels = ['LOG', 'WARN', 'ERROR'];
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = String(sourceId || '').split(/[\\/]/).pop();
    console.log(`[renderer:${levels[level] || level}] ${message}  (${src}:${line})`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.log('[preload-error]', preloadPath, error && (error as Error).stack ? (error as Error).stack : error);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details));
    // 渲染进程崩溃/被结束：主进程侧的会话与临时密钥一起失效。
    // 只清「本次会话」的密钥（sessionKeys），落盘的加密密钥不受影响；
    // 渲染层重启后会拿本地 token 走 auth:session 自动恢复登录态。
    forgetSession(mainWindow!.webContents.id);
  });

  // 窗口销毁（关窗、整个 webContents 被销毁）：同样清掉会话与临时密钥，
  // 否则「不写盘的临时密钥」会一直留到应用退出。
  mainWindow.webContents.once('destroyed', () => {
    forgetSession(wcId);
  });

  mainWindow.once('ready-to-show', () => mainWindow!.show());

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 同步窗口属于辅助窗口，可能被 hide() 而仍存在；主窗口关闭时必须明确退出应用，
    // 不能等待 window-all-closed（否则应用会留在后台，或生命周期判断混乱）。
    if (!isQuitting) app.quit();
  });
}

// ---------------- 单实例锁 ----------------
// 数据层没有多进程写队列：两个实例同时读写同一个 db.json 会互相覆盖
// （一个拿着旧库、一个写新库，后写的赢，先写的丢）。与其靠 README 提醒
// 「别双开」，不如从机制上杜绝：第二个实例什么都不初始化，直接退出。
// 注意锁要在 app ready 之前、模块加载时就申请。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// 第二实例尝试启动时，把已有窗口带到前台——用户多半只是没找到窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!gotTheLock) return; // 正在退出的第二实例：不建窗口、不动数据
  store.init(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  // 启动阶段的权限/磁盘/损坏数据错误不能只变成 unhandled rejection；
  // 给用户可读的错误和诊断日志，避免“点图标没反应”无法反馈。
  const message = err instanceof Error ? err.message : String(err);
  console.error('[startup-failed]', err && (err as Error).stack ? (err as Error).stack : message);
  try { dialog.showErrorBox('简历锻造炉无法启动', '本地数据目录不可用或应用初始化失败：\n' + message); } catch (_) { /* app may not have a usable UI */ }
  app.exit(1);
});

app.on('window-all-closed', () => {
  // job-sync 的辅助窗口会被 close 事件拦截并 hide；即使所有可见窗口暂时为 0，
  // 主应用仍然不能因为用户关闭平台窗口而退出。
  if (process.platform !== 'darwin' && mainWindow === null) app.quit();
});

// 退出时先收掉平台同步窗口：它们是独立 BrowserWindow，留着会让「关掉主窗口」退不出去
app.on('before-quit', () => {
  isQuitting = true;
  try { jobSync.closeAll(); } catch (_) { /* 忽略 */ }
});

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}
function fail(message: string): IpcResult<never> {
  return { ok: false, error: message };
}

// ---------------- 会话权威（数据接口不再信任 renderer 传来的 userId） ----------------
// 背景：档案/投递/快照/版本等接口原先直接拿 renderer 传来的 userId 去读写数据，
// 等于「谁都能报一个别人的 id」。桌面应用里风险低于服务器，但 renderer 一旦被注入
// 内容（例如导入的简历文本、未来多窗口）就是真实越权。这里把 userId 的来源收到主进程：
// 只有登录/恢复会话成功的那个 webContents 才拿得到自己的 userId。
const sessions = new Map<number, string>(); // webContents.id → userId

function rememberSession(ev: Electron.IpcMainInvokeEvent, userId: unknown): void {
  const uid = String(userId || '');
  if (!uid) return;
  try { sessions.set(ev.sender.id, uid); } catch (_) { /* 忽略 */ }
}

function sessionUserId(ev: Electron.IpcMainInvokeEvent): string {
  let uid: string | undefined;
  try { uid = sessions.get(ev.sender.id); } catch (_) { uid = undefined; }
  if (!uid) throw new Error('未登录或会话已过期，请重新登录');
  return uid;
}

ipcMain.handle('auth:register', (_e, payload: auth.RegisterPayload) => {
  try {
    const r = auth.register(payload);
    rememberSession(_e, (r as { id?: string }).id);
    return ok(r);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('auth:login', (_e, payload: auth.LoginPayload) => {
  try {
    const r = auth.login(payload);
    rememberSession(_e, (r as { id?: string }).id);
    return ok(r);
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 用本地 token 恢复登录态（免重复输入）
ipcMain.handle('auth:session', (_e, token: string) => {
  try {
    const r = auth.resumeSession(token);
    // 无效/过期 token 是正常的恢复失败，不应因为读取 null.id 再包装成 IPC 异常。
    if (r) rememberSession(_e, r.id);
    return ok(r);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('auth:logout', (_e, token: string) => {
  try {
    // 本次会话的临时密钥随登出一起清掉：不写盘的东西不该在登出后还留着
    const uid = sessions.get(_e.sender.id);
    if (uid) sessionKeys.delete(uid);
    sessions.delete(_e.sender.id);
    return ok(auth.logout(token));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('profile:get', (_e, userId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.getProfile(userId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('profile:save', (_e, userId: string, profile: Partial<Profile>) => {
  try {
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.saveProfile(userId, profile));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('resume:generate', (_e, profile: Profile, options: { targetRole?: string } | undefined) => {
  try {
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    return ok(engine.generate(profile, options || {}));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 把用户勾选的改写写回档案：用引擎的切分语义（数组描述、；/。/换行分隔都一致），
// 渲染层不再自己实现一套 —— 两份实现漂移过一次，结果是存进档案的内容错行、重复。
ipcMain.handle('resume:applyRewrites', (_e, profile: Partial<Profile>, accepted: unknown) => {
  try {
    assertPlainObject(profile, '档案');
    const list = Array.isArray(accepted) ? accepted as never[] : [];
    assertSize(profile, LIMITS.profileJson, '档案');
    assertSize(list, LIMITS.profileJson, '改写结果');
    return ok(agent.applyRewritesToProfile(profile, list));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('resume:audit', (_e, text: string) => {
  try {
    assertString(text, LIMITS.profileJson, '体检文本');
    return ok(engine.auditAiFlavor(text));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 粘贴 JD 精准匹配
ipcMain.handle('resume:matchJd', (_e, resume: Parameters<typeof engine.matchJd>[0], jdText: string) => {
  try {
    assertPlainObject(resume, '简历');
    assertSize(resume, LIMITS.profileJson, '简历');
    assertString(jdText, LIMITS.jdText, '职位描述');
    return ok(engine.matchJd(resume, jdText));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 导入旧简历（PDF / TXT）
ipcMain.handle('resume:importPdf', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: '导入旧简历',
      filters: [
        { name: '简历文件', extensions: ['pdf', 'txt'] },
        { name: 'PDF 文档', extensions: ['pdf'] },
        { name: '文本文件', extensions: ['txt'] }
      ],
      properties: ['openFile']
    });
    if (canceled || !filePaths || !filePaths[0]) return ok(null); // 用户取消

    const importer = await import('./resume-importer');
    const dataRoot = path.join(__dirname, '..', '..', 'data');
    try {
      const st = fs.statSync(filePaths[0]);
      if (st.size > LIMITS.importFile) throw new Error('文件过大（' + Math.round(st.size / 1024 / 1024) + 'MB，上限 ' + Math.round(LIMITS.importFile / 1024 / 1024) + 'MB）');
    } catch (e) { if (e instanceof Error && /文件过大/.test(e.message)) throw e; }
    const result = await importer.importFromFile(filePaths[0], dataRoot);
    return ok(result);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('applications:list', (_e, userId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.listApplications(userId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 新增/编辑投递（此前只在 preload 暴露、主进程漏注册 → 真实应用里存投递会报
// 「No handler registered」，看板实际是只读的；截图 mock 里注册了所以测试没发现）
// 仅接收用户通过招聘平台官方导出或官方授权接口获得的数据；不抓取登录态页面。
ipcMain.handle('applications:importAuthorized', (_e, userId: string, payload: unknown) => {
  try {
    userId = sessionUserId(_e);
    assertPlainObject(payload, '授权投递数据');
    assertSize(payload, LIMITS.profileJson, '授权投递数据');
    const p = payload as { source?: unknown; items?: unknown };
    const source = String(p.source || '').trim().slice(0, 40);
    if (!source) throw new Error('缺少数据来源');
    if (!Array.isArray(p.items)) throw new Error('授权数据缺少 items 数组');
    const existing = store.listApplications(userId);
    const byKey = new Map(existing.filter((a) => a.source && a.externalId).map((a) => [String(a.source) + '|' + String(a.externalId), a]));
    let added = 0, updated = 0, skipped = 0;
    for (const raw of p.items.slice(0, 1000)) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      const x = raw as Record<string, unknown>;
      const company = String(x.company || '').trim().slice(0, 120);
      const position = String(x.position || '').trim().slice(0, 120);
      if (!company && !position) { skipped++; continue; }
      const externalId = String(x.externalId || x.id || '').trim().slice(0, 160);
      const key = externalId ? source + '|' + externalId : '';
      const hit = key ? byKey.get(key) : existing.find((a) => a.company === company && (a.position || '') === position);
      const patch: Application = {
        company: company || '(未填公司)', position,
        url: String(x.url || '').trim().slice(0, 1000),
        stage: String(x.stage || 'applied').slice(0, 30),
        place: String(x.place || '').trim().slice(0, 120),
        address: String(x.address || '').trim().slice(0, 240),
        notes: String(x.notes || '').trim().slice(0, 2000),
        source, externalId, syncStatus: 'synced', syncError: '', lastSyncedAt: Date.now()
      };
      const saved = store.saveApplication(userId, hit ? { ...patch, id: hit.id } : patch);
      if (hit) {
        const i = existing.findIndex((a) => a.id === hit.id);
        if (i >= 0) existing[i] = saved;
        updated++;
      } else { existing.unshift(saved); added++; }
      if (key) byKey.set(key, saved);
    }
    return ok({ added, updated, skipped, errors: [] });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('applications:save', (_e, userId: string, application: Application) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    assertPlainObject(application, '投递记录');
    assertSize(application, LIMITS.notes, '投递记录');
    if (!store.findUserById(userId)) return fail('用户不存在');
    return ok(store.saveApplication(userId, application));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('applications:delete', (_e, userId: string, appId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.deleteApplication(userId, appId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- Agent 快照 ----------------
ipcMain.handle('snapshots:save', (_e, userId: string, label: string, profile: Partial<Profile>) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    if (!store.findUserById(userId)) return fail('用户不存在');
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    return ok(store.saveAgentSnapshot(userId, label, profile));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('snapshots:list', (_e, userId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.listAgentSnapshots(userId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('snapshots:get', (_e, userId: string, snapshotId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    const profile = store.getAgentSnapshot(userId, snapshotId);
    if (!profile) return fail('快照不存在或已删除');
    return ok(profile);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('snapshots:restore', (_e, userId: string, snapshotId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    const profile = store.getAgentSnapshot(userId, snapshotId);
    if (!profile) return fail('快照不存在或已删除');
    return ok(store.saveProfile(userId, profile));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('snapshots:delete', (_e, userId: string, snapshotId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.deleteAgentSnapshot(userId, snapshotId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 数据备份（自动轮转 + 一键恢复） ----------------
// 这三个接口操作的是**设备级**数据（整库：所有账号、会话、配置），
// 所以既要登录态，恢复又必须显式确认 —— restore 会把整个数据库换成备份内容，
// 未登录的渲染层也能调是被评审点出来的越权面。
ipcMain.handle('backups:list', (_e) => {
  try {
    sessionUserId(_e);
    return ok({ items: store.listBackups(), dir: store.backupsPath() });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('backups:restore', (_e, name: string, confirm?: boolean) => {
  try {
    sessionUserId(_e);
    if (confirm !== true) {
      return fail('恢复备份会替换整个数据库（含所有账号与配置），需要显式确认后再执行');
    }
    const restored = store.restoreBackup(name);
    // 恢复会替换 db.json 中的 users/sessions/settings。若继续保留旧的内存会话，
    // 当前窗口会在“已登录”状态下读写一份与原来不同的数据库，甚至复用旧的临时密钥。
    // 整库恢复后统一要求重新登录，并终止仍在运行的 Agent。
    sessions.clear();
    sessionKeys.clear();
    activeRuns.forEach((entry) => entry.ctl.abort());
    activeRuns.clear();
    return ok({ ...restored, requiresLogin: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('backups:reveal', (_e) => {
  try {
    sessionUserId(_e);
    const dir = store.backupsPath();
    if (dir && fs.existsSync(dir)) shell.openPath(dir);
    return ok({ dir });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 简历版本（多版本：一个岗位一版） ----------------
ipcMain.handle('versions:list', (_e, userId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.listVersions(userId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('versions:get', (_e, userId: string, versionId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    const v = store.getVersion(userId, versionId);
    if (!v) return fail('版本不存在或已删除');
    return ok(v);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('versions:save', (_e, userId: string, input: Parameters<typeof store.saveVersion>[1]) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    if (!store.findUserById(userId)) return fail('用户不存在');
    assertPlainObject(input, '简历版本');
    assertPlainObject(input.profile, '档案');
    assertSize(input.profile, LIMITS.profileJson, '档案');
    assertSize(input, LIMITS.profileJson + LIMITS.jdText + LIMITS.label, '简历版本');
    return ok(store.saveVersion(userId, input));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('versions:rename', (_e, userId: string, versionId: string, name: string, note?: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.renameVersion(userId, versionId, name, note));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('versions:delete', (_e, userId: string, versionId: string) => {
  try {
    userId = sessionUserId(_e); // 会话权威在主进程：不信任 renderer 传来的 userId
    return ok(store.deleteVersion(userId, versionId));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('resume:exportPdf', async (_e, html: string, suggestedName: string) => {
  if (typeof html !== 'string' || !html.trim()) return fail('没有可导出的内容');
  try { assertSize(html, LIMITS.exportHtml, '导出内容'); } catch (err) { return fail((err as Error).message); }
  // 离屏渲染 PDF；无论成功失败都要销毁隐藏窗口，避免进程泄漏。
  // 这个窗口加载的是拼好的 HTML 字符串（内容来自简历文本，可能含导入 PDF 里的任意字符），
  // 所以关掉 JS、隔离上下文并保持沙箱：它只需要排版和打印，不需要脚本。
  let data: Buffer;
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  try {
    const encoded = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await pdfWin.loadURL(encoded);

    data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' }
    });
  } catch (err) {
    return fail('PDF 渲染失败：' + (err as Error).message);
  } finally {
    if (!pdfWin.isDestroyed()) pdfWin.destroy();
  }

  try {
    // suggestedName 来自用户可编辑的姓名/岗位字段，不能直接作为路径片段交给原生对话框。
    // 清理分隔符、控制字符和 Windows 保留字符，避免默认路径跳出用户预期目录或显示非法文件名。
    const safeStem = path.basename(String(suggestedName || 'resume'))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 96) || 'resume';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: '导出简历 PDF',
      defaultPath: safeStem + '.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return fail('已取消导出');

    fs.writeFileSync(filePath, data);
    return ok({ filePath });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 复制文本到系统剪贴板
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  try {
    clipboard.writeText(String(text == null ? '' : text));
    return ok({ done: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 用系统默认浏览器打开外部链接（仅允许 http/https，防止协议注入）
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return fail('仅支持打开 http/https 链接');
    }
    await shell.openExternal(u.href);
    return ok({ opened: u.href });
  } catch (err) {
    return fail('链接无效：' + (err as Error).message);
  }
});

// ---------------- Agent：本地 Ollama / 云端 OpenAI 兼容 / 应用内嵌模型 ----------------
import * as agent from './agent';
import { askAssistant, hotQuestions } from './assistant';

// ---- 内嵌模型桥：模型在渲染进程跑（WebGPU），主进程通过窗口代理调用 ----
// 协议：主进程发 'embedded:req' {id, messages} → 渲染进程推理 → 'embedded:res' {id, content|error}
const embeddedPending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

ipcMain.on('embedded:res', (_e, payload: { id: string; content?: string; error?: string }) => {
  const p = embeddedPending.get(payload && payload.id);
  if (!p) return;
  embeddedPending.delete(payload.id);
  clearTimeout(p.timer);
  if (payload.error) p.reject(new Error(String(payload.error)));
  else p.resolve(String(payload.content || ''));
});

// 渲染进程报告内嵌模型状态（WebGPU 检测结果 / 模型就绪与否），主进程缓存
let embeddedStatus: { webgpu: boolean; ready: boolean } = { webgpu: false, ready: false };
ipcMain.on('embedded:status', (_e, st: { webgpu?: boolean; ready?: boolean }) => {
  embeddedStatus = {
    webgpu: !!(st && st.webgpu),
    ready: !!(st && st.ready)
  };
});

function embeddedLlmClient(): import('./types').LlmClient {
  const REQ_TIMEOUT = 180000; // 内嵌模型推理慢（0.5B 在核显上单轮可达分钟级）
  return {
    provider: 'embedded',
    config: { provider: 'embedded', endpoint: 'app://embedded', model: 'qwen2.5-0.5b', temperature: 0.3, timeout: REQ_TIMEOUT },
    async status() {
      return {
        available: embeddedStatus.ready,
        models: embeddedStatus.ready ? ['qwen2.5-0.5b（应用内）'] : [],
        error: embeddedStatus.webgpu ? undefined : '此设备不支持 WebGPU，无法使用应用内模型'
      };
    },
    async chat(messages: import('./types').ChatMessage[], _opts?: import('./types').ChatOptions): Promise<string | import('./types').ToolCallReply> {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('窗口不可用');
      if (!embeddedStatus.ready) throw new Error('应用内模型未就绪（先在配置里下载）');
      const id = 'emb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          embeddedPending.delete(id);
          reject(new Error('内嵌模型响应超时'));
        }, REQ_TIMEOUT);
        embeddedPending.set(id, { resolve, reject, timer });
        mainWindow!.webContents.send('embedded:req', { id, messages });
      });
    }
  };
}

// 探测模型服务；返回 { available, models, config }（云端含 error 说明）
// 注意必须按会话取用户自己的配置：设置保存进的是 `userId:agent`，
// 读全局键会读不到（用户配了 DeepSeek 也会静默回落到默认 Ollama）。
ipcMain.handle('agent:status', async (_e) => {
  try {
    const userId = sessionUserId(_e);
    // resolveAgentConfig 会带上「仅本次会话使用」的密钥（存在主进程内存里，不落盘）
    const cfg: LlmConfig = resolveAgentConfig(userId,
      { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' } as unknown as Partial<LlmConfig>);
    // embedded：读渲染进程上报的状态（渲染层启动时会主动上报一次）
    const client = cfg.provider === 'embedded' ? embeddedLlmClient() : createLlmClient(cfg);
    const st = await client.status();
    // 不能把 client.config 原样回给渲染层：里面有解密后的 apiKey（评审指出的泄漏点，
    // 一旦渲染层被注入内容就能直接读走）。只回掩码后的配置 + 「是否已有密钥」。
    const safeConfig = Object.assign({}, client.config) as LlmConfig & { hasKey?: boolean; sessionOnly?: boolean };
    delete safeConfig.apiKey;
    safeConfig.hasKey = !!cfg.apiKey;
    safeConfig.sessionOnly = !hasStoredKey(userId) && sessionKeys.has(userId);
    return ok({ ...st, config: safeConfig, provider: client.provider });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 运行 Agent：mode='pipeline'（默认）/ 'agentic' / 'rules'（零下载规则通道，不调模型）
// ---------------- Agent 运行记录与取消（第二阶段：Runtime 化）----------------
// 运行记录按账号分文件：不同账号共用一份 JSONL 的话，A 的记录会被 B 读到、清掉甚至取消，
// 分文件让隔离由文件系统保证，而不是靠每个接口记得加过滤条件。
const runStores = new Map<string, ReturnType<typeof createFileRunStore>>();
function getRunStore(userId: string) {
  // userId 由主进程生成（user_数字_hex），这里再兜一层，避免被拼成路径穿越
  const safe = String(userId).replace(/[^A-Za-z0-9_-]/g, '');
  if (!runStores.has(safe)) {
    runStores.set(safe, createFileRunStore(
      path.join(app.getPath('userData'), 'grad-resume-data', 'agent-runs-' + safe + '.jsonl'),
      { maxRuns: 50 }
    ));
  }
  return runStores.get(safe)!;
}
/** 正在运行的运行 → 取消控制器（带 owner：只有本人能取消自己的运行） */
const activeRuns = new Map<string, { ownerUserId: string; ctl: AbortController }>();

ipcMain.handle('agent:cancel', (_e, runId: string) => {
  try {
    const userId = sessionUserId(_e);
    const entry = activeRuns.get(String(runId || ''));
    if (!entry) return fail('这次运行已经结束或不存在');
    if (entry.ownerUserId !== userId) return fail('不能取消其他账号的运行');
    entry.ctl.abort();
    return ok({ cancelled: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 列表只回摘要：trace 与结果明细按 runId 单独取，避免一次拉回几十条大步数记录
ipcMain.handle('agent:runs', (_e, limit?: number) => {
  try {
    const userId = sessionUserId(_e);
    const list = getRunStore(userId).list(Math.min(Math.max(Number(limit) || 10, 1), 50)).map((r) => ({
      runId: r.runId, taskId: r.taskId, status: r.status, currentStep: r.currentStep,
      startedAt: r.startedAt, finishedAt: r.finishedAt, error: r.error, cancelReason: r.cancelReason,
      usage: r.usage, traceCount: r.trace.length, inputSnapshot: r.inputSnapshot
    }));
    return ok(list);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('agent:run:get', (_e, runId: string) => {
  try {
    const userId = sessionUserId(_e);
    const rec = getRunStore(userId).get(String(runId || ''));
    if (!rec) return fail('没有找到这条运行记录');
    return ok(rec);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('agent:clearRuns', (_e) => {
  try {
    const userId = sessionUserId(_e);
    return ok({ cleared: getRunStore(userId).clear() });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 回放：用当前工具实现按记录重跑一次，不消耗模型调用（复盘「当时为什么拒了这条」）
ipcMain.handle('agent:replay', async (_e, runId: string, profile: Partial<Profile>, jdText: string, force?: boolean) => {
  try {
    const userId = sessionUserId(_e);
    const rec = getRunStore(userId).get(String(runId || ''));
    if (!rec) return fail('没有找到这条运行记录');
    // 回放的前提是「同一份输入」：拿另一份简历/JD 重跑旧记录，结果无法对比，
    // 却很容易被当成「可复现」。默认拒绝，要强行回放必须显式 force。
    const now = agent.inputDigests(profile, jdText);
    const snap = rec.inputSnapshot;
    const mismatch: string[] = [];
    if (snap && snap.jdDigest && now.jdDigest !== snap.jdDigest) mismatch.push('JD');
    if (snap && snap.profileDigest && now.profileDigest !== snap.profileDigest) mismatch.push('档案');
    if (mismatch.length && force !== true) {
      return fail('当前的' + mismatch.join('与') + '和这条记录不是同一份（' +
        '记录 JD ' + (snap ? snap.jdDigest : '-') + ' / 现在 ' + now.jdDigest + '），' +
        '这样回放的结果不能用来对比。确认要强行回放请再加确认。');
    }
    const items = agent.buildTaskItems(profile);
    if (!items.length) return fail('档案中没有可改写的经历条目');
    const ctx = { profile, jd: engine._clean(jdText), items, accepted: new Map(), rejected: [], jdAnalysis: null, attempts: new Map() };
    const tools = agent.buildAgentTools(ctx).map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      permission: 'readonly' as const, timeoutMs: 15_000, maxRetries: 0, idempotent: true,
      execute: async (args: Record<string, unknown>) => Promise.resolve(t.run(args, ctx))
    })) as unknown as Parameters<typeof replayRun>[1]['tools'];
    return ok(await replayRun(rec, { tools, ctx }));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('agent:run', async (_e, profile: Partial<Profile>, jdText: string, opts: { mode?: string; runId?: string } & Partial<LlmConfig>) => {
  try {
    const userId = sessionUserId(_e);
    const o = opts || {};
    const rulesOnly = o.mode === 'rules';
    // 按会话取用户自己的模型配置：设置存在 `userId:agent`，读全局键会让用户配好的云端模型失效
    const cfg = resolveAgentConfig(userId, o as Partial<LlmConfig>);
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    assertString(jdText, LIMITS.jdText, '职位描述');
    // 规则通道不需要任何模型客户端
    const llm = rulesOnly
      ? undefined
      : (cfg.provider === 'embedded' ? embeddedLlmClient() : createLlmClient(cfg));
    const send = (s: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:progress', s);
      }
    };
    const sendStream = (piece: string, round: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:stream', { round, piece });
      }
    };
    if (rulesOnly) {
      const result = await agent.runAgent(profile, jdText, { onStep: send, rulesOnly: true });
      return ok(result);
    }
    // runId 由渲染层给出：这样用户点「取消」时主进程能立刻找到对应的运行。
    // 但必须拒绝重复 ID：覆盖别人的控制器会让「取消」打到错误的任务上，
    // 而且先结束的那个任务的 finally 会把新任务的控制器删掉（评审指出）。
    const runId = String(o.runId || ('run_' + Date.now().toString(36)));
    if (activeRuns.has(runId)) return fail('这次运行的 ID 正在使用中，请稍后重试');
    const ctl = new AbortController();
    activeRuns.set(runId, { ownerUserId: userId, ctl });
    try {
      const runner = o.mode === 'agentic' ? agent.agenticLoop : agent.runAgent;
      const result = await runner(profile, jdText, {
        llm, onStep: send, onChunk: sendStream,
        runId, taskId: 'resume-optimize', runStore: getRunStore(userId), signal: ctl.signal
      } as never);
      return ok(result);
    } finally {
      // 只删自己那一个：就算 runId 之后被复用，也不能顺手删掉别人的控制器
      const cur = activeRuns.get(runId);
      if (cur && cur.ctl === ctl) activeRuns.delete(runId);
    }
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 探测本机已有的本地模型服务（LM Studio / llama.cpp / vLLM / Ollama …）
// 有就直接用，省掉「让用户自己去装一个」这一步；只探 127.0.0.1
ipcMain.handle('agent:detectLocal', async () => {
  try {
    return ok(await detectLocalServices());
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 面试准备（全本地、零模型） ----------------
ipcMain.handle('interview:prep', (_e, profile: Partial<Profile>, opts?: { company?: string }) => {
  try {
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    return ok(interview.prepareInterview(profile, opts || {}));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 小助手（知识库问答，纯本地零模型） ----------------
ipcMain.handle('assistant:ask', (_e, query: string, domainHint?: string) => {
  try {
    assertString(query, LIMITS.assistantQuery, '问题');
    return ok(askAssistant(query, domainHint));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('assistant:hot', () => {
  try {
    return ok(hotQuestions());
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 全局设置读写（apiKey 落盘前经 safeStorage 加密，读取时解密）
function encryptAgentConfig(cfg: LlmConfig | null): LlmConfig | null {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = Object.assign({}, cfg);
  if (typeof out.apiKey === 'string' && out.apiKey && !secureStore.isEncrypted(out.apiKey)) {
    out.apiKey = secureStore.encryptString(out.apiKey);
  }
  return out;
}

function decryptAgentConfig(cfg: LlmConfig | null): LlmConfig | null {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = Object.assign({}, cfg);
  if (typeof out.apiKey === 'string' && secureStore.isEncrypted(out.apiKey)) {
    out.apiKey = secureStore.decryptString(out.apiKey);
  }
  return out;
}

// 仅本次会话使用的密钥：留在主进程内存里，不写盘，退出即失效。
// 用途：safeStorage 不可用（密钥只能明文落盘）时，给用户一个更安全的选择，
// 而不是只能在「明文保存」和「不保存」之间二选一。
const sessionKeys = new Map<string, string>();

function hasStoredKey(userId: string): boolean {
  const saved = decryptAgentConfig(store.getSetting<LlmConfig>('agent', userId)) as LlmConfig | null;
  return !!(saved && saved.apiKey);
}

/** 取当前账号生效的模型配置：兜底默认值在前、用户保存的在后（用户配置优先），最后补会话密钥 */
function resolveAgentConfig(userId: string, defaults: Partial<LlmConfig> = {}): LlmConfig {
  const saved = (decryptAgentConfig(store.getSetting<LlmConfig>('agent', userId)) as LlmConfig | null) || ({} as LlmConfig);
  const cfg: LlmConfig = Object.assign({}, defaults, saved);
  if (!cfg.apiKey && sessionKeys.has(userId)) cfg.apiKey = sessionKeys.get(userId)!;
  return cfg;
}

// 允许渲染层读写的设置键白名单。
// 之前没有白名单：渲染层可以传 `userId:agent` 绕过 `key === 'agent'` 的脱敏分支
// （在 safeStorage 不可用的机器上那读到的就是明文密钥），也能往任意全局键写东西。
const ALLOWED_SETTING_KEYS = new Set(['agent', 'ghProxy', 'map']);

ipcMain.handle('settings:get', (_e, key: string) => {
  try {
    const userId = sessionUserId(_e);
    if (!ALLOWED_SETTING_KEYS.has(String(key))) return fail('不支持的设置项：' + String(key));
    const v = store.getSetting(key, userId);
    if (key !== 'agent') return ok(v);
    const masked = maskAgentConfig(decryptAgentConfig(v as LlmConfig));
    // 告诉界面密钥来自哪里：落盘的（重启仍在）还是仅本次会话的（重启要重填）
    const sessionOnly = !hasStoredKey(userId) && sessionKeys.has(userId);
    return ok(Object.assign({}, masked, {
      hasKey: !!((masked && masked.hasKey) || sessionKeys.has(userId)),
      sessionOnly
    }));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('settings:save', (_e, key: string, value: unknown) => {
  try {
    const userId = sessionUserId(_e);
    if (!ALLOWED_SETTING_KEYS.has(String(key))) return fail('不支持的设置项：' + String(key));
    assertSize(value, LIMITS.settingJson, '设置内容');
    if (key !== 'agent') return ok(store.setSetting(key, value, userId)); // 设备级键（镜像等）不受 userId 影响；用户级键（map）必须带 userId，否则读按账号、写却落全局，地点存不住
    const incoming = Object.assign({}, (value || {}) as LlmConfig) as LlmConfig & { apiKeySessionOnly?: boolean };
    const sessionOnly = incoming.apiKeySessionOnly === true;
    delete incoming.apiKeySessionOnly;

    if (sessionOnly) {
      // 只留在内存：把密钥从要落盘的配置里摘掉，避免「选了不保存却还是写进文件」。
      // 没填新密钥但原本存过 → 把原来那把转成本次会话用，并从磁盘上一并摘掉
      // （用户勾这个选项的意思就是「别再存盘了」）。
      let key = incoming.apiKey;
      if (!key) {
        const prev = decryptAgentConfig(store.getSetting<LlmConfig>('agent', userId)) as LlmConfig | null;
        if (prev && prev.apiKey) key = prev.apiKey;
      }
      if (key) sessionKeys.set(userId, key);
      delete incoming.apiKey;
      store.setSetting('agent', Object.assign({}, incoming), userId); // 其余字段照常保存
    } else {
      // 密钥不回显给渲染层，所以「留空」表示保留原密钥：这里用存着的那份补回去，
      // 免得配置弹窗只改了个模型名就把密钥清掉。
      if (!incoming.apiKey) {
        const prev = decryptAgentConfig(store.getSetting<LlmConfig>('agent', userId)) as LlmConfig | null;
        if (prev && prev.apiKey) incoming.apiKey = prev.apiKey;
      }
      sessionKeys.delete(userId); // 改为持久保存后，本次会话的临时密钥不再需要
      store.setSetting('agent', encryptAgentConfig(incoming), userId);
    }
    return ok(Object.assign({}, maskAgentConfig(resolveAgentConfig(userId)), {
      hasKey: !!(hasStoredKey(userId) || sessionKeys.has(userId)),
      sessionOnly
    }));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 地图瓦片代理（投递地点距离）----------------
// 设计要点：渲染层不直接连瓦片服务器，改由主进程取回并以 data: URL 交出。
// 好处是刚收紧的 CSP 一行都不用改（data: 本来就在 default-src 里），渲染层继续待在沙箱中；
// 代价是这一层必须自己做好 SSRF 防护——用户能自定义瓦片地址，不拦就等于给了个读内网的工具。
import {
  BUILTIN_TILE_SOURCES, fetchTile, validateTemplate, clearTileCache, tileCacheStats, isBlockedHost
} from './tile-proxy';
import type { TileSource } from './tile-proxy';

function tileCacheDir(): string {
  return path.join(app.getPath('userData'), 'grad-resume-data', 'tile-cache');
}

/** 用户自定义瓦片源（存 map 设置里）；非法的一律当作不存在 */
function customTileSource(userId: string): TileSource | null {
  try {
    const cfg = store.getSetting<{ tiles?: { customUrl?: string; customName?: string; customDatum?: string } }>('map', userId);
    const url = cfg && cfg.tiles && cfg.tiles.customUrl;
    if (!url) return null;
    if (validateTemplate(String(url)) !== null) return null;
    return {
      id: 'custom',
      name: String((cfg.tiles && cfg.tiles.customName) || '自定义瓦片源'),
      datum: cfg.tiles && cfg.tiles.customDatum === 'gcj02' ? 'gcj02' : 'wgs84',
      url: String(url),
      attribution: '自定义源',
      maxZoom: 19
    };
  } catch (_) { return null; }
}

function resolveTileSource(userId: string, sourceId: string): TileSource | null {
  if (sourceId === 'custom') return customTileSource(userId);
  return BUILTIN_TILE_SOURCES.find((s) => s.id === sourceId) || null;
}

ipcMain.handle('map:sources', (_e) => {
  try {
    const userId = sessionUserId(_e);
    const custom = customTileSource(userId);
    return ok({
      // 只回必要字段：模板里可能带用户自己的 key，不回传给渲染层
      builtin: BUILTIN_TILE_SOURCES.map((s) => ({
        id: s.id, name: s.name, datum: s.datum, attribution: s.attribution, maxZoom: s.maxZoom, note: s.note
      })),
      hasCustom: !!custom,
      customName: custom ? custom.name : null,
      customDatum: custom ? custom.datum : null
    });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('map:tile', async (_e, sourceId: string, z: number, x: number, y: number) => {
  try {
    const userId = sessionUserId(_e);
    const src = resolveTileSource(userId, String(sourceId || ''));
    if (!src) return fail('未知的瓦片源');
    const r = await fetchTile({ source: src, z: Number(z), x: Number(x), y: Number(y), cacheDir: tileCacheDir() });
    if (!r.ok) return fail(r.error || '取瓦片失败');
    return ok({ dataUrl: r.dataUrl, cached: !!r.cached });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('map:cacheStats', (_e) => {
  try {
    sessionUserId(_e);
    const s = tileCacheStats(tileCacheDir());
    return ok({ files: s.files, bytes: s.bytes });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('map:clearCache', (_e) => {
  try {
    sessionUserId(_e);
    return ok({ removed: clearTileCache(tileCacheDir()) });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 保存/校验自定义瓦片源：把校验放在主进程，界面只负责显示错误
ipcMain.handle('map:setCustomSource', (_e, name: string, url: string, datum: string) => {
  try {
    const userId = sessionUserId(_e);
    const raw = String(url || '').trim();
    if (!raw) {
      const cfg = store.getSetting<Record<string, unknown>>('map', userId) || {};
      const tiles = Object.assign({}, (cfg as { tiles?: Record<string, unknown> }).tiles);
      delete tiles.customUrl; delete tiles.customName; delete tiles.customDatum;
      store.setSetting('map', Object.assign({}, cfg, { tiles }), userId);
      return ok({ cleared: true });
    }
    const bad = validateTemplate(raw);
    if (bad) return fail(bad);
    const cfg = store.getSetting<Record<string, unknown>>('map', userId) || {};
    const tiles = Object.assign({}, (cfg as { tiles?: Record<string, unknown> }).tiles, {
      customUrl: raw,
      customName: String(name || '').trim().slice(0, 40) || '自定义瓦片源',
      customDatum: datum === 'gcj02' ? 'gcj02' : 'wgs84'
    });
    store.setSetting('map', Object.assign({}, cfg, { tiles }), userId);
    return ok({ saved: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 招聘平台投递记录同步 ----------------
// 只读旁路：让平台页面自己完成鉴权与请求，用注入的 preload 钩住页面自己的
// fetch/XHR，把它自己发出去的 JSON 抄一份回来。
// 不逆向签名、不伪造请求、不写入平台侧任何数据，也不使用 CDP。
import * as jobSync from './job-sync';

ipcMain.handle('jobsync:platforms', async (_e) => {
  try {
    sessionUserId(_e);
    return ok(await jobSync.statusAll());
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('jobsync:open', async (_e, platformId: string) => {
  try {
    sessionUserId(_e);
    return ok(await jobSync.open(String(platformId || '')));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('jobsync:collect', async (_e, platformId: string, kind: string) => {
  try {
    sessionUserId(_e);
    const k = kind === 'collected' ? 'collected' : 'applied';
    const res = await jobSync.collect(String(platformId || ''), k);
    if (res.ok && res.items) jobSync.writeSyncState(String(platformId || ''), res.items.length);
    return ok(res);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('jobsync:reset', (_e, platformId: string) => {
  try {
    sessionUserId(_e);
    return ok(jobSync.reset(String(platformId || '')));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('jobsync:close', (_e, platformId: string) => {
  try {
    sessionUserId(_e);
    return ok(jobSync.close(String(platformId || '')));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('jobsync:logout', async (_e, platformId: string) => {
  try {
    sessionUserId(_e);
    return ok(await jobSync.logout(String(platformId || '')));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 系统加密是否可用：不可用时密钥只能明文落盘，必须让用户在保存前就知道
ipcMain.handle('secure:status', () => {
  try {
    return ok({ available: secureStore.isAvailable() });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 自动更新 ----------------
import { autoUpdater } from 'electron-updater';

// 密钥只在主进程内使用：给渲染层返回配置时把 apiKey 抹掉，只留「是否已保存」，
// 免得明文密钥出现在界面进程里（截屏/注入/前端漏洞都会顺手带走它）。
function maskAgentConfig(cfg: LlmConfig | null): (LlmConfig & { hasKey: boolean }) | null {
  if (!cfg) return null;
  const out = Object.assign({}, cfg) as LlmConfig & { hasKey: boolean };
  out.hasKey = !!cfg.apiKey;
  out.apiKey = '';
  return out;
}

function sendUpdate(ev: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', { ev, payload });
  }
}

let updaterBound = false;

function configureUpdater(): void {
  const mirror = store.getSetting<string>('ghProxy');
  // setFeedURL 是进程级状态：镜像被清空后必须显式切回默认的 GitHub feed，
  // 否则本次运行会一直用着旧镜像地址（用户以为已经关了镜像，实际没关）。
  if (mirror) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: String(mirror).replace(/\/+$/, '') + '/https://github.com/' + GH_REPO + '/releases/latest/download/'
    });
  } else {
    const [owner, repo] = String(GH_REPO).split('/');
    autoUpdater.setFeedURL({ provider: 'github', owner: owner, repo: repo });
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // 监听器只绑一次：每次手动检查都重绑会让事件重复发送、监听器无限增长
  if (updaterBound) return;
  updaterBound = true;

  autoUpdater.on('checking-for-update', () => sendUpdate('checking', {}));
  autoUpdater.on('update-available', (info) => sendUpdate('available', {
    version: info && info.version
  }));
  autoUpdater.on('update-not-available', (info) => sendUpdate('not-available', {
    version: info && info.version
  }));
  autoUpdater.on('download-progress', (p) => sendUpdate('progress', {
    percent: Math.round(p.percent), transferred: p.transferred, total: p.total, Bps: p.bytesPerSecond
  }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('downloaded', {
    version: info && info.version
  }));
  autoUpdater.on('error', (err) => sendUpdate('error', {
    message: friendlyUpdaterError(err && err.message ? err.message : String(err))
  }));
}

// 发布仓库（owner/name）。解析顺序：运行时 package.json → app-update.yml → 硬编码回退
const GH_REPO_FALLBACK = 'jettcck/grad-resume-forge';
const GH_REPO = (function () {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
      build?: { publish?: Array<{ owner?: string; repo?: string }> }
    };
    const p = pkg.build && pkg.build.publish && pkg.build.publish[0];
    if (p && p.owner && p.repo) return p.owner + '/' + p.repo;
  } catch (_) { /* 忽略 */ }
  try {
    const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'app-update.yml'), 'utf8');
    const owner = (yml.match(/^owner:\s*(\S+)/m) || [])[1];
    const repo = (yml.match(/^repo:\s*(\S+)/m) || [])[1];
    if (owner && repo) return owner + '/' + repo;
  } catch (_) { /* 忽略 */ }
  return GH_REPO_FALLBACK;
})();

// 净化更新器错误：把整页 Cloudflare HTML/响应头转成人话
function friendlyUpdaterError(raw: string): string {
  const msg = String(raw || '');
  const firstLine = msg.split('\n')[0]!.slice(0, 140);
  if (/error code: 1000|cloudflare|403/i.test(msg)) {
    return '镜像服务拒绝了请求（可能是限流或镜像不支持 latest/download 路径）。可换一个镜像前缀，或清空镜像直连 GitHub';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timed out/i.test(msg)) {
    return '连接更新服务超时。国内网络建议填写镜像前缀（如 https://gh-proxy.com），或稍后重试';
  }
  if (/sha512 checksum mismatch/i.test(msg)) {
    return '更新包校验失败（下载不完整或镜像缓存损坏），请重新检查更新';
  }
  return firstLine || '更新检查失败';
}

ipcMain.handle('updater:check', async () => {
  try {
    configureUpdater();
    await autoUpdater.checkForUpdates();
    return ok({ checking: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('updater:install', () => {
  try {
    if (!autoUpdater.isUpdaterActive()) return fail('当前为开发模式，更新仅在安装版生效');
    setImmediate(() => autoUpdater.quitAndInstall());
    return ok({ installing: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('updater:status', () => {
  try {
    return ok({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      updaterActive: autoUpdater.isUpdaterActive(),
      repo: GH_REPO,
      mirror: store.getSetting<string>('ghProxy') || ''
    });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('updater:setMirror', (_e, mirror: string) => {
  try {
    assertString(mirror, 2048, '镜像地址');
    const m = mirror.trim();
    if (m) {
      const u = new URL(m);
      if (u.protocol !== 'https:') throw new Error('镜像地址只允许 https（避免更新包被中间人篡改）');
      if (!u.hostname || isBlockedHost(u.hostname)) throw new Error('镜像地址不能指向本机或内网');
      if (u.username || u.password || u.search || u.hash) throw new Error('镜像地址不能包含账号、密码、查询参数或片段');
    }
    store.setSetting('ghProxy', m);
    return ok({ mirror: m });
  } catch (err) {
    return fail('镜像地址无效：' + (err as Error).message);
  }
});

// 启动 15 秒后静默检查一次
app.whenReady().then(() => {
  if (!gotTheLock) return; // 第二实例不查更新
  if (app.isPackaged) {
    setTimeout(() => {
      configureUpdater();
      autoUpdater.checkForUpdates().catch(() => {}); // 失败静默，不打扰用户
    }, 15000);
  }
});
