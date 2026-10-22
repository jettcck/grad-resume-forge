'use strict';

// ============================================================
//  生成 PDF 导入测试样本（双栏 / 单栏）
//
//  为什么用 printToPDF 而不是手写 PDF 字节：真实简历都是浏览器/Word 排版导出的，
//  只有走同一条渲染路径（Chromium 排版 → PDF），文本项的坐标分布才有代表性。
//  手写的最小 PDF 只能验证「能读」，验证不了「双栏会不会串行」。
//
//  运行：node scripts/run-electron.js scripts/make-pdf-fixtures.js
//  产物：test-fixtures/resume-two-column.pdf / resume-single-column.pdf
// ============================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// 与既有样本放一起（smoke-pdf-import.js 从 test-fixtures/ 读）
const OUT_DIR = path.join(__dirname, '..', 'test-fixtures');

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 13px; color: #222; }
  .page { width: 794px; padding: 46px 54px; }
  h1 { font-size: 22px; margin-bottom: 6px; }
  .contact { color: #555; font-size: 12px; margin-bottom: 18px; }
  h2 { font-size: 14px; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #bbb; }
  p { line-height: 1.75; margin-bottom: 4px; }
  .muted { color: #666; }
`;

// 双栏：左栏教育/技能，右栏实习/项目。
// 两栏内容在同一视觉高度上完全不同——这正是 hasEOL 会串行、按 y 聚行也会拼错的场景。
const TWO_COLUMN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .cols { display: flex; gap: 34px; }
  .col { width: 50%; }
</style></head><body><div class="page">
  <h1>张三</h1>
  <div class="contact">13800000000 · zhangsan@example.com · 杭州</div>
  <div class="cols">
    <div class="col">
      <h2>教育背景</h2>
      <p>浙江大学 计算机科学与技术 本科</p>
      <p class="muted">2020.09 - 2024.06 · GPA 3.8</p>
      <h2>专业技能</h2>
      <p>Java / Spring Boot / MySQL</p>
      <p>Redis / 消息队列 / 分布式</p>
      <h2>获奖情况</h2>
      <p>校级一等奖学金（2022）</p>
    </div>
    <div class="col">
      <h2>实习经历</h2>
      <p>阿里巴巴 后端开发实习生</p>
      <p class="muted">2023.06 - 2023.09</p>
      <p>负责订单系统的接口优化</p>
      <h2>项目经历</h2>
      <p>简历锻造炉（独立开发）</p>
      <p>Electron + TypeScript，本地优先</p>
      <p>内置可控 Agent 与评测体系</p>
    </div>
  </div>
</div></body></html>`;

const SINGLE_COLUMN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
  <h1>李四</h1>
  <div class="contact">13900000000 · lisi@example.com · 上海</div>
  <h2>教育背景</h2>
  <p>复旦大学 软件工程 本科</p>
  <p class="muted">2019.09 - 2023.06 · GPA 3.6</p>
  <h2>实习经历</h2>
  <p>字节跳动 前端开发实习生</p>
  <p class="muted">2022.07 - 2022.10</p>
  <p>负责组件库的维护与文档站搭建</p>
  <h2>项目经历</h2>
  <p>在线协作文档编辑器</p>
  <p>基于 CRDT 的多人实时编辑，支持离线</p>
  <h2>专业技能</h2>
  <p>JavaScript / TypeScript / React</p>
</div></body></html>`;

// 注意：不要用 offscreen: true —— 本机 GPU 进程起不来时 data:text/html 会直接 ERR_FAILED。
// 普通隐藏窗口（show:false）同样不显示界面，但渲染走正常路径。
// 另一个坑：连续创建两个隐藏窗口，第二个的 loadURL 会失败；复用一个窗口就稳定。
function createWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
}

async function render(win, html, outFile) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const data = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'none' }
  });
  fs.writeFileSync(outFile, data);
  console.log('  ✓ ' + path.basename(outFile) + '  ' + Math.round(data.length / 1024) + ' KB');
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('生成 PDF 样本 →', OUT_DIR);
  const win = createWindow();
  try {
    await render(win, TWO_COLUMN_HTML, path.join(OUT_DIR, 'resume-two-column.pdf'));
    await render(win, SINGLE_COLUMN_HTML, path.join(OUT_DIR, 'resume-single-column.pdf'));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  console.log('完成');
  app.exit(0);
}).catch((err) => {
  console.error('FAILED: ' + (err && err.message ? err.message : err));
  app.exit(1);
});
