const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const auth = require('./auth');
const engine = require('./resume-engine');

let mainWindow = null;

function createWindow() {
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

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const levels = ['LOG', 'WARN', 'ERROR'];
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = String(sourceId || '').split(/[\\/]/).pop();
    console.log(`[renderer:${levels[level] || level}] ${message}  (${src}:${line})`);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.log('[preload-error]', preloadPath, error && error.stack ? error.stack : error);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[render-process-gone]', JSON.stringify(details));
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function ok(data) {
  return { ok: true, data };
}
function fail(message) {
  return { ok: false, error: message };
}

ipcMain.handle('auth:register', (_e, payload) => {
  try {
    return ok(auth.register(payload));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('auth:login', (_e, payload) => {
  try {
    return ok(auth.login(payload));
  } catch (err) {
    return fail(err.message);
  }
});

// 用本地 token 恢复登录态（免重复输入）
ipcMain.handle('auth:session', (_e, token) => {
  try {
    return ok(auth.resumeSession(token));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('auth:logout', (_e, token) => {
  try {
    return ok(auth.logout(token));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('profile:get', (_e, userId) => {
  try {
    return ok(store.getProfile(userId));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('profile:save', (_e, userId, profile) => {
  try {
    return ok(store.saveProfile(userId, profile));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('resume:generate', (_e, profile, options) => {
  try {
    return ok(engine.generate(profile, options || {}));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('resume:audit', (_e, text) => {
  try {
    return ok(engine.auditAiFlavor(text));
  } catch (err) {
    return fail(err.message);
  }
});

// 粘贴 JD 精准匹配：按这份 JD 实际提到的技能逐项比对简历（本地词库）
ipcMain.handle('resume:matchJd', (_e, resume, jdText) => {
  try {
    return ok(engine.matchJd(resume, jdText));
  } catch (err) {
    return fail(err.message);
  }
});

// 导入旧简历（PDF / TXT）：弹系统选择框 → 本地解析 → 返回档案片段供预览确认
ipcMain.handle('resume:importPdf', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入旧简历',
      filters: [
        { name: '简历文件', extensions: ['pdf', 'txt'] },
        { name: 'PDF 文档', extensions: ['pdf'] },
        { name: '文本文件', extensions: ['txt'] }
      ],
      properties: ['openFile']
    });
    if (canceled || !filePaths || !filePaths[0]) return ok(null); // 用户取消

    const importer = require('./resume-importer');
    // data/ 目录随包分发；开发与打包均为应用根目录下
    const dataRoot = path.join(__dirname, '..', '..', 'data');
    const result = await importer.importFromFile(filePaths[0], dataRoot);
    return ok(result);
  } catch (err) {
    return fail(err.message);
  }
});

// ---------------- Agent：本地 Ollama / 云端 OpenAI 兼容（可切换） ----------------
const { createLlmClient } = require('./llm-client');
const agent = require('./agent');

// 探测模型服务；返回 { available, models, config }（云端含 error 说明）
ipcMain.handle('agent:status', async () => {
  try {
    const cfg = decryptAgentConfig(store.getSetting('agent')) || {};
    const client = createLlmClient(cfg);
    const st = await client.status();
    return ok({ ...st, config: client.config, provider: client.provider });
  } catch (err) {
    return fail(err.message);
  }
});

// 运行 Agent：mode='pipeline'（默认，确定性编排）或 'agentic'（LLM 原生
// function-calling 自主选工具循环）。步骤经 'agent:progress' 实时推送渲染层。
ipcMain.handle('agent:run', async (_e, profile, jdText, opts) => {
  try {
    const o = opts || {};
    const cfg = Object.assign({}, decryptAgentConfig(store.getSetting('agent')) || {}, o);
    const llm = createLlmClient(cfg);
    const send = (s) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:progress', s);
      }
    };
    const sendStream = (piece, round) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:stream', { round, piece });
      }
    };
    const runner = o.mode === 'agentic' ? agent.agenticLoop : agent.runAgent;
    const result = await runner(profile, jdText, { llm, onStep: send, onChunk: sendStream });
    return ok(result);
  } catch (err) {
    return fail(err.message);
  }
});

// 全局设置读写（Agent 模型 / 端点 / 密钥）
// apiKey 落盘前经 safeStorage 加密（Windows DPAPI），读取时解密；
// safeStorage 不可用的环境降级明文并保持向前兼容。
const secureStore = require('./secure-store');

function encryptAgentConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = Object.assign({}, cfg);
  if (typeof out.apiKey === 'string' && out.apiKey && !secureStore.isEncrypted(out.apiKey)) {
    out.apiKey = secureStore.encryptString(out.apiKey);
  }
  return out;
}

function decryptAgentConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  const out = Object.assign({}, cfg);
  if (typeof out.apiKey === 'string' && secureStore.isEncrypted(out.apiKey)) {
    out.apiKey = secureStore.decryptString(out.apiKey);
  }
  return out;
}

ipcMain.handle('settings:get', (_e, key) => {
  try {
    const v = store.getSetting(key);
    return ok(key === 'agent' ? decryptAgentConfig(v) : v);
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('settings:save', (_e, key, value) => {
  try {
    const v = key === 'agent' ? encryptAgentConfig(value) : value;
    return ok(key === 'agent' ? decryptAgentConfig(store.setSetting(key, v)) : store.setSetting(key, v));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('applications:list', (_e, userId) => {
  try {
    return ok(store.listApplications(userId));
  } catch (err) {
    return fail(err.message);
  }
});

// ---------------- Agent 快照（改写应用前的后悔药） ----------------
ipcMain.handle('snapshots:save', (_e, userId, label, profile) => {
  try {
    if (!store.findUserById(userId)) return fail('用户不存在');
    return ok(store.saveAgentSnapshot(userId, label, profile));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('snapshots:list', (_e, userId) => {
  try {
    return ok(store.listAgentSnapshots(userId));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('snapshots:get', (_e, userId, snapshotId) => {
  try {
    const profile = store.getAgentSnapshot(userId, snapshotId);
    if (!profile) return fail('快照不存在或已删除');
    return ok(profile);
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('snapshots:restore', (_e, userId, snapshotId) => {
  try {
    const profile = store.getAgentSnapshot(userId, snapshotId);
    if (!profile) return fail('快照不存在或已删除');
    return ok(store.saveProfile(userId, profile));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('snapshots:delete', (_e, userId, snapshotId) => {
  try {
    return ok(store.deleteAgentSnapshot(userId, snapshotId));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('applications:save', (_e, userId, app_) => {
  try {
    return ok(store.saveApplication(userId, app_));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('applications:delete', (_e, userId, appId) => {
  try {
    return ok(store.deleteApplication(userId, appId));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('resume:exportPdf', async (_e, html, suggestedName) => {
  // 离屏渲染 PDF；无论成功失败都要销毁隐藏窗口，避免进程泄漏
  let data;
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true }
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
    return fail('PDF 渲染失败：' + err.message);
  } finally {
    if (!pdfWin.isDestroyed()) pdfWin.destroy();
  }

  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出简历 PDF',
      defaultPath: (suggestedName || 'resume') + '.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) return fail('已取消导出');

    fs.writeFileSync(filePath, data);
    return ok({ filePath });
  } catch (err) {
    return fail(err.message);
  }
});

// 复制文本到系统剪贴板（用于「复制纯文本简历」，粘贴到招聘网站 / 邮件）
ipcMain.handle('clipboard:writeText', (_e, text) => {
  try {
    clipboard.writeText(String(text == null ? '' : text));
    return ok({ done: true });
  } catch (err) {
    return fail(err.message);
  }
});

// 用系统默认浏览器打开外部链接（仅允许 http/https，防止协议注入）
ipcMain.handle('shell:openExternal', async (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return fail('仅支持打开 http/https 链接');
    }
    await shell.openExternal(u.href);
    return ok({ opened: u.href });
  } catch (err) {
    return fail('链接无效：' + err.message);
  }
});

// ---------------- 自动更新（electron-updater + GitHub Releases） ----------------
// 打包发布（npm run dist → GitHub Release）后，用户端启动即静默检查更新；
// 下载完成弹窗提示「重启安装」。国内网络对 GitHub 不稳，提供镜像前缀兜底
// （ghProxy 设置存于 db.json，用户可在「关于/更新」里改）。
const { autoUpdater } = require('electron-updater');

function sendUpdate(ev, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', { ev, payload });
  }
}

function configureUpdater() {
  const mirror = store.getSetting('ghProxy');
  if (mirror) {
    // 通用 GitHub 反代前缀：https://ghproxy.cn/https://github.com/…
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: String(mirror).replace(/\/+$/, '') + '/https://github.com/' + GH_REPO + '/releases/latest/download/'
    });
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 用户不点重启，退出时也会装上
  autoUpdater.allowPrerelease = false;

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

// 发布仓库（owner/name）。解析顺序：
// 1) 运行时 package.json 的 build.publish（开发环境有效）
// 2) app-update.yml（electron-builder 打包时生成在 resources/ 下，安装版权威来源）
// 3) 硬编码回退（防止两者都被剥离时镜像 URL 拼出空段）
const GH_REPO_FALLBACK = 'jettcck/grad-resume-forge';
const GH_REPO = (function () {
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    const p = pkg.build && pkg.build.publish && pkg.build.publish[0];
    if (p && p.owner && p.repo) return p.owner + '/' + p.repo;
  } catch (_) {} // eslint-disable-line no-empty
  try {
    // 安装版：resources/app-update.yml 由 electron-builder 生成，含完整 GitHub 配置
    const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'app-update.yml'), 'utf8');
    const owner = (yml.match(/^owner:\s*(\S+)/m) || [])[1];
    const repo = (yml.match(/^repo:\s*(\S+)/m) || [])[1];
    if (owner && repo) return owner + '/' + repo;
  } catch (_) {} // eslint-disable-line no-empty
  return GH_REPO_FALLBACK;
})();

// 净化更新器错误：electron-updater 会把整页 Cloudflare HTML/响应头塞进 message，
// 用户只需要一句人话 + 首行细节
function friendlyUpdaterError(raw) {
  const msg = String(raw || '');
  const firstLine = msg.split('\n')[0].slice(0, 140);
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
    return fail(err.message);
  }
});

ipcMain.handle('updater:install', () => {
  try {
    // isUpdaterActive：非打包环境（npm start）下是 false，静默拒绝避免崩溃
    if (!autoUpdater.isUpdaterActive()) return fail('当前为开发模式，更新仅在安装版生效');
    setImmediate(() => autoUpdater.quitAndInstall());
    return ok({ installing: true });
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('updater:status', () => {
  try {
    return ok({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      updaterActive: autoUpdater.isUpdaterActive(),
      repo: GH_REPO,
      mirror: store.getSetting('ghProxy') || ''
    });
  } catch (err) {
    return fail(err.message);
  }
});

// 保存/清除镜像前缀；空串 = 直连 GitHub
ipcMain.handle('updater:setMirror', (_e, mirror) => {
  try {
    const m = String(mirror || '').trim();
    if (m) {
      const u = new URL(m);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('镜像地址仅支持 http/https');
    }
    store.setSetting('ghProxy', m);
    return ok({ mirror: m });
  } catch (err) {
    return fail('镜像地址无效：' + err.message);
  }
});

// 启动 15 秒后静默检查一次（错开启动高峰，不打断首屏）
app.whenReady().then(() => {
  if (app.isPackaged) {
    setTimeout(() => {
      configureUpdater();
      autoUpdater.checkForUpdates().catch(() => {}); // 失败静默，不打扰用户
    }, 15000);
  }
});
