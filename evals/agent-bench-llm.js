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

if (!endpoint || !model) {
  console.log('⏭  跳过真实模型评测：未配置端点。');
  console.log('   需要设置 AGENT_BENCH_ENDPOINT 与 AGENT_BENCH_MODEL（可选 AGENT_BENCH_KEY）。');
  console.log('   例：set AGENT_BENCH_ENDPOINT=https://api.deepseek.com/v1 && set AGENT_BENCH_MODEL=deepseek-chat && set AGENT_BENCH_KEY=sk-xxx');
  console.log('   本地模型：set AGENT_BENCH_ENDPOINT=http://127.0.0.1:11434/v1 && set AGENT_BENCH_MODEL=qwen2.5:7b');
  process.exit(0);
}

// 复用应用自己的 LLM 客户端：评测用的必须就是线上那份实现，否则测的不是同一个东西
const client = llmClient.createLlmClient({
  provider: apiKey ? 'cloud' : 'ollama',
  endpoint,
  model,
  apiKey,
  temperature: 0.3
});

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
  console.log('=== Agent Benchmark · 真实模型 ===');
  console.log('端点 ' + endpoint + ' | 模型 ' + model + ' | 采样 ' + sample + ' 次\n');
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
    console.log('第 ' + i + ' 次：ok=' + r.ok + ' | 步骤 ' + r.stepsUsed + ' | 通过 ' + accepted.length +
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
  console.log('\n--- 汇总（真实模型，' + done.length + '/' + sample + ' 次成功返回）---');
  console.log('任务成功率            ' + Math.round((okCount / Math.max(1, done.length)) * 1000) / 10 + '%');
  console.log('平均耗时              ' + avgMs + 'ms');
  console.log('通过改写合计          ' + totalAccepted);
  console.log('数字被改动的改写      ' + totalLost + '（应为 0）');
  console.log('含 JD 技能的改写      ' + totalFabricated + '（防幻觉门应拦下，出现在通过项里说明门有漏）');
  console.log('\n注意：以上是本次运行的实测值，不同模型/温度会波动；不要把它当成稳定承诺，' +
    '要写进简历请固定模型与参数后多次运行取区间。');
})().catch((e) => { console.error('异常：', e && e.stack ? e.stack : e); process.exit(1); });
