'use strict';

// ============================================================
//  PDF 导入冒烟：在【Electron 的 Node 版本】下跑真实导入器
//  为什么必须用 Electron 跑：Electron 33 内置 Node 20.18，不支持 require(.mjs)；
//  而开发机上的 Node 24 支持。tsc 会把手写的 import() 降级成 require()，
//  于是「本地全绿、打包必炸」——这个脚本就是专门堵这个洞的。
//  运行：npx electron scripts/smoke-pdf-import.js
// ============================================================
const path = require('path');
const fs = require('fs');

let pass = 0, failCnt = 0;
const t = (cond, msg) => {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
};

const { app } = require('electron');

app.whenReady().then(async () => {
  console.log('运行环境：Electron ' + process.versions.electron + ' | Node ' + process.versions.node);

  const importer = require(path.join(__dirname, '..', 'dist', 'main', 'resume-importer.js'));

  // 夹具：仓库里带的示例简历 PDF（也可用命令行传入别的路径）
  const fixtures = process.argv.slice(2).filter((a) => /\.pdf$/i.test(a));
  const files = fixtures.length
    ? fixtures
    : [path.join(__dirname, '..', 'test-fixtures', 'resume-sample-ats-classic.pdf')];

  for (const file of files) {
    if (!fs.existsSync(file)) { t(false, '样本 PDF 存在：' + path.basename(file)); continue; }
    let res = null, err = null;
    try {
      res = await importer.extractPdfText(file);
    } catch (e) {
      err = e;
    }
    const name = path.basename(file);
    t(!err, '解析成功：' + name + (err ? ' → ' + err.message : ''));
    if (err) continue;
    t(!!res && res.pages >= 1, '读到页数（' + (res && res.pages) + '）');
    const text = (res && res.text) || '';
    t(text.length > 100, '抽出正文（' + text.length + ' 字）');
    t(Array.isArray(res && res.lines) && res.lines.length > 5, '拆出行（' + (res && res.lines && res.lines.length) + ' 行）');
    // 简历里必然出现的字段，抽不到说明编码/字体映射有问题（中文 CID 字体是常见坑）
    t(/[\u4e00-\u9fa5]/.test(text), '中文能正确解码（不是乱码或空）');
    t(/教育|学校|大学|本科|硕士|学历/.test(text), '能认出教育经历相关字样');
  }

  console.log('\nPDF 导入冒烟完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  app.exit(process.exitCode || 0);
}).catch((e) => {
  console.error('冒烟异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});
