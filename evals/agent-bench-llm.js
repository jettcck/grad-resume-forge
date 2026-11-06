'use strict';

// ============================================================
//  Agent Benchmark · 真实模型层
//
//  mock 层测运行时与校验门；本文件测真实模型在固定输入和固定参数下的行为。
//  真实运行会写 benchmarks/real-model.json；--self-test 只验证评测链路，绝不写入
//  真实模型报告，避免把仿真服务数字混入正式基线。
//
//  复现契约：model + endpoint + temperature + promptVersion + cases + sample +
//  caseSetHash + commit + runtime。缺少关键字段时报告会标记 reproducible=false。
// ============================================================
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const agent = require(path.join(__dirname, '..', 'dist', 'main', 'agent.js'));
const llmClient = require(path.join(__dirname, '..', 'packages', 'llm-adapters', 'dist', 'index.js'));
const metricsLib = require('./real-model-metrics');

const ROOT = path.join(__dirname, '..');
const endpoint = process.env.AGENT_BENCH_ENDPOINT || '';
const model = process.env.AGENT_BENCH_MODEL || '';
const apiKey = process.env.AGENT_BENCH_KEY || '';
const sampleArg = process.argv.indexOf('--sample');
const sample = sampleArg > 0 ? Math.max(1, Number(process.argv[sampleArg + 1]) || 4) : 4;
const SELF_TEST = process.argv.includes('--self-test');
const modeArg = process.argv.indexOf('--mode');
const mode = modeArg > 0 ? process.argv[modeArg + 1] : 'agentic';
if (!['agentic', 'pipeline', 'both'].includes(mode)) throw new Error('--mode 必须为 agentic、pipeline 或 both');
const MODES = SELF_TEST ? ['agentic'] : (mode === 'both' ? ['pipeline', 'agentic'] : [mode]);
const outputArg = process.argv.indexOf('--output');
const OUTPUT = path.resolve(ROOT, outputArg > 0 ? process.argv[outputArg + 1] : 'benchmarks/real-model.json');
const TEMPERATURE = 0.3;
const MAX_STEPS = 12;
const SUITE_VERSION = '3';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function git(args) {
  try { return execSync('git ' + args.join(' '), { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (_) { return ''; }
}

function gitMetadata() {
  const commit = git(['rev-parse', 'HEAD']);
  // 只关心「被测代码」是否脏：报告与基线本身是产物，写出来再判定脏会自相矛盾
  const IGNORED = ['benchmarks/real-model.json', 'benchmarks/baseline.json', 'evals/llm-report.json', 'evals/report.json'];
  const status = git(['status', '--porcelain'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const file = line.replace(/^[A-Z?!]{1,2}\s+/, '').replace(/\\/g, '/');
      return !IGNORED.includes(file);
    });
  return {
    commit: commit || null,
    commitShort: commit ? commit.slice(0, 7) : null,
    dirty: status.length > 0,
    dirtyFiles: status.slice(0, 20),
    branch: git(['branch', '--show-current']) || null
  };
}

function promptMetadata() {
  const versions = agent.promptVersions ? agent.promptVersions() : null;
  const files = {};
  const promptDir = path.join(ROOT, 'prompts');
  if (versions) {
    for (const version of Object.values(versions)) {
      const file = String(version) + '.txt';
      const full = path.join(promptDir, file);
      if (fs.existsSync(full)) files[file] = sha256(fs.readFileSync(full, 'utf8'));
    }
  }
  return { versions, files };
}

// 保存实际执行的模块、提示词和依赖清单。未提交的修复也能按快照核对。
function saveSourceSnapshot(prompt) {
  const paths = Object.keys(require.cache).filter((p) => p.startsWith(ROOT + path.sep) && !p.includes(path.sep + 'node_modules' + path.sep));
  paths.push(path.join(ROOT, 'package.json'), path.join(ROOT, 'package-lock.json'));
  for (const name of Object.keys(prompt.files)) paths.push(path.join(ROOT, 'prompts', name));
  const files = [...new Set(paths)].sort().map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return { path: path.relative(ROOT, file).replace(/\\/g, '/'), sha256: sha256(text), text };
  });
  const payload = JSON.stringify({ schemaVersion: 1, files });
  const digest = sha256(payload);
  const relative = 'benchmarks/source-snapshots/' + digest.slice(0, 16) + '.json';
  fs.mkdirSync(path.dirname(path.join(ROOT, relative)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, relative), payload + '\n');
  return { path: relative, sha256: digest, files: files.map(({ path, sha256 }) => ({ path, sha256 })) };
}

async function modelMetadata(ep, md, provider) {
  if (provider !== 'ollama') return null;
  const base = ep.replace(/\/+$/, '');
  const [tags, version] = await Promise.all([
    fetch(base + '/api/tags', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()),
    fetch(base + '/api/version', { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
  ]);
  const installed = (tags.models || []).find((m) => m.name === md || m.name === md + ':latest');
  if (!installed) throw new Error('端点没有模型 ' + md);
  return { digest: installed.digest, size: installed.size, details: installed.details, capabilities: installed.capabilities, ollamaVersion: version.version };
}

function measuredClient(client) {
  const requests = [];
  return { requests, client: { config: client.config, provider: client.provider, status: () => client.status(),
    async chat(messages, opts = {}) {
      const started = Date.now(); let usage = null, reply, error = null;
      try {
        reply = await client.chat(messages, { ...opts, onUsage: (u) => { usage = u; if (opts.onUsage) opts.onUsage(u); } });
        if (!usage && reply && typeof reply === 'object') usage = reply.usage || null;
        return reply;
      } catch (e) { error = e.message; throw e; }
      finally { requests.push({ ms: Date.now() - started, tokens: usage && typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        promptTokens: usage ? usage.prompt_tokens : null, completionTokens: usage ? usage.completion_tokens : null,
        tools: reply && typeof reply === 'object' ? (reply.toolCalls || []).map((t) => t.name) : [],
        content: typeof reply === 'string' ? reply.slice(0, 1500) : reply ? String(reply.content || '').slice(0, 1500) : null,
        rawToolCalls: reply && typeof reply === 'object' ? reply.rawToolCalls || [] : [], error }); }
    }
  } };
}

// ---------- 链路自测：本地 OpenAI 兼容假服务，不代表模型能力 ----------
function startFakeOpenAI() {
  const http = require('http');
  let step = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      step++;
      const toolCalls = step % 2 === 1
        ? [{
            id: 'c1', type: 'function',
            function: {
              name: 'rewrite_bullets',
              arguments: JSON.stringify({ rewrites: [{ id: 'p0-b0', text: '主导订单系统开发，支撑日活 3 万' }] })
            }
          }]
        : [{ id: 'c2', type: 'function', function: { name: 'submit_result', arguments: '{}' } }];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'cmpl-fake', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (!endpoint && !SELF_TEST) {
  console.log('⏭  跳过真实模型评测：未配置端点。');
  console.log('   需要设置 AGENT_BENCH_ENDPOINT 与 AGENT_BENCH_MODEL（可选 AGENT_BENCH_KEY）。');
  console.log('   只想验证评测链路：node evals/agent-bench-llm.js --self-test');
  process.exit(0);
}

let fakeServer = null;
const clientPromise = (async () => {
  let ep = endpoint;
  let md = model;
  if (SELF_TEST) {
    const started = await startFakeOpenAI();
    fakeServer = started.server;
    ep = 'http://127.0.0.1:' + started.port + '/v1';
    md = 'fake-model';
  }
  const provider = SELF_TEST ? 'cloud' : (apiKey ? 'cloud' : 'ollama');
  return {
    client: llmClient.createLlmClient({
      provider,
      endpoint: ep,
      model: md,
      apiKey: apiKey || (SELF_TEST ? 'sk-selftest' : ''),
      temperature: TEMPERATURE
    }),
    endpointUsed: ep,
    modelUsed: md,
    provider
  };
})();

const CASES = [
  {
    id: 'backend-profile-java-jd-v1',
    profile: {
      summary: '应届生，求职后端开发工程师',
      skills: 'Java, MySQL, Redis, Spring Boot',
      education: [{ school: '某某大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025' }],
      projects: [{ name: '订单系统', tech: 'Java / MySQL', description: '负责订单系统开发，支撑日活 3 万\n优化查询性能，响应时间从 800ms 降到 120ms' }],
      internships: []
    },
    jd: '岗位：Java 后端开发工程师\n要求：\n1. 熟悉 Java / Spring Boot / MySQL / Redis\n2. 有 Docker 与分布式系统实践经验',
    forbidden: ['Docker', '分布式']
  },
  {
    id: 'frontend-profile-vue-jd-v1',
    profile: {
      summary: '',
      skills: 'Vue, TypeScript, CSS',
      education: [],
      projects: [{ name: '后台管理系统', tech: 'Vue3/TS', description: '实现权限组件，覆盖 20 个页面\n优化首屏加载，耗时从 3s 降到 1s' }],
      internships: []
    },
    jd: '岗位：前端开发工程师\n要求：熟悉 React、Vue、TypeScript；了解组件化与性能优化',
    forbidden: ['React']
  },
  {
    id: 'algorithm-profile-python-jd-v1',
    profile: {
      summary: '',
      skills: 'Python, PyTorch',
      education: [],
      projects: [{ name: '文本分类', tech: 'PyTorch', description: '微调 BERT 模型，准确率提升 5%\n清洗 10 万条样本数据' }],
      internships: []
    },
    jd: '岗位：算法工程师\n要求：熟悉 Python、PyTorch；有深度学习与 NLP 项目经验优先'
  },
  {
    id: 'finance-profile-excel-jd-v1',
    profile: {
      summary: '本人具备扎实的专业基础',
      skills: 'Excel, 用友, CPA',
      education: [],
      projects: [{ name: '财务共享中心项目', tech: 'Excel / 用友', description: '负责月度对账工作，通过认真负责的态度完成各项任务\n参与财务报表编制，支撑 12 家子公司' }],
      internships: []
    },
    jd: '岗位：财务专员\n要求：熟练使用 Excel，了解财务报表编制与审计流程；持有 CPA 或熟悉用友者优先'
  }
];
const CASE_SET_HASH = sha256(JSON.stringify(CASES));

function numberTokens(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?\s*(?:%|‰|万|亿|千|百|ms|s|秒|分钟|小时|天|周|月|年|人|次|个|条|倍|元|GB|MB|KB|TB|QPS|qps)?/g) || [])
    .map((s) => s.replace(/\s+/g, ''));
}

function reproducibilityMetadata({ endpointUsed, modelUsed, prompt, gitInfo, sourceSnapshot }) {
  const missing = [];
  if (!endpointUsed) missing.push('endpoint');
  if (!modelUsed) missing.push('model');
  if (typeof TEMPERATURE !== 'number') missing.push('temperature');
  if (!prompt || !prompt.versions) missing.push('promptVersion');
  if (!CASES.length) missing.push('cases');
  if (!sample) missing.push('sample');
  if (!CASE_SET_HASH) missing.push('caseSetHash');
  if (!gitInfo.commit) missing.push('commit');
  if (gitInfo.dirty && !sourceSnapshot) missing.push('sourceSnapshot');
  return { reproducible: missing.length === 0, missingFields: missing };
}

(async () => {
  const { client, endpointUsed, modelUsed, provider } = await clientPromise;
  const prompt = promptMetadata();
  const gitInfo = gitMetadata();
  const modelInfo = SELF_TEST ? null : await modelMetadata(endpointUsed, modelUsed, provider);
  const sourceSnapshot = SELF_TEST ? null : saveSourceSnapshot(prompt);
  if (SELF_TEST) metricsLib.selfTest();
  if (SELF_TEST) {
    console.log('=== Agent Benchmark · 链路自测（本地仿真服务，非真实模型）===');
    console.log('本次只验证请求构造、工具调用解析、校验和指标汇总，不测模型能力。\n');
  } else {
    console.log('=== Agent Benchmark · 真实模型 ===');
  }
  console.log('端点 ' + endpointUsed + ' | 模型 ' + modelUsed + ' | provider ' + provider);
  console.log('用例 ' + CASES.length + ' 个 | 重复 ' + sample + ' 次 | 温度 ' + TEMPERATURE);
  console.log('模式 ' + MODES.join(' / '));
  console.log('提示词 ' + JSON.stringify(prompt.versions) + ' | commit ' + (gitInfo.commitShort || 'unknown') + '\n');

  const results = [];
  const fabricatedSamples = [];
  const metricLossSamples = [];
  for (const c of CASES) {
    for (let i = 1; i <= sample; i++) {
      for (const runMode of MODES) {
      const t0 = Date.now();
      let r = null, err = null;
      const measured = measuredClient(client);
      try {
        console.log('开始 [' + runMode + '] [' + c.id + '] 第 ' + i + ' 次');
        const runner = runMode === 'pipeline' ? agent.runAgent : agent.agenticLoop;
        r = await runner(c.profile, c.jd, { llm: measured.client, maxSteps: MAX_STEPS, maxRounds: 2 });
      } catch (e) {
        err = e && e.message ? e.message : String(e);
      }
      const ms = Date.now() - t0;
      if (err) {
        console.log('[' + c.id + '] 第 ' + i + ' 次：异常 ' + err);
        results.push({ case: c.id, mode: runMode, run: i, ok: false, ms, error: err, transportError: true, requests: measured.requests });
        continue;
      }
      const accepted = r.accepted || [];
      const lostNumbers = accepted.filter((a) => numberTokens(a.old).some((n) => !numberTokens(a.text).includes(n)));
      const fabricated = accepted.filter((a) => metricsLib.forbiddenSkills(c.id, a.text).length);
      // 留证据：编造命中必须能回看原文，否则「门漏了」只是一个数字
      for (const a of fabricated) {
        fabricatedSamples.push({ case: c.id, mode: runMode, run: i, keywords: metricsLib.forbiddenSkills(c.id, a.text), old: a.old, text: a.text });
      }
      const lostSamplesForCase = lostNumbers.map((a) => ({ case: c.id, run: i, old: a.old, text: a.text }));
      metricLossSamples.push(...lostSamplesForCase);
      console.log('[' + runMode + '] [' + c.id + '] 第 ' + i + ' 次：ok=' + r.ok + ' | 状态 ' + (r.run && r.run.status) + ' | 步骤 ' + (r.stepsUsed || r.rounds) +
        ' | 通过 ' + accepted.length + ' / 拒收 ' + (r.rejected || []).length +
        ' | 覆盖率 ' + r.jdBefore + '→' + r.jdAfter + ' | ' + ms + 'ms' +
        (r.incomplete ? ' | 未完成标注：' + r.incomplete : '') + (r.error ? ' | 原因：' + r.error : ''));
      const requests = measured.requests;
      const targetBullets = agent.buildTaskItems(c.profile).reduce((n, item) => n + (item.id === 'summary' ? 1 : item.lines.length), 0);
      results.push({ case: c.id, mode: runMode, run: i, ok: !!r.ok, ms, accepted: accepted.length, rejected: (r.rejected || []).length, targetBullets,
        lost: lostNumbers.length, fabricated: fabricated.length, status: r.run && r.run.status,
        steps: r.stepsUsed || r.rounds, tokens: requests.every((q) => q.tokens != null) ? requests.reduce((s, q) => s + q.tokens, 0) : null,
        requests, error: r.error || null, incomplete: r.incomplete || null,
        stepTrace: r.steps, acceptedRewrites: accepted, rejections: r.rejected || [], completion: r.completion || null });
      }
    }
  }

  const totalRuns = CASES.length * sample * MODES.length;
  const completed = results.filter((x) => !x.transportError);
  const totalAccepted = completed.reduce((a, b) => a + (b.accepted || 0), 0);
  const totalRejected = completed.reduce((a, b) => a + (b.rejected || 0), 0);
  const totalLost = completed.reduce((a, b) => a + (b.lost || 0), 0);
  const totalFabricated = completed.reduce((a, b) => a + (b.fabricated || 0), 0);
  const totalTokens = completed.reduce((a, b) => a + (b.tokens || 0), 0);
  const byCase = CASES.map((c) => {
    const rows = results.filter((x) => x.case === c.id);
    const done = rows.filter((x) => !x.transportError);
    return {
      case: c.id,
      runs: rows.length,
      completed: rows.filter((x) => x.ok).length,
      returned: done.length,
      ok: rows.filter((x) => x.ok).length,
      successRate: Math.round((rows.filter((x) => x.ok).length / Math.max(1, rows.length)) * 1000) / 10,
      accepted: done.reduce((a, b) => a + (b.accepted || 0), 0),
      rejected: done.reduce((a, b) => a + (b.rejected || 0), 0),
      metricLoss: done.reduce((a, b) => a + (b.lost || 0), 0),
      fabricated: done.reduce((a, b) => a + (b.fabricated || 0), 0),
      avgLatencyMs: done.length ? Math.round(done.reduce((a, b) => a + b.ms, 0) / done.length) : 0
    };
  });
  const metrics = {
    ...metricsLib.summarize(results),
    cases: CASES.length,
    samplePerCase: sample,
    modes: MODES
  };
  const byMode = Object.fromEntries(MODES.map((m) => [m, metricsLib.summarize(results.filter((r) => r.mode === m))]));
  console.log('\n--- 汇总（' + (SELF_TEST ? '链路自测' : '真实模型') + '）---');
  console.log('用例 × 重复 × 模式    ' + CASES.length + ' × ' + sample + ' × ' + MODES.length + ' = ' + totalRuns + ' 次');
  console.log('任务成功率            ' + metrics.successRate + '%（分母为全部 ' + totalRuns + ' 次）');
  console.log('成功返回              ' + completed.length + '/' + totalRuns);
  console.log('平均耗时              ' + metrics.avgLatencyMs + 'ms | P95 ' + metrics.p95LatencyMs + 'ms | 平均步骤 ' + metrics.avgSteps);
  console.log('实际 token 用量       ' + metrics.tokens + ' | 统计覆盖 ' + metrics.tokenCoverage + '%');
  console.log('任务成功率 95% 区间   ' + JSON.stringify(metrics.successRateCi95));
  console.log('失败分类              ' + JSON.stringify(metrics.failureCounts));
  for (const [m, stats] of Object.entries(byMode)) console.log('模式 ' + m + '：成功率 ' + stats.successRate + '% | 均耗时 ' + stats.avgLatencyMs + 'ms | 均 token ' + stats.avgTokens);
  console.log('通过改写合计          ' + totalAccepted + ' / 拒收 ' + totalRejected);
  console.log('数字被改动的改写      ' + totalLost + '（应为 0）');
  console.log('含 JD 未具备技能的改写 ' + totalFabricated + '（应为 0）');
  for (const row of byCase) {
    console.log('  · ' + row.case + '：成功 ' + row.ok + '/' + row.runs +
      ' | 通过 ' + row.accepted + ' / 拒收 ' + row.rejected +
      ' | 数字丢失 ' + row.metricLoss + ' | 编造 ' + row.fabricated);
  }

  if (SELF_TEST) {
    const problems = [];
    if (completed.length !== totalRuns) problems.push('有请求异常');
    if (totalAccepted < 1) problems.push('没有改写通过');
    if (totalLost > 0) problems.push('数字保全失败');
    if (totalFabricated > 0) problems.push('有编造技能的改写通过校验');
    if (totalTokens <= 0) problems.push('token 用量为 0');
    console.log('token 用量合计        ' + totalTokens);
    console.log('\n' + (problems.length ? '❌ 链路自测未通过：' + problems.join('；') : '✅ 链路自测通过（不会写入真实模型报告）'));
    if (fakeServer) { try { fakeServer.close(); } catch (_) {} }
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  const reproducibility = reproducibilityMetadata({ endpointUsed, modelUsed, prompt, gitInfo, sourceSnapshot });
  const report = {
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    suite: 'agent-bench-llm',
    suiteVersion: SUITE_VERSION,
    provider,
    endpoint: endpointUsed,
    model: modelUsed,
    temperature: TEMPERATURE,
    maxSteps: MAX_STEPS,
    maxRounds: 2,
    maxDurationMs: 180000,
    rateUnit: 'percent',
    modes: MODES,
    modelInfo,
    sourceSnapshot,
    promptVersion: prompt.versions,
    promptFiles: prompt.files,
    cases: CASES.length,
    sample,
    caseSet: { id: 'agent-bench-fixed-v1', count: CASES.length, sha256: CASE_SET_HASH },
    commit: gitInfo.commit,
    commitShort: gitInfo.commitShort,
    gitDirty: gitInfo.dirty,
    gitDirtyFiles: gitInfo.dirtyFiles || [],
    branch: gitInfo.branch,
    runtime: { node: process.version, platform: process.platform, arch: process.arch, packageVersion: require(path.join(ROOT, 'package.json')).version },
    hardware: { cpu: os.cpus()[0] && os.cpus()[0].model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
    reproducible: reproducibility,
    metrics,
    byCase,
    byMode,
    // 失败证据：编造与数字丢失必须能回看原文，不能只留一个计数
    evidence: {
      fabricatedSamples: fabricatedSamples.slice(0, 50),
      metricLossSamples: metricLossSamples.slice(0, 50)
    },
    runs: results
  };
  const outDir = path.dirname(OUTPUT);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  console.log('已写入 ' + path.relative(ROOT, OUTPUT) + '；reproducible=' + reproducibility.reproducible);
  if (reproducibility.missingFields.length) console.log('缺少复现字段：' + reproducibility.missingFields.join(', '));
})().catch((e) => {
  console.error('异常：', e && e.stack ? e.stack : e);
  if (fakeServer) { try { fakeServer.close(); } catch (_) {} }
  process.exit(1);
});
