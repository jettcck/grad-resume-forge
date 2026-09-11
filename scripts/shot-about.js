'use strict';

// 专用截图：只截「关于」弹窗的更新检查状态（不跑整条管线，避免陈旧帧）
// 运行：npx electron scripts/shot-about.js --no-sandbox
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots', 'about-update.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ ok: true, data });
const fail = (e) => ({ ok: false, error: String((e && e.message) || e) });

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
    try { return ok(await fn(...a)); } catch (err) { return fail(err); }
  });
  h('updater:status', () => ({
    version: '1.6.1', isPackaged: true, updaterActive: true,
    repo: 'jettcck/grad-resume-forge', mirror: 'https://gh-proxy.com'
  }));
  h('updater:check', () => ({ started: true }));
  h('updater:setMirror', (m) => ({ mirror: m }));
  h('updater:install', () => ({ installing: true }));
  h('shell:openExternal', (u) => ({ opened: u }));
  h('settings:get', () => null);
  h('settings:save', (_k, v) => v);
  // 登录页会调用的最小集
  h('auth:session', () => null);
}

app.whenReady().then(async () => {
  registerIpc();
  const win = new BrowserWindow({
    width: 1000, height: 720, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.show();
  await sleep(1500);

  // 直接露出主界面并打开「关于」（无需登录：弹窗只依赖 updater IPC）
  await win.webContents.executeJavaScript(`(() => {
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'block';
    document.getElementById('btn-about').click();
    return true;
  })()`);
  await sleep(800);

  // 推一个"发现新版本并下载中"的事件，看进度条与配色
  win.webContents.send('updater:event', { ev: 'available', payload: { version: '1.6.2' } });
  await sleep(200);
  win.webContents.send('updater:event', { ev: 'progress', payload: { percent: 62, version: '1.6.2' } });
  await sleep(1200);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('shot:', OUT, img.getSize().width + 'x' + img.getSize().height);

  // 再截一张"已是最新版本"的成功态
  win.webContents.send('updater:event', { ev: 'not-available', payload: {} });
  await sleep(1200);
  const img2 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'shots', 'about-latest.png'), img2.toPNG());
  console.log('shot: about-latest.png');

  app.exit(0);
});
