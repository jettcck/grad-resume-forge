'use strict';

// ============================================================
//  主进程入口（TypeScript 版）
// ============================================================

import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';

import * as store from './store';
import * as auth from './auth';
import * as engine from './resume-engine';
import { createLlmClient } from './llm-client';
import { detectLocalServices } from './local-detect';
import * as interview from './interview';
import * as secureStore from './secure-store';
import { LIMITS, assertSize, assertPlainObject } from './validate';
// 运行记录与回放来自 agent-core（与 Electron 解耦的 Agent Runtime）
import { createFileRunStore, replayRun } from '../../packages/agent-core/dist/index';
import type { IpcResult, Profile, LlmConfig, Application } from './types';

let mainWindow: BrowserWindow | null = null;

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
      sandbox: false
    }
  });

  // dist/main → 渲染层源码在 src/renderer（TS 编译只处理主进程）
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'));

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
  });

  mainWindow.once('ready-to-show', () => mainWindow!.show());

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
    rememberSession(_e, (r as { id?: string }).id);
    return ok(r);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('auth:logout', (_e, token: string) => {
  try {
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
    const list = Array.isArray(accepted) ? accepted as never[] : [];
    assertSize(profile, LIMITS.profileJson, '档案');
    return ok(agent.applyRewritesToProfile(profile, list));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('resume:audit', (_e, text: string) => {
  try {
    return ok(engine.auditAiFlavor(text));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 粘贴 JD 精准匹配
ipcMain.handle('resume:matchJd', (_e, resume: Parameters<typeof engine.matchJd>[0], jdText: string) => {
  try {
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
ipcMain.handle('backups:list', () => {
  try {
    return ok({ items: store.listBackups(), dir: store.backupsPath() });
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('backups:restore', (_e, name: string) => {
  try {
    return ok(store.restoreBackup(name));
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('backups:reveal', () => {
  try {
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
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: '导出简历 PDF',
      defaultPath: (suggestedName || 'resume') + '.pdf',
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
ipcMain.handle('agent:status', async () => {
  try {
    const cfg: LlmConfig = (decryptAgentConfig(store.getSetting<LlmConfig>('agent')) as LlmConfig) || { provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' };
    // embedded：读渲染进程上报的状态（渲染层启动时会主动上报一次）
    const client = cfg.provider === 'embedded' ? embeddedLlmClient() : createLlmClient(cfg);
    const st = await client.status();
    return ok({ ...st, config: client.config, provider: client.provider });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 运行 Agent：mode='pipeline'（默认）/ 'agentic' / 'rules'（零下载规则通道，不调模型）
// ---------------- Agent 运行记录与取消（第二阶段：Runtime 化）----------------
// 运行记录单独存 JSONL（不进 db.json：避免主数据文件被日志撑大或被坏日志牵连）。
let runStore: ReturnType<typeof createFileRunStore> | null = null;
function getRunStore() {
  if (!runStore) {
    runStore = createFileRunStore(path.join(app.getPath('userData'), 'grad-resume-data', 'agent-runs.jsonl'), { maxRuns: 50 });
  }
  return runStore;
}
/** 正在运行的 runId → 取消控制器：用户点取消时用它中断 */
const activeRuns = new Map<string, AbortController>();

ipcMain.handle('agent:cancel', (_e, runId: string) => {
  try {
    const ctl = activeRuns.get(String(runId || ''));
    if (!ctl) return fail('这次运行已经结束或不存在');
    ctl.abort();
    return ok({ cancelled: true });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 列表只回摘要：trace 与结果明细按 runId 单独取，避免一次拉回几十条大步数记录
ipcMain.handle('agent:runs', (_e, limit?: number) => {
  try {
    const list = getRunStore().list(Math.min(Math.max(Number(limit) || 10, 1), 50)).map((r) => ({
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
    const rec = getRunStore().get(String(runId || ''));
    if (!rec) return fail('没有找到这条运行记录');
    return ok(rec);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('agent:clearRuns', () => {
  try {
    return ok({ cleared: getRunStore().clear() });
  } catch (err) {
    return fail((err as Error).message);
  }
});

// 回放：用当前工具实现按记录重跑一次，不消耗模型调用（复盘「当时为什么拒了这条」）
ipcMain.handle('agent:replay', async (_e, runId: string, profile: Partial<Profile>, jdText: string) => {
  try {
    const rec = getRunStore().get(String(runId || ''));
    if (!rec) return fail('没有找到这条运行记录');
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
    const o = opts || {};
    const rulesOnly = o.mode === 'rules';
    const cfg = Object.assign({}, decryptAgentConfig(store.getSetting<LlmConfig>('agent')) || {}, o);
    assertPlainObject(profile, '档案');
    assertSize(profile, LIMITS.profileJson, '档案');
    assertSize(jdText, LIMITS.jdText, '职位描述');
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
    // runId 由渲染层给出：这样用户点「取消」时主进程能立刻找到对应的运行
    const runId = String(o.runId || ('run_' + Date.now().toString(36)));
    const ctl = new AbortController();
    activeRuns.set(runId, ctl);
    try {
      const runner = o.mode === 'agentic' ? agent.agenticLoop : agent.runAgent;
      const result = await runner(profile, jdText, {
        llm, onStep: send, onChunk: sendStream,
        runId, taskId: 'resume-optimize', runStore: getRunStore(), signal: ctl.signal
      } as never);
      return ok(result);
    } finally {
      activeRuns.delete(runId);
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
    return ok(interview.prepareInterview(profile, opts || {}));
  } catch (err) {
    return fail((err as Error).message);
  }
});

// ---------------- 小助手（知识库问答，纯本地零模型） ----------------
ipcMain.handle('assistant:ask', (_e, query: string, domainHint?: string) => {
  try {
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

ipcMain.handle('settings:get', (_e, key: string) => {
  try {
    const userId = sessionUserId(_e);
    const v = store.getSetting(key, userId);
    return ok(key === 'agent' ? maskAgentConfig(decryptAgentConfig(v as LlmConfig)) : v);
  } catch (err) {
    return fail((err as Error).message);
  }
});

ipcMain.handle('settings:save', (_e, key: string, value: unknown) => {
  try {
    const userId = sessionUserId(_e);
    assertSize(value, LIMITS.settingJson, '设置内容');
    if (key !== 'agent') return ok(store.setSetting(key, value)); // 设备级设置（镜像等）不按账号隔离
    const incoming = Object.assign({}, (value || {}) as LlmConfig);
    // 密钥不回显给渲染层，所以「留空」表示保留原密钥：这里用存着的那份补回去，
    // 免得配置弹窗只改了个模型名就把密钥清掉。
    if (!incoming.apiKey) {
      const prev = decryptAgentConfig(store.getSetting<LlmConfig>('agent', userId)) as LlmConfig | null;
      if (prev && prev.apiKey) incoming.apiKey = prev.apiKey;
    }
    const saved = store.setSetting('agent', encryptAgentConfig(incoming), userId);
    return ok(maskAgentConfig(decryptAgentConfig(saved as LlmConfig)));
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
    const m = String(mirror || '').trim();
    if (m) {
      const u = new URL(m);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('镜像地址仅支持 http/https');
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
