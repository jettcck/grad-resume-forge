'use strict';

// ============================================================
//  生成 PDF 导入测试样本（双栏 / 单栏）
//
//  为什么用 printToPDF 而不是手写 PDF 字节：真实简历都是浏览器/Word 排版导出的，
//  只有走同一条渲染路径（Chromium 排版 → PDF），文本项的坐标分布才有代表性。
//  手写的最小 PDF 只能验证「能读」，验证不了「双栏会不会串行」。
//
//  运行：node scripts/run-electron.js scripts/make-pdf-fixtures.js
//  产物：resume-two-column / resume-single-column / resume-sidebar / resume-table / resume-two-page
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
      <p>阿里巴巴</p>
      <p>后端开发实习生</p>
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

// 侧边栏布局：顶部姓名/联系方式「通栏」，下方左窄右宽两栏。
// 这是最考验分栏算法的形态——顶部文字横跨中缝，整页级的中缝检测会因为
// 「中部 x 区间被顶部占住了」而检测失败，进而退化成左右栏按 y 串行。
const SIDEBAR_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .head { margin-bottom: 18px; }
  .layout { display: flex; }
  .side { width: 170px; background: #f3f3f3; padding: 12px 14px; }
  .main { flex: 1; padding-left: 26px; }
  .side h2 { border-bottom: none; margin-top: 0; }
</style></head><body><div class="page">
  <div class="head">
    <h1>王五</h1>
    <div class="contact">13700000000 · wangwu@example.com · 北京 · 求职意向：后端开发工程师</div>
  </div>
  <div class="layout">
    <div class="side">
      <h2>专业技能</h2>
      <p>Java</p>
      <p>MySQL</p>
      <p>Redis</p>
      <h2>证书</h2>
      <p>CET-6</p>
      <p>软考中级</p>
    </div>
    <div class="main">
      <h2>教育背景</h2>
      <p>北京大学 软件工程 本科</p>
      <p class="muted">2018.09 - 2022.06 · GPA 3.7</p>
      <h2>实习经历</h2>
      <p>腾讯</p>
      <p>后台开发实习生</p>
      <p class="muted">2021.07 - 2021.10</p>
      <p>参与支付网关的对账模块开发</p>
      <h2>项目经历</h2>
      <p>分布式配置中心（课程项目）</p>
      <p>基于 Raft 的一致性存储，支持灰度发布</p>
    </div>
  </div>
</div></body></html>`;

// 表格排版：技能表 + 获奖表。单元格文本在同一视觉行上被拼成一行
// （「Java 精通 3 年」），要验证这种行不会破坏分节与条目解析。
const TABLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; font-size: 12.5px; }
  th { background: #f2f2f2; font-weight: 600; }
</style></head><body><div class="page">
  <h1>赵六</h1>
  <div class="contact">13600000000 · zhaoliu@example.com · 深圳</div>
  <h2>教育背景</h2>
  <p>中山大学 计算机科学与技术 本科</p>
  <p class="muted">2017.09 - 2021.06 · GPA 3.5</p>
  <h2>专业技能</h2>
  <table>
    <tr><th>技能</th><th>熟练度</th><th>使用年限</th></tr>
    <tr><td>Java</td><td>精通</td><td>3 年</td></tr>
    <tr><td>MySQL</td><td>熟练</td><td>2 年</td></tr>
    <tr><td>Redis</td><td>熟练</td><td>2 年</td></tr>
  </table>
  <h2>实习经历</h2>
  <p>华为</p>
  <p>软件开发实习生</p>
  <p class="muted">2020.07 - 2020.10</p>
  <p>参与基站配置管理系统的模块开发</p>
  <h2>获奖情况</h2>
  <table>
    <tr><th>奖项</th><th>级别</th><th>年份</th></tr>
    <tr><td>ACM 校赛</td><td>二等奖</td><td>2019</td></tr>
    <tr><td>国家励志奖学金</td><td>国家级</td><td>2020</td></tr>
  </table>
</div></body></html>`;

// 多页：显式分页（page-break-after），页脚用 position:fixed 让每页都打印。
// 不靠「内容溢出」来分页——printToPDF 会按纸张缩放，行数估算容易失手（试过 36 行仍是一页）。
const TWO_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
  .page { width: 794px; padding: 46px 54px; }
  .break { page-break-after: always; }
</style></head><body>
  <div class="page break">
    <h1>孙七</h1>
    <div class="contact">13500000000 · sunqi@example.com · 成都</div>
    <h2>教育背景</h2>
    <p>四川大学 软件工程 本科</p>
    <p class="muted">2018.09 - 2022.06 · GPA 3.6</p>
    <h2>专业技能</h2>
    <p>Java / Spring / MySQL / Redis</p>
    <h2>实习经历</h2>
    <p>美团</p>
    <p>后端开发实习生</p>
    <p class="muted">2021.07 - 2021.12</p>
    <p>负责商家后台的订单查询接口优化，将列表页响应时间从 800ms 降到 220ms。</p>
    <p>参与缓存层的设计，把热点店铺信息预热到 Redis，命中率提升到 92%。</p>
  </div>
  <div class="page">
    <p>继续：整理了接口文档与压测脚本，交付给后续接手的同学使用。</p>
    <p>继续：协助排查线上慢查询，补充了两个联合索引。</p>
    <p>继续：参与周会汇报与代码评审，累计提交 30 余个 MR。</p>
    <h2>项目经历</h2>
    <p>校园二手交易平台（独立开发）</p>
    <p>前后端分离，支持商品发布、搜索与站内私信</p>
  </div>
</body></html>`;

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
    await render(win, SIDEBAR_HTML, path.join(OUT_DIR, 'resume-sidebar.pdf'));
    await render(win, TABLE_HTML, path.join(OUT_DIR, 'resume-table.pdf'));
    await render(win, TWO_PAGE_HTML, path.join(OUT_DIR, 'resume-two-page.pdf'));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  console.log('完成');
  app.exit(0);
}).catch((err) => {
  console.error('FAILED: ' + (err && err.message ? err.message : err));
  app.exit(1);
});
