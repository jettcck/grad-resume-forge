'use strict';

// ============================================================
//  Agent Benchmark · 真实模型层（第三阶段）
//
//  与 mock 层的分工：
//    mock 层（evals/agent-bench.js）：确定性、零成本、进 CI，测的是「运行时 + 校验门 + 收工判定」
//    真实模型层（本文件）：测的是「真模型在真实提示下的行为」，成本与耗时都不确定，不放进 CI
//
//  它不会自己编造数字：没配端点就明确跳过，配了就如实打印每个用例的结果与汇总指标。
//
//  用法（任选一种端点）：
//    set AGENT_BENCH_ENDPOINT=https://api.deepseek.com/v1
//    set AGENT_BENCH_MODEL=deepseek-chat
//    set AGENT_BENCH_KEY=sk-xxx
//    node evals/agent-bench-llm.js --sample 6
//
//  或本地模型（无需 key）：
//    set AGENT_BENCH_ENDPOINT=http://127.0.0.1:11434/v1
//    set AGENT_BENCH_MODEL=qwen2.5:7b
// ============================================================
const path = require('path');
const agent = require(path.join(__dirname, '..', 'dist', 'main', 'agent.js'));
const llmClient = require(path.join(__dirname, '..', 'packages', 'llm-adapters', 'dist', 'index.js'));

const endpoint = process.env.AGENT_BENCH_ENDPOINT || '';
const model = process.env.AGENT_BENCH_MODEL || '';
const apiKey = process.env.AGENT_BENCH_KEY || '';
const sampleArg = process.argv.indexOf('--sample');
const sample = sampleArg > 0 ? Math.max(1, Number(process.argv[sampleArg + 1]) || 4) : 4;
const SELF_TEST = process.argv.includes('--self-test');

// ---------- 链路自测：用本地仿真服务验证「脚本本身能跑通」 ----------
// 为什么需要它：真实模型层需要端点，平时根本跑不到 —— 一个从没被执行过的脚本等于死代码。
// 自测模式在本地起一个 OpenAI 兼容的假服务，走完同一条代码路径（请求构造、工具调用解析、
// 指标汇总）。它产出的数字只说明链路通不通，**不代表任何模型能力**。
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
  console.log('   例：set AGENT_BENCH_ENDPOINT=https://api.deepseek.com/v1 && set AGENT_BENCH_MODEL=deepseek-chat && set AGENT_BENCH_KEY=sk-xxx');
  console.log('   本地模型：set AGENT_BENCH_ENDPOINT=http://127.0.0.1:11434/v1 && set AGENT_BENCH_MODEL=qwen2.5:7b');
  console.log('   只想验证脚本链路：node evals/agent-bench-llm.js --self-test');
  process.exit(0);
}

let fakeServer = null;
let selfTestDiag = null;

// 复用应用自己的 LLM 客户端：评测用的必须就是线上那份实现，否则测的不是同一个东西
const clientPromise = (async () => {
  let ep = endpoint;
  let md = model;
  if (SELF_TEST) {
    const started = await startFakeOpenAI();
    fakeServer = started.server;
    ep = 'http://127.0.0.1:' + started.port + '/v1';
    md = 'fake-model';
    selfTestDiag = { endpoint: ep };
  }
  // 自测的假服务说的是 OpenAI 协议，所以必须显式走 cloud 客户端；
  // 否则无 apiKey 时会按 Ollama 协议（/api/chat）发请求，解析不到工具调用
  // —— 这个坑就是自测第一次跑时抓出来的。
  const provider = SELF_TEST ? 'cloud' : (apiKey ? 'cloud' : 'ollama');
  return { client: llmClient.createLlmClient({ provider, endpoint: ep, model: md, apiKey: apiKey || (SELF_TEST ? 'sk-selftest' : ''), temperature: 0.3 }), endpointUsed: ep, modelUsed: md };
})();

const PROFILE = {
  summary: '应届生，求职后端开发工程师',
  skills: 'Java, MySQL, Redis, Spring Boot',
  education: [{ school: '某某大学', major: '计算机科学与技术', degree: '本科', period: '2021-2025' }],
  projects: [{
    name: '订单系统', tech: 'Java / MySQL',
    description: '负责订单系统开发，支撑日活 3 万\n优化查询性能，响应时间从 800ms 降到 120ms'
  }],
  internships: []
};
const JD = '岗位：Java 后端开发工程师\n要求：\n1. 熟悉 Java / Spring Boot / MySQL / Redis\n2. 有 Docker 与分布式系统实践经验';

