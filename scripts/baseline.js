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
const { toPercent } = require('../evals/real-model-metrics');

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
// 测试失败时不要直接抛栈：基线的职责是「如实记录」，包括失败数。
// 抛栈的结果是连基线都写不出来，文档一致性也就无从检查。
function runTests() {
  let out = '';
  let exitCode = 0;
  try {
    out = execFileSync('npm', ['test'], {
      cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024
    });
  } catch (e) {
    out = String((e && e.stdout) || '');
    exitCode = typeof e.status === 'number' ? e.status : 1;
  }
  const passed = [...out.matchAll(/(\d+) passed/g)].map((m) => +m[1]);
  const failed = [...out.matchAll(/(\d+) failed/g)].map((m) => +m[1]);
  const failedNames = [...out.matchAll(/❌ FAIL: ([^\n]+)/g)].map((m) => m[1]).slice(0, 10);
  return {
    suites: passed.length,
    assertions: passed.reduce((a, b) => a + b, 0),
    failures: failed.reduce((a, b) => a + b, 0),
    exitCode,
    failedNames,
    measuredAt: new Date().toISOString()
  };
}

function runUi() {
  let out = '';
  try {
    out = execFileSync('npm', ['run', 'smoke:ui'], {
      cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024
    });
  } catch (e) {
    out = String((e && e.stdout) || '');
  }
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

// 真实模型报告有两个来源：
//   1) benchmarks/real-model.json —— evals/agent-bench-llm.js 真实运行产出，字段最全（优先）
//   2) evals/llm-report.json      —— evals/run-llm-eval.js 的 pipeline/agentic 对比报告（回退）
// 只认「本次真实运行」产出的文件；--self-test 不写这两个文件，所以不会被误引。
function readLlmReport(reportPath) {
  const candidates = reportPath ? [{ p: path.join(ROOT, reportPath), source: reportPath }] : [
    { p: path.join(ROOT, 'benchmarks', 'real-model.json'), source: 'benchmarks/real-model.json' },
    { p: path.join(ROOT, 'evals', 'llm-report.json'), source: 'evals/llm-report.json' }
  ];
  for (const c of candidates) {
    if (!fs.existsSync(c.p)) continue;
    const j = JSON.parse(fs.readFileSync(c.p, 'utf8'));
    const runs = Array.isArray(j.runs) ? j.runs : [];
    const overall = j.overall || j.metrics || {};
    const promptVersion = j.promptVersion || null;
    const cases = j.cases == null ? null : j.cases;
    const sample = j.sample == null ? (runs.length || null) : j.sample;
    const missingFields = [];
    if (!j.provider) missingFields.push('provider');
    if (!j.model) missingFields.push('model');
    if (j.temperature == null) missingFields.push('temperature');
    if (!promptVersion) missingFields.push('promptVersion');
    if (cases == null) missingFields.push('cases');
    if (!j.commit) missingFields.push('commit');
    if (!sample) missingFields.push('sample');
    const rateUnit = j.rateUnit || (j.suite === 'agent-bench-llm' ? 'percent' : 'fraction');
    return {
      source: c.source,
      provider: j.provider || null,
      model: j.model || null,
      endpoint: j.endpoint || null,
      runAt: j.timestamp || null,
      cases,
      sample,
      commit: j.commit || null,
      commitShort: j.commitShort || (j.commit ? String(j.commit).slice(0, 7) : null),
      runs: runs.length,
      // 按报告的单位转换；0.5% 不能凭数值大小误读成 50%。
      successRate: toPercent(overall.successRate, rateUnit),
      acceptanceRate: toPercent(overall.acceptanceRate, rateUnit),
      rateUnit: 'percent',
      modes: j.modes || ['agentic'],
      runner: j.runner || null,
      maxRounds: j.maxRounds == null ? null : j.maxRounds,
      maxDurationMs: j.maxDurationMs == null ? null : j.maxDurationMs,
      contextWindow: j.contextWindow || null,
      byMode: j.byMode || null,
      modelInfo: j.modelInfo || null,
      sourceSnapshot: j.sourceSnapshot || null,
      failureCounts: overall.failureCounts || null,
      successRateCi95: overall.successRateCi95 || null,
      avgSteps: overall.avgSteps == null ? null : overall.avgSteps,
      avgTokens: overall.avgTokens == null ? null : overall.avgTokens,
      avgRounds: overall.avgRounds == null ? null : overall.avgRounds,
      avgLatencyMs: overall.avgMs == null ? (overall.avgLatencyMs == null ? null : overall.avgLatencyMs) : overall.avgMs,
      temperature: j.temperature == null ? null : j.temperature,
      promptVersion,
      promptFiles: j.promptFiles || null,
      caseSet: j.caseSet || null,
      gitDirty: j.gitDirty == null ? null : j.gitDirty,
      runtime: j.runtime || null,
      suiteVersion: j.suiteVersion || null,
      // 可复现判定：字段缺失就如实标 false，不许默认 true
      reproducible: j.reproducible && typeof j.reproducible.reproducible === 'boolean'
        ? j.reproducible
        : { reproducible: missingFields.length === 0, missingFields }
    };
  }
  return null;
}

function previous() {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return null; }
}

