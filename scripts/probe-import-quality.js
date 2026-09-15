'use strict';

// 诊断：给定 PDF，打印【抽取出的文本行】+【参考数据是否加载】+【解析结果】，
// 用来定位「明明有内容却识别不出来」是抽取问题还是解析问题。
// 运行：node scripts/probe-import-quality.js [pdf路径]
const path = require('path');
const fs = require('fs');

const importer = require(path.join(__dirname, '..', 'dist', 'main', 'resume-importer.js'));
const DATA_ROOT = path.join(__dirname, '..', 'data');
const file = process.argv[2] || path.join(__dirname, '..', 'test-fixtures', 'resume-sample-ats-classic.pdf');

(async () => {
  const { text, lines, pages } = await importer.extractPdfText(file);
  console.log('=== 抽取结果 ===');
  console.log('页数 =', pages, '| 行数 =', lines.length, '| 字符 =', text.replace(/\s/g, '').length);
  console.log('\n--- 逐行（原样，用 ␣ 标出行首尾空格）---');
  lines.forEach((l, i) => console.log(String(i).padStart(3) + ' |' + l.replace(/ /g, '␣') + '|'));

  console.log('\n=== 参考数据 ===');
  const ref = importer.loadRefData(DATA_ROOT);
  console.log('学校数 =', ref.schools.length, '| 城市数 =', ref.citySet.size);
  ['北京语言大学', '北京大学', '复旦大学', '清华大学'].forEach((s) => {
    console.log('  含「' + s + '」:', ref.schools.includes(s));
  });

  console.log('\n=== 解析结果 ===');
  const parsed = importer.parseResumeText(text, ref);
  const show = (k, v) => console.log('  ' + k + ':', typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));
  show('name', parsed.name);
  show('email', parsed.email);
  show('phone', parsed.phone);
  show('education', parsed.education);
  show('targetRole', parsed.targetRole);
  show('internships 条数', (parsed.internships || []).length);
  (parsed.internships || []).slice(0, 6).forEach((e, i) => console.log('    [' + i + ']', JSON.stringify(e)));
  show('projects 条数', (parsed.projects || []).length);
  (parsed.projects || []).slice(0, 5).forEach((p, i) => console.log('    [' + i + ']', JSON.stringify(p).slice(0, 200)));
  show('skills', parsed.skills);
  show('summary', parsed.summary);
})().catch((e) => { console.error('失败：', e && e.stack ? e.stack : e); process.exit(1); });