function numberTokens(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?\s*(?:%|‰|万|亿|千|百|ms|s|秒|分钟|小时|天|周|月|年|人|次|个|条|倍|元|GB|MB|KB|TB|QPS|qps)?/g) || [])
    .map((s) => s.replace(/\s+/g, ''));
}

(async () => {
  const { client, endpointUsed, modelUsed } = await clientPromise;
  if (SELF_TEST) {
    console.log('=== Agent Benchmark · 链路自测（本地仿真服务，非真实模型）===');
    console.log('这次跑通的是脚本本身：请求构造 → 工具调用解析 → 收工校验 → 指标汇总。');
    console.log('它不测模型能力，数字不要引用到任何地方。\n');
  } else {
    console.log('=== Agent Benchmark · 真实模型 ===');
  }
  console.log('端点 ' + endpointUsed + ' | 模型 ' + modelUsed + ' | 采样 ' + sample + ' 次\n');
  const results = [];
  for (let i = 1; i <= sample; i++) {
    const t0 = Date.now();
    let r = null, err = null;
    try {
      r = await agent.agenticLoop(PROFILE, JD, { llm: client, maxSteps: 12 });
    } catch (e) {
      err = e.message;
    }
    const ms = Date.now() - t0;
    if (err) {
      console.log('第 ' + i + ' 次：异常 ' + err);
      results.push({ ok: false, ms, error: err });
      continue;
    }
    const accepted = r.accepted || [];
    const lostNumbers = accepted.filter((a) => numberTokens(a.old).some((n) => !numberTokens(a.text).includes(n)));
    const fabricated = accepted.filter((a) => /Docker|分布式/.test(a.text));
    console.log('第 ' + i + ' 次：ok=' + r.ok + ' | 状态 ' + (r.run && r.run.status) + ' | 步骤 ' + r.stepsUsed +
      ' | 通过 ' + accepted.length +
      ' / 拒收 ' + (r.rejected || []).length + ' | 覆盖率 ' + r.jdBefore + '→' + r.jdAfter +
      ' | ' + ms + 'ms' + (r.incomplete ? ' | 未完成标注：' + r.incomplete : ''));
    results.push({ ok: r.ok, ms, accepted: accepted.length, rejected: (r.rejected || []).length, lost: lostNumbers.length, fabricated: fabricated.length, status: r.run && r.run.status });
  }

  const done = results.filter((x) => !x.error);
  const okCount = done.filter((x) => x.ok).length;
  const totalAccepted = done.reduce((a, b) => a + (b.accepted || 0), 0);
  const totalLost = done.reduce((a, b) => a + (b.lost || 0), 0);
  const totalFabricated = done.reduce((a, b) => a + (b.fabricated || 0), 0);
  const avgMs = done.length ? Math.round(done.reduce((a, b) => a + b.ms, 0) / done.length) : 0;
  console.log('\n--- 汇总（' + (SELF_TEST ? '链路自测' : '真实模型') + '，' + done.length + '/' + sample + ' 次成功返回）---');
  console.log('任务成功率            ' + Math.round((okCount / Math.max(1, done.length)) * 1000) / 10 + '%');
  console.log('平均耗时              ' + avgMs + 'ms');
  console.log('通过改写合计          ' + totalAccepted);
  console.log('数字被改动的改写      ' + totalLost + '（应为 0）');
  console.log('含 JD 技能的改写      ' + totalFabricated + '（防幻觉门应拦下，出现在通过项里说明门有漏）');

  if (SELF_TEST) {
    // 自测模式做硬断言：链路断了就该红，而不是打出一堆好看的数字
    const problems = [];
    if (done.length !== sample) problems.push('有 ' + (sample - done.length) + ' 次请求异常（链路没通）');
    if (totalAccepted < 1) problems.push('没有任何改写通过（工具调用没被正确解析）');
    if (totalLost > 0) problems.push('数字保全失败');
    if (totalFabricated > 0) problems.push('有编造技能的改写通过了校验门');
    console.log('\n' + (problems.length ? '❌ 链路自测未通过：' + problems.join('；') : '✅ 链路自测通过（脚本可正常请求、解析工具调用、汇总指标）'));
    if (fakeServer) { try { fakeServer.close(); } catch (_) { /* 忽略 */ } }
    process.exitCode = problems.length ? 1 : 0;
    return;
  }

  console.log('\n注意：以上是本次运行的实测值，不同模型/温度会波动；不要把它当成稳定承诺，' +
    '要写进简历请固定模型与参数后多次运行取区间。');
})().catch((e) => {
  console.error('异常：', e && e.stack ? e.stack : e);
  if (fakeServer) { try { fakeServer.close(); } catch (_) { /* 忽略 */ } }
  process.exit(1);
});
