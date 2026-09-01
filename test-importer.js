'use strict';

// 导入器自测：中文简历文本解析 + PDF 端到端抽取（手工构造 PDF，不依赖外部文件）
const fs = require('fs');
const os = require('os');
const path = require('path');

const importer = require('./src/main/resume-importer');

let pass = 0, failCnt = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('✅ PASS:', msg); }
  else { failCnt++; console.log('❌ FAIL:', msg); process.exitCode = 1; }
}

const DATA_ROOT = path.join(__dirname, 'data');
const ref = importer.loadRefData(DATA_ROOT);

// ---------- 1) 一份典型的中文简历文本 ----------
const sample = [
  '张三',
  '手机：13812345678 | 邮箱：zhangsan@example.com | 现居城市：杭州',
  '求职意向：后端开发工程师',
  'GitHub：github.com/zhangsan-dev',
  '',
  '教育背景',
  '华中科技大学 计算机科学与技术 本科',
  '2021.09 - 2025.06  GPA：3.8/4.0',
  '主修课程：数据结构、操作系统、计算机网络、数据库',
  '',
  '实习经历',
  '字节跳动（后端开发实习生）2024.06 - 2024.09',
  '技术栈：Go / MySQL / Redis',
  '- 负责订单系统查询优化，P99 从 800ms 降到 120ms',
  '- 参与用户模块开发，支撑日活 3 万',
  '',
  '项目经历',
  '分布式短链服务（核心开发） 2024.01 - 2024.05 技术栈：Go/Redis',
  '- 负责短链算法设计，QPS 提升 5 倍',
  '- 使用多级缓存优化查询，P99 降到 80ms',
  '',
  '专业技能',
  'Java、Go、MySQL、Redis、数据结构、计算机网络、Git',
  '',
  '自我评价',
  '动手能力强，喜欢写代码解决实际问题。'
].join('\n');

const parsed = importer.parseResumeText(sample, ref);
console.log('  解析结果：', JSON.stringify(parsed, null, 1).slice(0, 900), '…');

assert(parsed.name === '张三', '姓名识别（页眉首行）');
assert(parsed.phone === '13812345678', '手机号识别');
assert(parsed.email === 'zhangsan@example.com', '邮箱识别');
assert(parsed.github === 'github.com/zhangsan-dev', 'GitHub 识别');
assert(parsed.targetRole === '后端开发工程师', '求职意向识别');
assert(parsed.city === '杭州', '城市识别（现居城市标注）');

assert(parsed.education.length === 1, '识别到 1 段教育经历');
const edu = parsed.education[0] || {};
assert(edu.school === '华中科技大学', '学校名反查正确');
assert(edu.major === '计算机科学与技术', '专业识别（同行混排）');
assert(edu.degree === '本科', '学历识别');
assert(edu.period === '2021.09 - 2025.06', '时间段识别并归一化');
assert(edu.gpa === '3.8/4.0', 'GPA 识别');
assert(/数据结构/.test(edu.courses || ''), '主修课程识别');

assert(parsed.internships.length === 1, '识别到 1 段实习');
const intern = parsed.internships[0] || {};
assert(intern.name.includes('字节跳动'), '实习公司名识别');
assert(intern.role === '后端开发实习生', '实习角色识别（括号内容）');
assert(intern.period === '2024.06 - 2024.09', '实习时间段识别');
assert(/Go/.test(intern.tech || ''), '实习技术栈识别');
assert(intern.description.length === 2 && intern.description[0].includes('订单系统'), '实习条目归属正确');

assert(parsed.projects.length === 1, '识别到 1 段项目');
const proj = parsed.projects[0] || {};
assert(proj.name.includes('分布式短链'), '项目名识别');
assert(proj.role === '核心开发', '项目角色识别');
assert(proj.period === '2024.01 - 2024.05', '项目时间段识别');
assert(/Go/.test(proj.tech || ''), '项目技术栈识别（时间段之后的技术栈标注）');
assert(proj.description.length === 2, '项目条目归属正确');

assert(/Java/.test(parsed.skills) && /数据结构/.test(parsed.skills), '技能清单识别');
assert(parsed.summary.includes('动手能力'), '自我评价识别');

// ---------- 2) 时间段归一化 ----------
assert(importer.matchPeriod('2023年7月至今') === '2023.07 - 至今', '时间段「至今」归一化');
assert(importer.matchPeriod('2022/03-2024/06') === '2022.03 - 2024.06', '斜杠时间段归一化');

// ---------- 3) 分节容错：装饰符 / 行尾英文 ----------
const decorated = '【教育背景】\n武汉大学 软件工程 本科 2020.09-2024.06\n【项目经历】\n校园二手交易平台（前端开发）\n- 用 Vue3 完成页面';
const p2 = importer.parseResumeText(decorated, ref);
assert(p2.education.length === 1 && p2.education[0].school === '武汉大学', '装饰符标题分节 + 学校识别');
assert(p2.projects.length === 1 && p2.projects[0].description.length === 1, '装饰符分节下项目条目归属');

// ---------- 4) 无分节标题的文本：不崩溃，给提示 ----------
const noSection = '李四 13900000000\n某公司 工程师\n写了很多代码';
const p3 = importer.parseResumeText(noSection, ref);
assert(p3.name === '李四' && p3.phone === '13900000000', '无分节文本仍能抽基本信息');
assert((p3.notes || []).length > 0, '无分节文本给出提示');

// ---------- 5) PDF 端到端：手工构造含中文文本对象的 PDF ----------
// 用 pdfjs-dist 验证抽取链路（Node 环境与 Electron 主进程一致）
(async () => {
  let pdfjs = null;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (_) { pdfjs = null; }

  if (!pdfjs) {
    console.log('⏩ SKIP: pdfjs-dist 未安装，跳过 PDF 端到端用例');
    done();
    return;
  }

  // 构造最小 PDF：两行文本（Helvetica 只能放 ASCII，中文链路由上面的文本用例覆盖）
  const lines = ['Hello Resume Importer', 'Phone 13812345678'];
  let content = 'BT /F1 12 Tf 72 720 Td 16 TL\n';
  lines.forEach((l, i) => { content += (i ? 'T* ' : '') + '(' + l + ') Tj\n'; });
  content += 'ET\n';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach((o) => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
  pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-import-test-'));
  const pdfFile = path.join(tmp, 'fixture.pdf');
  fs.writeFileSync(pdfFile, pdf, 'latin1');

  try {
    const r = await importer.extractPdfText(pdfFile);
    assert(r.pages === 1, 'PDF 页数读取正确');
    assert(r.text.includes('Hello Resume Importer'), 'PDF 文本抽取（第一行）');
    assert(r.text.includes('13812345678'), 'PDF 文本抽取（第二行）');

    // importFromFile 全链路
    const result = await importer.importFromFile(pdfFile, DATA_ROOT);
    assert(result.parsed.phone === '13812345678', 'importFromFile 全链路解析手机号');
  } catch (err) {
    assert(false, 'PDF 端到端抽取失败：' + err.message);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} // eslint-disable-line no-empty
    done();
  }
})();

function done() {
  console.log('\n导入器自测完成:', pass, 'passed,', failCnt, 'failed | exitCode =', process.exitCode || 0);
}
