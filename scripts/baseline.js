#!/usr/bin/env node
'use strict';

// ============================================================
//  统一基线：benchmarks/baseline.json
//  ------------------------------------------------------------
//  为什么要有这个文件：
//    README / 求职文档 / 评测报告各自维护一份数字，改一处漏一处，
//    就会出现「README 说 490+、求职文档说 1,652、实测 1,467」这种
//    自相矛盾——面试官第一眼就会怀疑所有数据。
//    这里把「可复现的数」集中成一份，文档只允许引用，不允许自己写。
//
//  用法：
//    node scripts/baseline.js                # 只重算题库（快，不跑测试）
//    node scripts/baseline.js --tests        # 额外跑 npm test 并记录断言数
//    node scripts/baseline.js --ui           # 额外跑截图管线并记录 UI 断言数
//    node scripts/baseline.js --llm          # 额外读 evals/llm-report.json
//    node scripts/baseline.js --tests --ui   # 发版前推荐
//
//  未加 --tests / --ui 时，保留上一份基线里的测试数字，并在
//  sources 里标明「沿用上次实测」，避免把没跑过的数字当成刚测的。
// ============================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'benchmarks', 'baseline.json');

const argv = new Set(process.argv.slice(2));
const wantTests = argv.has('--tests');
const wantUi = argv.has('--ui');
const wantLlm = argv.has('--llm');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

// ---------------- 题库：直接从编译产物/源码数，不手写 ----------------
function countInterview() {
  const src = read('src/main/interview-bank.ts');
  const all = [...src.matchAll(/^\s*q:\s*'([^']*)'/gm)].map((m) => m[1]);
  return { questions: all.length, unique: new Set(all).size };
}

function countExam() {
  const mod = require(path.join(ROOT, 'dist/main/exam-bank.js'));
  const bank = mod.EXAM_BANK || [];
  return { questions: bank.length, uniqueIds: new Set(bank.map((q) => q.id)).size, bankVersion: mod.BANK_VERSION || null };
}

function countCode() {
  const a = require(path.join(ROOT, 'dist/main/code-bank.js'));
  const b = require(path.join(ROOT, 'dist/main/code-bank-extra.js'));
  const all = [...(a.CODE_BANK || []), ...(b.CODE_BANK_EXTRA || b.CODE_BANK || [])];
  return { problems: all.length, uniqueIds: new Set(all.map((q) => q.id)).size };
}

// ---------------- 测试：跑一遍，数 passed ----------------
function runTests() {
  const out = execFileSync('npm', ['test'], {
    cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024
  });
  const passed = [...out.matchAll(/(\d+) passed/g)].map((m) => +m[1]);
  const failed = [...out.matchAll(/(\d+) failed/g)].map((m) => +m[1]);
  return {
    suites: passed.length,
    assertions: passed.reduce((a, b) => a + b, 0),
    failures: failed.reduce((a, b) => a + b, 0),
    measuredAt: new Date().toISOString()
  };
}

function runUi() {
  const out = execFileSync('npm', ['run', 'smoke:ui'], {
    cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024
  });
  return {
    assertions: (out.match(/✅/g) || []).length,
    failures: (out.match(/❌/g) || []).length,
    screenshots: (out.match(/📸/g) || []).length,
    measuredAt: new Date().toISOString()
  };
}

