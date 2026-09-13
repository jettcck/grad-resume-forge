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
  // 「关于」弹窗里的数据备份区（真实形状：{ items: [{ name, size, createdAt }] }）
  const base = Date.now();
  h('backups:list', () => ({
    items: [
      { name: 'db-20260913-051500123.json', size: 18.4 * 1024, createdAt: base - 2 * 3600e3 },
      { name: 'db-20260913-031500123.json', size: 17.9 * 1024, createdAt: base - 6 * 3600e3 },
      { name: 'db-20260912-221500123.json', size: 15.2 * 1024, createdAt: base - 26 * 3600e3 }
    ]
  }));
  h('backups:restore', (name) => ({ restored: name }));
  h('backups:reveal', () => ({ opened: true }));
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

  // 第三张：数据备份区（滚到弹窗底部）
  const scrolled = await win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector('.backup-box');
    if (!box) return 'no-backup-box';
    box.scrollIntoView({ block: 'center' });
    return 'rows=' + box.querySelectorAll('.backup-row').length
      + ' restoreBtn=' + box.querySelectorAll('button').length;
  })()`);
  console.log('backup section:', scrolled);
  await sleep(600);

  // 无图可看的替代验证：备份行没被裁掉、文字没溢出、按钮可点区域够大
  const layout = await win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector('.backup-box');
    const rows = Array.from(box.querySelectorAll('.backup-row'));
    const dialog = box.closest('[class*=modal], [class*=dialog], .about-wrap') || box.parentElement;
    const bad = [];
    rows.forEach((r, i) => {
      const t = r.querySelector('.bk-time'), s = r.querySelector('.bk-size');
      [['time', t], ['size', s]].forEach(([what, node]) => {
        if (!node) return bad.push('row' + i + ' 缺 ' + what);
        if (!node.textContent.trim()) bad.push('row' + i + ' ' + what + ' 文本为空');
        if (node.scrollWidth > node.clientWidth + 2) bad.push('row' + i + ' ' + what + ' 文字溢出');
        const cs = getComputedStyle(node);
        if (parseFloat(cs.fontSize) < 10.5) bad.push('row' + i + ' ' + what + ' 字号过小 ' + cs.fontSize);
      });
      const btns = Array.from(r.querySelectorAll('button'));
      if (btns.length < 1) bad.push('row' + i + ' 没有恢复按钮');
      btns.forEach((b) => { const rect = b.getBoundingClientRect(); if (rect.height < 20) bad.push('row' + i + ' 按钮太矮 ' + rect.height); });
    });
    const allBtns = box.querySelectorAll('button');
    if (allBtns.length < rows.length + 1) bad.push('缺少「打开备份文件夹」入口（按钮数 ' + allBtns.length + '）');
    const dRect = dialog.getBoundingClientRect();
    if (dRect.width > window.innerWidth) bad.push('弹窗横向溢出窗口');
    return JSON.stringify({ rows: rows.length, bad, dialogH: Math.round(dRect.height), winH: window.innerHeight });
  })()`);
  console.log('backup layout:', layout);

  const img3 = await win.webContents.capturePage();
  fs.writeFileSync(path.join(ROOT, 'shots', 'about-backups.png'), img3.toPNG());
  console.log('shot: about-backups.png');

  app.exit(0);
});
