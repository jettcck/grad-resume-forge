#!/usr/bin/env node
'use strict';

// ============================================================
//  文档与基线一致性自测
//  ------------------------------------------------------------
//  背景：同一个数字散落在 README（中/英）、求职文档、日志里，
//  改版本或加测试后必然出现「490+ / 1,652 / 实测 1,467」三套口径。
//  这个脚本让「口径不一致」变成一条会失败的测试，而不是靠人记得改。
//
//  规则：
//    1) 所有数字的唯一来源是 benchmarks/baseline.json；
//    2) 文档里出现这些数字的地方必须与基线一致；
//    3) 过期的旧口径（490+ / 1,652 / 32 个测试文件 等）不允许残留。
//
//  新增文档引用数字时，请用 baseline 里的值，不要手写。
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('✅ PASS: ' + name); }
  else { failed++; console.log('❌ FAIL: ' + name + (detail ? ' → ' + detail : '')); }
};

const baselinePath = 'benchmarks/baseline.json';
if (!exists(baselinePath)) {
  console.error('缺少 ' + baselinePath + '，先跑 npm run baseline');
  process.exit(1);
}
const b = JSON.parse(read(baselinePath));
const pkg = JSON.parse(read('package.json'));

// ---------- 1. 基线自身必须完整（数字不能是 null 混过去） ----------
const t = b.quality.tests || {};
const u = b.quality.ui || {};
check('基线含测试断言数', Number.isFinite(t.assertions) && t.assertions > 0, String(t.assertions));
check('基线含测试脚本数', Number.isFinite(t.suites) && t.suites > 0, String(t.suites));
check('基线测试 0 失败', t.failures === 0, String(t.failures));
check('基线含 UI 断言数', Number.isFinite(u.assertions) && u.assertions > 0, String(u.assertions));
check('基线 UI 0 失败', u.failures === 0, String(u.failures));

// ---------- 2. 版本：package.json 是唯一真源 ----------
check('基线版本与 package.json 一致', b.product.version === pkg.version, b.product.version + ' vs ' + pkg.version);
check('基线的 commit 非空', /^[0-9a-f]{7,40}$/.test(b.product.commit || ''), b.product.commit);

// ---------- 3. README（英）：数字必须是基线的值 ----------
const en = read('README.md');
check('README 断言数 = 基线', en.includes(n(t.assertions) + ' automated assertions'), '期望 ' + n(t.assertions));
check('README 脚本数 = 基线', en.includes(n(t.suites) + ' suites'), '期望 ' + n(t.suites));
check('README 面试题数 = 基线', en.includes(b.banks.interviewQuestions + '-question bank'), '期望 ' + b.banks.interviewQuestions);
check('README 编程题数 = 基线', en.includes(b.banks.codeProblems + ' algorithm problems'), '期望 ' + b.banks.codeProblems);

// ---------- 4. README（中）：同上 ----------
const zh = read('README.zh-CN.md');
check('中文 README 断言数 = 基线', zh.includes(n(t.assertions) + ' 项'), '期望 ' + n(t.assertions));
check('中文 README 面试题数 = 基线', zh.includes(b.banks.interviewQuestions + ' 题'), '期望 ' + b.banks.interviewQuestions);
check('中文 README 编程题数 = 基线', zh.includes(b.banks.codeProblems + ' 道'), '期望 ' + b.banks.codeProblems);
check('中文 README UI 断言数 = 基线', zh.includes(u.assertions + ' 条 DOM 断言'), '期望 ' + u.assertions);

// ---------- 5. 求职文档：版本与数字都必须跟上 ----------
const career = read('docs/career-agent-internship.md');
check('求职文档版本 = package.json', career.includes('v' + pkg.version), '期望 v' + pkg.version);
check('求职文档断言数 = 基线', career.includes(n(t.assertions) + ' 项'), '期望 ' + n(t.assertions));

// ---------- 6. 旧口径不许残留 ----------
const stale = [
  ['README.md', '490+'],
  ['README.zh-CN.md', '490+'],
  ['README.zh-CN.md', '400+ 项断言'],
  ['README.zh-CN.md', '150+ 条 DOM 断言'],
  ['docs/career-agent-internship.md', '1,652'],
  ['docs/career-agent-internship.md', '32 个测试文件']
];
for (const [file, needle] of stale) {
  if (!exists(file)) continue;
  check('过期口径已清除：' + file + ' 不含「' + needle + '」', !read(file).includes(needle));
}

// ---------- 7. 作者信息（发版可信度） ----------
check('package.json 有 author', !!String(pkg.author || '').trim(), JSON.stringify(pkg.author));

console.log('\n文档一致性自测完成: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
