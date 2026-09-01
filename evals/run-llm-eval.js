'use strict';

// ============================================================
//  LLM 层离线评测：本机 Ollama 可用时，用固定用例跑真实 Agent，
//  度量接受率 / 轮数 / 分数增益 / 延迟，写 evals/llm-report.json。
//  无 Ollama 时优雅跳过（exit 0）——规则层评测见 run-evals.js。
//  用法：node evals/run-llm-eval.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { createOllamaClient } = require('../src/main/llm-client');
const agent = require('../src/main/agent');

// 固定评测用例：覆盖「脏简历 / 干净简历 / 算法方向」三种形态
const CASES = [
  {
    name: '套话后端简历 + Java JD',
    profile: {
      summary: '本人具备扎实的编程基础',
      skills: 'Java, MySQL',
      projects: [{
        name: '订单系统', tech: 'Java/MySQL',
        description: '本人负责订单系统优化，通过赋能业务实现降本增效\n参与用户模块开发，支撑日活 3 万'
      }],
      internships: []
    },
    jd: '岗位：Java 后端开发工程师\n要求：\n1. 熟悉 Java / Spring Boot / MySQL / Redis\n2. 有 Docker 与分布式系统实践经验'
  },
  {
    name: '干净前端简历 + 前端 JD',
    profile: {
      summary: '',
      skills: 'Vue, TypeScript, CSS',
      projects: [{
        name: '后台管理系统', tech: 'Vue3/TS',
        description: '实现权限组件，覆盖 20 个页面\n优化首屏加载，耗时从 3s 降到 1s'
      }],
      internships: []
    },
    jd: '前端开发工程师\n要求：熟悉 React、Vue、TypeScript\n了解组件化与性能优化'
  },
  {
    name: '算法简历 + 算法 JD',
    profile: {
      summary: '',
      skills: 'Python, PyTorch',
      projects: [{
        name: '文本分类', tech: 'PyTorch',
        description: '微调 BERT 模型，准确率提升 5%\n清洗 10 万条样本数据'
      }],
      internships: []
    },
    jd: '算法工程师\n要求：熟悉 Python、PyTorch\n有深度学习与 NLP 项目经验优先'
  }
];

(async () => {
  const client = createOllamaClient({});
  const st = await client.status();
  if (!st.available) {
    console.log('⏩ 未检测到 Ollama（' + client.config.endpoint + '），跳过 LLM 评测。');
    console.log('   启动方式：ollama serve && ollama pull ' + client.config.model);
    process.exitCode = 0;
    return;
  }
  console.log('已连接 Ollama，模型：' + client.config.model + '（已装 ' + st.models.length + ' 个）\n');

  const runs = [];
  for (const c of CASES) {
    const t0 = Date.now();
    let r;
    let err = null;
    try {
      r = await agent.runAgent(c.profile, c.jd, { llm: client, maxRounds: 2 });
    } catch (e) {
      err = e.message;
    }
    const ms = Date.now() - t0;
    const accepted = r ? r.accepted.length : 0;
    const rejected = r ? r.rejected.length : 0;
    const row = {
      case: c.name,
      ok: !!(r && r.ok),
      error: err || (r && r.error) || null,
      rounds: r ? r.rounds : 0,
      accepted,
      rejected,
      auditDelta: r ? r.auditAfter - r.auditBefore : 0,
      jdDelta: r ? r.jdAfter - r.jdBefore : 0,
      ms
    };
    runs.push(row);
    console.log(
      (row.ok ? '✅' : '⚠️ ') + ' ' + c.name +
      ' | 轮数 ' + row.rounds +
      ' | 接受 ' + accepted + ' / 拒收 ' + rejected +
      ' | 体检 ' + (r ? r.auditBefore + '→' + r.auditAfter : '-') +
      ' | JD ' + (r ? r.jdBefore + '%→' + r.jdAfter + '%' : '-') +
      ' | ' + ms + 'ms' +
      (row.error ? ' | ' + row.error : '')
    );
  }

  const n = runs.length || 1;
  const sumAccepted = runs.reduce((s, r) => s + r.accepted, 0);
  const sumRejected = runs.reduce((s, r) => s + r.rejected, 0);
  const denom = sumAccepted + sumRejected;
  const report = {
    timestamp: new Date().toISOString(),
    suite: 'llm-layer',
    model: client.config.model,
    endpoint: client.config.endpoint,
    successRate: runs.filter((r) => r.ok).length / n,
    acceptanceRate: denom ? sumAccepted / denom : 0,
    avgRounds: runs.reduce((s, r) => s + r.rounds, 0) / n,
    avgAuditDelta: runs.reduce((s, r) => s + r.auditDelta, 0) / n,
    avgJdDelta: runs.reduce((s, r) => s + r.jdDelta, 0) / n,
    avgMs: runs.reduce((s, r) => s + r.ms, 0) / n,
    runs
  };

  const reportFile = path.join(__dirname, 'llm-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

  console.log('');
  console.log('成功率 ' + (report.successRate * 100).toFixed(0) + '%' +
    ' | 接受率 ' + (report.acceptanceRate * 100).toFixed(0) + '%' +
    ' | 平均轮数 ' + report.avgRounds.toFixed(1) +
    ' | 平均体检增益 ' + report.avgAuditDelta.toFixed(1) +
    ' | 平均 JD 增益 ' + report.avgJdDelta.toFixed(1) + 'pp' +
    ' | 平均耗时 ' + Math.round(report.avgMs) + 'ms');
  console.log('报告已写入 ' + reportFile);
})();
