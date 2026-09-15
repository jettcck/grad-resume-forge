'use strict';

// 导入器自测：中文简历文本解析 + PDF 端到端抽取（手工构造 PDF，不依赖外部文件）
const fs = require('fs');
const os = require('os');
const path = require('path');

const importer = require('./dist/main/resume-importer');

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
assert(parsed.github === 'github.com/zhangsan-dev', '作品集识别（GitHub 链接）');
assert(parsed.targetRole === '后端开发工程师', '求职意向识别');
assert(parsed.city === '杭州', '城市识别（现居城市标注）');

// 作品集不只 GitHub：国内简历里掘金/知乎/站酷/小红书更常见，以前只认 github.com，
// 这些链接在导入时会被直接丢掉。
{
  const ref2 = importer.loadRefData(DATA_ROOT);
  const cases = [
    ['简历\n张三\n掘金：juejin.cn/user/12345', 'juejin.cn/user/12345', '掘金链接'],
    ['简历\n张三\n知乎主页 zhihu.com/people/liming', 'zhihu.com/people/liming', '知乎链接'],
    ['简历\n张三\n个人网站 mysite.dev/portfolio', 'mysite.dev/portfolio', '个人网站'],
    ['简历\n张三\n小红书：xiaohongshu.com/user/profile/abc', 'xiaohongshu.com/user/profile/abc', '小红书链接']
  ];
  cases.forEach(([text, expect, label]) => {
    const r = importer.parseResumeText(text, ref2);
    assert(r.github === expect, '作品集识别（' + label + '）：' + r.github);
  });
  // 没写网址、只写了说明的也要收进来（渲染时原样展示）
  const noteOnly = importer.parseResumeText('简历\n张三\n作品集：财务分析报告 3 份（面试可出示）', ref2);
  assert(noteOnly.github === '作品集：财务分析报告 3 份（面试可出示）', '作品集识别（纯说明文字）：' + noteOnly.github);
}

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

  // ---------- 「本地绿、打包炸」专项（放在最前：静态检查先报，报错信息才精准）----------
  // pdfjs-dist v4 只有 ESM。tsconfig 是 module=commonjs，tsc 会把源码里的 import()
  // 降级成 require()，而 Electron 33 内置 Node 20.18 不支持 require(.mjs)：
  // 打包后一导入 PDF 就报 "require() of ES Module ... not supported"。
  // 开发机 Node ≥20.19 支持 require(ESM)，CI 的 Node 20.x 也 ≥20.19 —— 运行时根本测不出来，
  // 所以这里直接检查编译产物：必须保留真 import，绝不能是 require('pdfjs-dist/...')。
  {
    const distSrc = fs.readFileSync(path.join(__dirname, 'dist', 'main', 'resume-importer.js'), 'utf8');
    assert(!/require\(\s*['"]pdfjs-dist/.test(distSrc),
      '编译产物没有把 ESM 依赖降级成 require()（降级后打包进 Electron 必炸）');
    assert(/import\(specifier\)/.test(distSrc) && /dynamicImport\('pdfjs-dist/.test(distSrc),
      '编译产物保留了真动态 import（tsc 改写不了 Function 里的 import）');
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

    // ---------- 真实中文简历 PDF（仓库自带夹具，来自开源示例简历）----------
    const fixture = path.join(__dirname, 'test-fixtures', 'resume-sample-ats-classic.pdf');
    assert(fs.existsSync(fixture), '中文简历夹具存在');
    if (fs.existsSync(fixture)) {
      const rr = await importer.extractPdfText(fixture);
      assert(rr.pages >= 1, '真实中文简历：读到 ' + rr.pages + ' 页');
      assert(rr.lines.length > 10, '真实中文简历：拆出 ' + rr.lines.length + ' 行');
      assert(/[\u4e00-\u9fa5]/.test(rr.text), '真实中文简历：中文正确解码（不是乱码）');
      assert(rr.text.replace(/\s/g, '').length > 200, '真实中文简历：抽出足量正文（' + rr.text.replace(/\s/g, '').length + ' 字）');

      // 康熙部首归一化：这份 PDF 的字体把「言/大/目」等映射成了 U+2F00–U+2FD5 码位，
      // 归一化之前「北京语言大学」实际是「北京语⾔⼤学」，学校词表全都匹配不上。
      assert(!/[\u2E80-\u2EF3\u2F00-\u2FD5]/.test(rr.text), '康熙部首码位已归一化成正常汉字');
      assert(rr.text.includes('北京语言大学'), '归一化后能读到完整的「北京语言大学」');

      // 整份导入链路（PDF → 分节 → 词表反查 → 档案片段）
      const full = await importer.importFromFile(fixture, DATA_ROOT);
      const p = full.parsed;
      assert(p.name === '张三', '真实简历：姓名（' + p.name + '）');
      assert(p.phone === '13800000000', '真实简历：带连字符的手机号归一化成纯数字（' + p.phone + '）');
      assert(p.targetRole === '对外汉语教师', '真实简历：抬头职位标语 → 求职意向（' + p.targetRole + '）');

      assert(p.education.length === 3, '真实简历：识别出 3 段教育经历（实际 ' + p.education.length + '）');
      const edu0 = p.education[0] || {};
      assert(edu0.school === '北京语言大学' && edu0.major === '对外汉语' && edu0.degree === '硕士' && edu0.period === '2012',
        '真实简历：教育条目（学校/专业/学历/年份）=' + JSON.stringify(edu0));

      // 这一节标题是「实习与实践」——旧的关键词表只有「实习经历/实习经验/实习」，
      // 认不出来就把整段实习塞进了教育经历，用户看到的现象是「有实习却导不进来」。
      assert(p.internships.length === 4, '真实简历：识别出 4 段实习/实践（实际 ' + p.internships.length + '）');
      const i0 = p.internships[0] || {};
      assert(i0.name === '北京语言大学' && i0.role === '对外汉语大班教师' && i0.period === '2011.09 - 至今',
        '真实简历：实习条目（机构/角色/时间段）=' + JSON.stringify(i0));
      assert((i0.description || []).length === 2, '真实简历：实习描述按行归属（实际 ' + (i0.description || []).length + ' 条）');
      const i3 = p.internships[3] || {};
      assert(i3.name === '复旦大学中文系' && i3.period === '2007.01 - 2009.06',
        '真实简历：剥掉时间段后不留残缺括号（实际 ' + JSON.stringify(i3.name) + '）');

      assert(p.projects.length === 1, '真实简历：识别出 1 段项目经历（实际 ' + p.projects.length + '）');
      const pr0 = p.projects[0] || {};
      assert(pr0.name === '校园组织与媒体实践' && pr0.role === '学生骨干 / 实习生',
        '真实简历：项目名与角色没被切碎（实际 ' + JSON.stringify({ name: pr0.name, role: pr0.role }) + '）');
      assert((pr0.description || []).length === 3, '真实简历：3 行项目描述全部归到同一条目（实际 ' + (pr0.description || []).length + '）');

      // 奖项以前被当成技能内容一起塞进「技能」字段；现在有独立的竞赛/奖项字段
      assert(!/书法|国画|钢琴/.test(p.skills || ''), '真实简历：奖项/证书不再混进技能字段');
      assert(Array.isArray(p.awards) && p.awards.length === 3, '真实简历：导入 3 条竞赛/奖项（实际 ' + (p.awards || []).length + '）');
      assert((p.awards || [])[0] === '校级书法大赛一等奖 2006', '真实简历：奖项整行保留用户写法（' + (p.awards || [])[0] + '）');
      assert(!(p.notes || []).some((n) => /奖项/.test(n)), '真实简历：奖项已导入，不再提示「已跳过」');
    }
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
