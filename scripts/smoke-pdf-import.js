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
    : [
        path.join(__dirname, '..', 'test-fixtures', 'resume-sample-ats-classic.pdf'),
        // 双栏样本：验证「中缝检测 + 先左栏后右栏」，这是 hasEOL 与按 y 聚行都做不对的场景
        path.join(__dirname, '..', 'test-fixtures', 'resume-two-column.pdf'),
        // 侧边栏样本：顶部姓名/联系方式通栏 + 下方左窄右宽。
        // 整页级的中缝检测会因为“中部 x 区间被顶部占住”而失效，是最难的形态
        path.join(__dirname, '..', 'test-fixtures', 'resume-sidebar.pdf')
      ];

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
    // 康熙部首（PDF 字体常把「言/大/目」映射到 U+2F00–U+2FD5）必须已归一化，
    // 否则学校词表、分节标题全部匹配不上（用户看到的就是「有内容却识别不出来」）
    t(!/[\u2E80-\u2EF3\u2F00-\u2FD5]/.test(text), '康熙部首码位已归一化');

    // 双栏专项：中缝检测后应「先读完左栏再读右栏」，
    // 而不是把同一高度的左右两行拼成「教育背景 实习经历」
    if (/two-column/.test(name)) {
      const iEdu = res.lines.findIndex((l) => /^教育背景$/.test(l.trim()));
      const iSchool = res.lines.findIndex((l) => /浙江大学/.test(l));
      const iIntern = res.lines.findIndex((l) => /^实习经历$/.test(l.trim()));
      t(!res.lines.some((l) => /教育背景\s+实习经历/.test(l)),
        '双栏：左右栏标题没有被拼到同一行');
      t(iEdu >= 0 && iSchool > iEdu, '双栏：教育背景下一条就是学校行（左栏连续）');
      t(iIntern > iSchool, '双栏：右栏内容排在左栏之后（先左后右，符合阅读顺序）');
      t(/阿里巴巴/.test(text) && /浙江大学/.test(text), '双栏：左右两栏的内容都抽到了');
    }

    // 侧边栏专项：顶部通栏不能让中缝检测失效，也不能把通栏文字切断
    if (/sidebar/.test(name)) {
      const iSkill = res.lines.findIndex((l) => l.trim() === '专业技能');
      const iCert = res.lines.findIndex((l) => l.trim() === '证书');
      const iEdu = res.lines.findIndex((l) => l.trim() === '教育背景');
      t(res.lines[0] === '王五', '侧边栏：姓名仍是第一行（顶部通栏没被分栏打乱）');
      t(res.lines[1] && /13700000000/.test(res.lines[1]) && /后端开发工程师/.test(res.lines[1]),
        '侧边栏：联系方式完整没被切断（' + res.lines[1] + '）');
      t(iSkill >= 0 && iCert > iSkill, '侧边栏：左栏内容连续（专业技能 → 证书）');
      t(iEdu > iCert, '侧边栏：右栏内容排在左栏之后（先左后右）');
      t(!res.lines.some((l) => /专业技能\s+教育背景/.test(l)), '侧边栏：左右栏标题没有被拼到同一行');
    }

    // 完整链路：PDF → 分节 → 学校/城市词表反查 → 档案片段（也验证打包后 data/ 能读到）
    const dataRoot = path.join(__dirname, '..', 'data');
    let full = null, fullErr = null;
    try {
      full = await importer.importFromFile(file, dataRoot);
    } catch (e) {
      fullErr = e;
    }
    t(!fullErr, '完整导入链路可跑通' + (fullErr ? ' → ' + fullErr.message : ''));
    if (full) {
      const p = full.parsed;
      // 三份样本的姓名/手机号不同，按样本给期望值（写死一个会误报）
      const expectName = /sidebar/.test(name) ? '王五' : '张三';
      const expectPhone = /sidebar/.test(name) ? '13700000000' : '13800000000';
      t(p.name === expectName && p.phone === expectPhone,
        '基本信息：' + p.name + ' / ' + p.phone + '（期望 ' + expectName + ' / ' + expectPhone + '）');
      if (/ats-classic/.test(name)) {
        // 这几条是 ats-classic 这份样本的固定构成，换个样本数字就不成立
        t(p.education.length === 3, '教育经历 ' + p.education.length + ' 段（学校词表反查生效）');
        t(p.internships.length === 4, '实习/实践 ' + p.internships.length + ' 段');
        t(p.projects.length === 1, '项目经历 ' + p.projects.length + ' 段');
      } else if (/two-column/.test(name)) {
        t(p.education.length >= 1, '双栏：教育经历 ' + p.education.length + ' 段');
        t(p.internships.length >= 1, '双栏：实习经历 ' + p.internships.length + ' 段');
        t(p.projects.length >= 1, '双栏：项目经历 ' + p.projects.length + ' 段');
      }
    }
  }

  console.log('\nPDF 导入冒烟完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
  app.exit(process.exitCode || 0);
}).catch((e) => {
  console.error('冒烟异常：', e && e.stack ? e.stack : e);
  app.exit(1);
});
