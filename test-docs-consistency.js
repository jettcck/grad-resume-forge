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

// ---------- 1.1 真实模型块：要么可复现，要么显式标注不可复现 ----------
const rm = (b.agent && b.agent.realModel) || null;
if (rm) {
  const rep = rm.reproducible || {};
  check('真实模型块带 reproducible 判定', typeof rep.reproducible === 'boolean',
    JSON.stringify(rep));
  if (rep.reproducible === false) {
    check('不可复现时列出缺失字段', Array.isArray(rep.missingFields) && rep.missingFields.length > 0,
      JSON.stringify(rep.missingFields));
    check('不可复现的指标不得标为 100% 承诺', !/100%/.test(String(rm.successRate)) || rep.missingFields.length > 0,
      String(rm.successRate));
  } else {
    check('可复现时记录 temperature', rm.temperature != null, String(rm.temperature));
    check('可复现时记录 promptVersion', !!rm.promptVersion, JSON.stringify(rm.promptVersion));
    check('可复现时记录 commit', /^[0-9a-f]{7,40}$/.test(String(rm.commit || '')), String(rm.commit));
    check('可复现时记录用例数', Number.isFinite(rm.cases) && rm.cases > 0, String(rm.cases));
  }
}

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

// ---------- 8. Python 服务：有测试数字、有部署文件、文档引用一致 ----------
const py = (b.services && b.services.pythonApi) || null;
check('基线含 Python 服务块', !!py, JSON.stringify(py));
if (py) {
  check('Python 服务测试数已实测', Number.isFinite(py.tests) && py.tests > 0, String(py.tests));
  check('Python 服务记录接口数', Number.isFinite(py.endpoints) && py.endpoints > 0, String(py.endpoints));
  for (const file of [
    'services/python-api/Dockerfile',
    'services/python-api/pyproject.toml',
    'services/python-api/requirements.txt',
    'services/python-api/app/main.py',
    'services/python-api/data/corpus.json'
  ]) {
    check('Python 服务文件存在：' + file, exists(file));
  }
  check('README（英）提到 Python 服务路径', en.includes('services/python-api'), '');
  check('中文 README 提到 Python 服务路径', zh.includes('services/python-api'), '');
  check('服务文档存在', exists('docs/python-service.md'));
}

// ---------- 9. 检索评测：数字必须来自报告，且拒绝「无区间」的表述 ----------
const rt = b.retrieval || null;
check('基线含检索评测块', !!rt && rt.available === true, JSON.stringify(rt && rt.available));
if (rt && rt.available) {
  check('检索评测查询集 ≥ 60 条', Number.isFinite(rt.queries) && rt.queries >= 60, String(rt.queries));
  check('检索评测语料规模已记录', Number.isFinite(rt.corpusDocs) && rt.corpusDocs > 0, String(rt.corpusDocs));
  check('检索评测记录 Hit@3 与 nDCG@5',
    Number.isFinite(rt.bm25.hit3) && Number.isFinite(rt.bm25.ndcg5),
    JSON.stringify(rt.bm25));
  check('检索评测记录置信区间', Array.isArray(rt.bm25.hit3Ci) && rt.bm25.hit3Ci.length === 2,
    JSON.stringify(rt.bm25.hit3Ci));
  check('检索评测记录语料外误召回率', Number.isFinite(rt.bm25.oodFalsePositiveRate),
    String(rt.bm25.oodFalsePositiveRate));
  check('检索评测记录用例集哈希', !!rt.caseSetSha256, String(rt.caseSetSha256));
  check('README（英）提到检索评测查询数', en.includes(rt.queries + '-query'), '期望 ' + rt.queries);
  check('中文 README 提到检索评测查询数', zh.includes(rt.queries + ' 条分层评测集'), '期望 ' + rt.queries);
  check('检索评测文档存在', exists('docs/retrieval-eval.md'));
}

console.log('\n文档一致性自测完成: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