// ---------------- Python 服务：能跑就跑，跑不了如实标 null ----------------
// 不把 pytest 的「N passed」并进 JS 断言总数：两类测试的语义不同，
// 混在一起会让「1542 条断言」这个数字失去意义。
function countPythonTests() {
  const serviceDir = path.join(ROOT, 'services', 'python-api');
  if (!fs.existsSync(serviceDir)) {
    return { tests: null, source: 'services/python-api 不存在' };
  }
  const candidates = [
    path.join(ROOT, '.venv-py', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv-py', 'bin', 'python'),
    'python3',
    'python'
  ];
  for (const python of candidates) {
    if (python.includes(path.sep) && !fs.existsSync(python)) continue;
    try {
      // 不加 -q：pyproject 的 addopts 已经有 -q，再传一次会变成 -qq，
      // 连 "N passed" 汇总行都会被压掉，计数直接拿不到。
      const out = execFileSync(python, ['-m', 'pytest'], {
        cwd: serviceDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
      });
      const m = out.match(/(\d+)\s+passed/);
      return {
        tests: m ? +m[1] : null,
        endpoints: countPythonEndpoints(serviceDir),
        source: 'pytest（本次实测）',
        measuredAt: new Date().toISOString()
      };
    } catch (e) {
      // 该解释器不可用，继续试下一个
    }
  }
  return { tests: null, endpoints: countPythonEndpoints(serviceDir), source: '未找到可用的 Python 解释器' };
}

function countPythonEndpoints(serviceDir) {
  let count = 0;
  const routers = path.join(serviceDir, 'app', 'routers');
  if (!fs.existsSync(routers)) return null;
  for (const file of fs.readdirSync(routers)) {
    if (!file.endsWith('.py')) continue;
    const src = fs.readFileSync(path.join(routers, file), 'utf8');
    count += (src.match(/@router\.(get|post|put|patch|delete)\(/g) || []).length;
  }
  return count;
}

// ---------------- 检索评测：只读报告，不重复跑 ----------------
// 报告由 evals/retrieval-eval.js 产出；这里不重跑，避免 baseline 命令依赖 Ollama。
function readRetrievalReport() {
  const p = path.join(ROOT, 'benchmarks', 'retrieval-report.json');
  if (!fs.existsSync(p)) {
    return { available: false, source: '未找到 benchmarks/retrieval-report.json' };
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const modes = j.metrics || {};
  const pick = (name) => {
    const m = modes[name];
    if (!m || !m.overall) return null;
    return {
      hit1: round2(m.overall.hit1),
      hit3: round2(m.overall.hit3),
      hit5: round2(m.overall.hit5),
      recall5: round2(m.overall.recall5),
      mrr: round3(m.overall.mrr),
      ndcg5: round3(m.overall.ndcg5),
      hit3Ci: m.ci && m.ci.hit3 ? [round2(m.ci.hit3.low), round2(m.ci.hit3.high)] : null,
      oodFalsePositiveRate: m.ood ? round2(m.ood.falsePositiveRate) : null,
      latencyP50Ms: m.latencyMs ? m.latencyMs.p50 : null,
      latencyP95Ms: m.latencyMs ? m.latencyMs.p95 : null,
      byType: Object.fromEntries(Object.entries(m.byType || {}).map(([k, v]) => [k, {
        n: v.n, hit3: round2(v.hit3), ndcg5: round3(v.ndcg5)
      }]))
    };
  };
  const bm25 = pick('bm25');
  return {
    available: !!bm25,
    queries: j.caseSet ? j.caseSet.total : null,
    corpusDocs: j.corpus ? j.corpus.docs : null,
    caseSetVersion: j.caseSet ? j.caseSet.version : null,
    caseSetSha256: j.caseSet ? String(j.caseSet.sha256).slice(0, 16) : null,
    vector: j.vector || null,
    recommendedThreshold: j.recommendedThreshold || null,
    bm25,
    vectorMode: pick('vector'),
    hybrid: pick('hybrid'),
    runAt: j.timestamp || null,
    commit: j.commitShort || null,
    reproducible: j.reproducible || null,
    source: 'benchmarks/retrieval-report.json'
  };
}

const round2 = (x) => (x == null ? null : Math.round(x * 10000) / 100);
const round3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---------------- 组装 ----------------
const prev = previous();
const interview = countInterview();
const exam = countExam();
const code = countCode();
const bench = countBenchCases();
const pythonApi = countPythonTests();
const retrieval = readRetrievalReport();

const tests = wantTests
  ? runTests()
  : (prev && prev.quality && prev.quality.tests) || null;
const ui = wantUi
  ? runUi()
  : (prev && prev.quality && prev.quality.ui) || null;
const llm = wantLlm ? readLlmReport() : (prev && prev.agent && prev.agent.realModel) || null;
const resumeEvidence = wantLlm ? readLlmReport('benchmarks/resume-evidence.json')
  : (prev && prev.agent && prev.agent.resumeEvidence) || null;
const resumeEvidenceComparison = wantLlm
  ? ['benchmarks/resume-evidence.json', 'benchmarks/resume-evidence-8b.json'].map((p) => readLlmReport(p)).filter(Boolean)
  : (prev && prev.agent && prev.agent.resumeEvidenceComparison) || null;
const modelComparison = wantLlm
  ? ['benchmarks/real-model-1.5b.json', 'benchmarks/real-model.json'].map((p) => readLlmReport(p)).filter(Boolean).map((r) => ({
    source: r.source, model: r.model, provider: r.provider, runAt: r.runAt, cases: r.cases, sample: r.sample,
    modes: r.modes, byMode: r.byMode, rateUnit: r.rateUnit, modelInfo: r.modelInfo,
    caseSet: r.caseSet, promptVersion: r.promptVersion, suiteVersion: r.suiteVersion,
    sourceSnapshot: r.sourceSnapshot ? { path: r.sourceSnapshot.path, sha256: r.sourceSnapshot.sha256 } : null
  }))
  : (prev && prev.agent && prev.agent.modelComparison) || null;

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
      : { assertions: null, failures: null, screenshots: null, source: '未测' },
    ipc: (prev && prev.quality && prev.quality.ipc) || null
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
    realModel: llm,
    modelComparison,
    resumeEvidence,
    resumeEvidenceComparison
  },
  services: {
    pythonApi: {
      ...pythonApi,
      framework: 'FastAPI',
      asyncClient: 'httpx.AsyncClient',
      corpus: '题库导出（data/corpus.json）'
    }
  },
  retrieval: retrieval,
  notes: [
    '文档只能引用本文件里的数字；test-docs-consistency.js 会在 npm test 里校验。',
    'product.commit 是「生成这份基线时的 HEAD」，也就是携带本文件的提交的父提交——避免自己引用自己的死循环。',
    'agent.bench 是 mock 层用例，证明运行时与校验门正确，不证明模型效果。',
    'agent.modelComparison 为第二步旧提示词与源码快照的双模式基线；agent.resumeEvidenceComparison 为第三步流水线用户经历检索对照，两者用例集不同。',
    'resumeEvidence 的 none 仅允许目标原文作依据；bm25 同时提供检索来源与 JD 技能映射，比较的是这套检索增强链路，不是 BM25 算法单独贡献。',
    'agent.realModel 来自 benchmarks/real-model.json（优先）或 evals/llm-report.json（回退）；reproducible=false 表示缺关键复现字段，其指标只能当参考值。'
  ]
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');

console.log('已写入', path.relative(ROOT, OUT));
console.log('  版本      ', baseline.product.version, '| commit', baseline.product.commit);
console.log('  单测      ', baseline.quality.tests.assertions, '断言 /', baseline.quality.tests.suites, '脚本 /', baseline.quality.tests.failures, '失败',
  '（' + baseline.quality.tests.source + '）');
if (baseline.quality.tests.failedNames && baseline.quality.tests.failedNames.length) {
  console.log('  失败用例   ', baseline.quality.tests.failedNames.join(' | '));
}
console.log('  UI        ', baseline.quality.ui.assertions, '断言 /', baseline.quality.ui.failures, '失败',
  '（' + baseline.quality.ui.source + '）');
console.log('  题库      ', '面试', baseline.banks.interviewQuestions, '· 客观', baseline.banks.examQuestions, '· 编程', baseline.banks.codeProblems);
console.log('  Agent     ', 'mock 用例', baseline.agent.bench.cases,
  '| 真实模型', baseline.agent.realModel ? baseline.agent.realModel.model + ' @ ' + String(baseline.agent.realModel.runAt).slice(0, 10) : '无');
console.log('  Python 服务', 'pytest', baseline.services.pythonApi.tests == null ? '未运行' : baseline.services.pythonApi.tests,
  '| 接口', baseline.services.pythonApi.endpoints, '|', baseline.services.pythonApi.source);
console.log('  检索评测  ', baseline.retrieval && baseline.retrieval.available
  ? baseline.retrieval.queries + ' 条 query / ' + baseline.retrieval.corpusDocs + ' 条语料 | BM25 hit@3 ' +
    baseline.retrieval.bm25.hit3 + '% | nDCG@5 ' + baseline.retrieval.bm25.ndcg5 +
    ' | 语料外误召回 ' + baseline.retrieval.bm25.oodFalsePositiveRate + '%' +
    (baseline.retrieval.recommendedThreshold
      ? '（阈值后 ' + round2(baseline.retrieval.recommendedThreshold.oodFalsePositiveRate) + '%）'
      : '')
  : '未运行（先 node evals/retrieval-eval.js）');