// ---------------- 评测：mock 层用例数 + 最近一次真实模型报告 ----------------
function countBenchCases() {
  // 用例是 buildCases() 里用多个 helper 拼出来的，静态数正则不可靠。
  // 直接跑一遍 mock 层评测（确定性、零模型成本），从输出里读真实指标。
  const out = execFileSync('node', ['evals/agent-bench.js'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
  const num = (label, unit) => {
    const m = out.match(new RegExp(label + '\\s+([\\d.]+)' + (unit || '')));
    return m ? +m[1] : null;
  };
  const repairLine = out.match(/(\d+)\s*次被拒\s*→\s*(\d+)\s*次修好/);
  return {
    cases: num('任务数'),
    layer: 'mock',
    behaviorMatch: num('行为符合预期', '%'),
    businessCompletion: num('业务完成率', '%'),
    toolCallSuccess: num('工具调用成功率', '%'),
    cleanPathSuccess: num('干净路径成功率', '%'),
    rewriteAcceptance: num('改写通过率', '%'),
    metricPreservation: num('数字保全率', '%'),
    hallucinationRate: num('编造技能率', '%'),
    schemaRepairRate: num('参数自修复率', '%'),
    validationErrors: repairLine ? +repairLine[1] : null,
    repairs: repairLine ? +repairLine[2] : null,
    avgRuntimeMs: num('运行时开销均值', 'ms')
  };
}

function readLlmReport() {
  const p = path.join(ROOT, 'evals', 'llm-report.json');
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    provider: j.provider || null,
    model: j.model || null,
    runAt: j.timestamp || null,
    cases: j.cases == null ? null : j.cases,
    commit: j.commit || null,
    runs: (j.runs || []).length,
    successRate: j.overall ? j.overall.successRate : null,
    acceptanceRate: j.overall ? j.overall.acceptanceRate : null,
    avgRounds: j.overall ? j.overall.avgRounds : null,
    avgLatencyMs: j.overall ? j.overall.avgMs : null,
    // 老报告没有这两项 → 如实留 null，不要用「推测值」填进去
    temperature: j.temperature == null ? null : j.temperature,
    promptVersion: j.promptVersion || null
  };
}

function previous() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return null; }
}

// ---------------- 组装 ----------------
const prev = previous();
const interview = countInterview();
const exam = countExam();
const code = countCode();
const bench = countBenchCases();

const tests = wantTests
  ? runTests()
  : (prev && prev.quality && prev.quality.tests) || null;
const ui = wantUi
  ? runUi()
  : (prev && prev.quality && prev.quality.ui) || null;
const llm = wantLlm ? readLlmReport() : (prev && prev.agent && prev.agent.realModel) || null;

const baseline = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  product: {
    name: pkg.name,
    version: pkg.version,
    commit: git(['rev-parse', 'HEAD']).slice(0, 7),
    commitDate: git(['show', '-s', '--format=%cI', 'HEAD']),
    author: pkg.author || null
  },
  quality: {
    tests: tests
      ? { ...tests, source: wantTests ? 'npm test（本次实测）' : (tests.source || '沿用上次实测') }
      : { suites: null, assertions: null, failures: null, source: '未测' },
    ui: ui
      ? { ...ui, source: wantUi ? 'npm run smoke:ui（本次实测）' : (ui.source || '沿用上次实测') }
      : { assertions: null, failures: null, screenshots: null, source: '未测' }
  },
  banks: {
    interviewQuestions: interview.questions,
    interviewUnique: interview.unique,
    examQuestions: exam.questions,
    examBankVersion: exam.bankVersion,
    codeProblems: code.problems
  },
  agent: {
    bench: bench,
    realModel: llm
  },
  notes: [
    '文档只能引用本文件里的数字；test-docs-consistency.js 会在 npm test 里校验。',
    'product.commit 是「生成这份基线时的 HEAD」，也就是携带本文件的提交的父提交——避免自己引用自己的死循环。',
    'agent.bench 是 mock 层用例，证明运行时与校验门正确，不证明模型效果。',
    'agent.realModel 来自 evals/llm-report.json；temperature / promptVersion 为空表示当次运行没有记录，属于不可复现项。'
  ]
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');

console.log('已写入', path.relative(ROOT, OUT));
console.log('  版本      ', baseline.product.version, '| commit', baseline.product.commit);
console.log('  单测      ', baseline.quality.tests.assertions, '断言 /', baseline.quality.tests.suites, '脚本 /', baseline.quality.tests.failures, '失败',
  '（' + baseline.quality.tests.source + '）');
console.log('  UI        ', baseline.quality.ui.assertions, '断言 /', baseline.quality.ui.failures, '失败',
  '（' + baseline.quality.ui.source + '）');
console.log('  题库      ', '面试', baseline.banks.interviewQuestions, '· 客观', baseline.banks.examQuestions, '· 编程', baseline.banks.codeProblems);
console.log('  Agent     ', 'mock 用例', baseline.agent.bench.cases,
  '| 真实模型', baseline.agent.realModel ? baseline.agent.realModel.model + ' @ ' + String(baseline.agent.realModel.runAt).slice(0, 10) : '无');
