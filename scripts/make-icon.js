'use strict';

// ============================================================
//  生成应用图标 build/icon.png（512×512，带透明圆角）
//  Linux 打包必须有图标；Windows 也一直缺（此前一直用 Electron 默认图标）。
//  用 Electron 渲染品牌标记再截图——与 App 内视觉一致，无额外依赖。
//  运行：npx electron scripts/make-icon.js --no-sandbox --disable-gpu
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'icon.png');
const SIZE = 512;

const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  html, body { margin: 0; padding: 0; width: ${SIZE}px; height: ${SIZE}px; background: transparent; overflow: hidden; }
  .tile {
    width: ${SIZE}px; height: ${SIZE}px; box-sizing: border-box;
    border-radius: 116px;
    background:
      radial-gradient(120% 120% at 28% 18%, #1d2637 0%, #131a27 52%, #0b1018 100%);
    display: flex; align-items: center; justify-content: center;
    position: relative;
    border: 2px solid rgba(255, 176, 30, 0.22);
  }
  .glow {
    position: absolute; width: 430px; height: 430px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 107, 53, 0.32) 0%, rgba(255, 107, 53, 0.10) 42%, transparent 68%);
  }
  .mark {
    position: relative;
    font-family: "Segoe UI Symbol", "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 268px; line-height: 1;
    background: linear-gradient(135deg, #ffe3a3 0%, #ffb01e 46%, #ff6b35 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    text-shadow: 0 0 42px rgba(255, 138, 46, 0.42);
  }
  .spark {
    position: absolute; top: 96px; right: 104px;
    width: 20px; height: 20px; border-radius: 50%;
    background: #ffd479; box-shadow: 0 0 26px 10px rgba(255, 212, 121, 0.5);
  }
</style></head>
<body>
  <div class="tile">
    <div class="glow"></div>
    <div class="mark">&#9670;</div>
    <div class="spark"></div>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600)); // 等字体与渐变渲染完成
  const image = await win.webContents.capturePage();
  // capturePage 返回设备像素（本机 DPI 缩放 1.5 → 768px），统一缩放回 512 保证确定性
  const icon = image.resize({ width: SIZE, height: SIZE, quality: 'best' });

  // 单文件图标：Windows/macOS 用（electron-builder 会据此生成 .ico）
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, icon.toPNG());
  console.log(`icon written: ${OUT}  ${icon.getSize().width}x${icon.getSize().height}  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);

  // 多尺寸图标集：Linux 用（build/icons/<W>x<H>.png，electron-builder 直接按尺寸归位，
  // 不依赖它对单文件图标的尺寸解析——单文件曾导致落到 hicolor/0x0/）
  const setDir = path.join(ROOT, 'build', 'icons');
  fs.mkdirSync(setDir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  sizes.forEach((s) => {
    const resized = icon.resize({ width: s, height: s, quality: 'best' });
    fs.writeFileSync(path.join(setDir, `${s}x${s}.png`), resized.toPNG());
  });
  console.log(`icon set written: ${setDir}  (${sizes.join(', ')})`);

  app.exit(0);
});
