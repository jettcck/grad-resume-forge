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
    const cfg = store.getSetting('agent') || {};
    const client = createLlmClient(cfg);
    const st = await client.status();
    return ok({ ...st, config: client.config, provider: client.provider });
  } catch (err) {
    return fail(err.message);
  }
});

// 运行 Agent：分析 JD → 上下文裁剪 → LLM 改写 → 确定性校验门 → 复测
// 步骤经 'agent:progress'、LLM 分片经 'agent:stream' 实时推送到渲染层
ipcMain.handle('agent:run', async (_e, profile, jdText, opts) => {
  try {
    const cfg = Object.assign({}, store.getSetting('agent') || {}, opts || {});
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
    const result = await agent.runAgent(profile, jdText, { llm, onStep: send, onChunk: sendStream });
    return ok(result);
  } catch (err) {
    return fail(err.message);
  }
});

// 全局设置读写（Agent 模型 / 端点 / 温度）
ipcMain.handle('settings:get', (_e, key) => {
  try {
    return ok(store.getSetting(key));
  } catch (err) {
    return fail(err.message);
  }
});

ipcMain.handle('settings:save', (_e, key, value) => {
  try {
    return ok(store.setSetting(key, value));
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
    message: err && err.message ? err.message : String(err)
  }));
}

// 发布仓库（owner/name），package.json 的 build.publish 为权威来源
const GH_REPO = (function () {
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    const p = pkg.build && pkg.build.publish && pkg.build.publish[0];
    return p && p.owner ? p.owner + '/' + p.repo : '';
  } catch (_) { return ''; } // eslint-disable-line no-empty
})();

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
