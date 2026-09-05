'use strict';

// ============================================================
//  LLM 层离线评测：优先用应用保存的云端配置（DeepSeek / Kimi 等），
//  回退本地 Ollama；都没有则优雅跳过（exit 0）。
//  每个用例跑两种模式：pipeline（确定性编排）与 agentic（function-calling
//  自主循环），度量成功率 / 接受率 / 轮数 / 分数增益 / 延迟。
//  报告写 evals/llm-report.json。
//  用法：npm run eval:llm
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLlmClient } = require('../dist/main/llm-client');
const agent = require('../dist/main/agent');

// 读取应用保存的 Agent 配置（云端优先），没有则回退本地 Ollama
function loadLlmConfig() {
  const roots = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'grad-resume-forge'),
    path.join(os.homedir(), 'AppData', 'Roaming', '简历锻造炉'),
    path.join(os.homedir(), '.config', 'grad-resume-forge')
  ];
  for (const root of roots) {
    const p = path.join(root, 'grad-resume-data', 'db.json');
    try {
      const db = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (db.settings && db.settings.agent && db.settings.agent.apiKey) {
        return { cfg: db.settings.agent, source: '应用配置 ' + p };
      }
    } catch (_) {} // eslint-disable-line no-empty
  }
  return { cfg: {}, source: null };
}

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

// 对单个用例跑一种模式，返回汇总行
async function runOne(mode, c, client) {
  const t0 = Date.now();
  let r;
  let err = null;
  try {
    const runner = mode === 'agentic' ? agent.agenticLoop : agent.runAgent;
    const opts = mode === 'agentic' ? { llm: client, maxSteps: 10 } : { llm: client, maxRounds: 2 };
    r = await runner(c.profile, c.jd, opts);
  } catch (e) {
    err = e.message;
  }
  const ms = Date.now() - t0;
  return {
    mode,
    case: c.name,
    ok: !!(r && r.ok),
    error: err || (r && r.error) || null,
    rounds: r ? r.rounds : 0,
    accepted: r ? r.accepted.length : 0,
    rejected: r ? r.rejected.length : 0,
    auditBefore: r ? r.auditBefore : null,
    auditAfter: r ? r.auditAfter : null,
    jdBefore: r ? r.jdBefore : null,
    jdAfter: r ? r.jdAfter : null,
    ms
  };
}

function fmtRow(row) {
  return (row.ok ? '✅' : '⚠️ ') + ' [' + row.mode + '] ' + row.case +
    ' | 轮/步 ' + row.rounds +
    ' | 接受 ' + row.accepted + ' / 拒收 ' + row.rejected +
    ' | 体检 ' + (row.auditBefore != null ? row.auditBefore + '→' + row.auditAfter : '-') +
    ' | JD ' + (row.jdBefore != null ? row.jdBefore + '%→' + row.jdAfter + '%' : '-') +
    ' | ' + row.ms + 'ms' +
    (row.error ? ' | ' + row.error : '');
}

(async () => {
  const { cfg, source } = loadLlmConfig();
  const client = createLlmClient(cfg);
  const st = await client.status();
  if (!st.available) {
    console.log('⏩ 模型服务不可用（' + (st.error || '未配置') + '），跳过 LLM 评测。');
    console.log('   云端：应用内 ⚙ 配置填 API 密钥；本地：ollama serve && ollama pull qwen2.5:7b');
    process.exitCode = 0;
    return;
  }
  console.log('模型服务：' + (client.provider === 'cloud' ? '云端 ' : '本地 ') + client.config.model +
    (st.models && st.models.length ? '（可用 ' + st.models.length + ' 个模型）' : ''));
  if (source) console.log('配置来源：' + source);
  console.log('');

  const runs = [];
  for (const c of CASES) {
    // 每个用例先跑 pipeline 再跑 agentic（同 JD 同档案，可直接对比）
    const p = await runOne('pipeline', c, client);
    console.log(fmtRow(p));
    runs.push(p);
    const a = await runOne('agentic', c, client);
    console.log(fmtRow(a));
    runs.push(a);
  }

  // 汇总（整体 + 分模式）
  function summarize(list) {
    const n = list.length || 1;
    const acc = list.reduce((s, r) => s + r.accepted, 0);
    const rej = list.reduce((s, r) => s + r.rejected, 0);
    return {
      successRate: list.filter((r) => r.ok).length / n,
      acceptanceRate: (acc + rej) ? acc / (acc + rej) : 0,
      avgRounds: list.reduce((s, r) => s + r.rounds, 0) / n,
      avgAuditDelta: list.reduce((s, r) => s + (r.auditAfter != null && r.auditBefore != null ? r.auditAfter - r.auditBefore : 0), 0) / n,
      avgJdDelta: list.reduce((s, r) => s + (r.jdAfter != null && r.jdBefore != null ? r.jdAfter - r.jdBefore : 0), 0) / n,
      avgMs: list.reduce((s, r) => s + r.ms, 0) / n
    };
  }
  const pipelines = runs.filter((r) => r.mode === 'pipeline');
  const agentics = runs.filter((r) => r.mode === 'agentic');

  const report = {
    timestamp: new Date().toISOString(),
    suite: 'llm-layer',
    provider: client.provider,
    model: client.config.model,
    endpoint: client.config.endpoint,
    overall: summarize(runs),
    byMode: { pipeline: summarize(pipelines), agentic: summarize(agentics) },
    runs
  };

  const reportFile = path.join(__dirname, 'llm-report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');

  const line = (s) =>
    '成功率 ' + (s.successRate * 100).toFixed(0) + '%' +
    ' | 接受率 ' + (s.acceptanceRate * 100).toFixed(0) + '%' +
    ' | 平均轮数 ' + s.avgRounds.toFixed(1) +
    ' | 体检增益 ' + s.avgAuditDelta.toFixed(1) +
    ' | JD 增益 ' + s.avgJdDelta.toFixed(1) + 'pp' +
    ' | 耗时 ' + Math.round(s.avgMs) + 'ms';

  console.log('');
  console.log('—— pipeline：' + line(report.byMode.pipeline));
  console.log('—— agentic ：' + line(report.byMode.agentic));
  console.log('—— 整体　　：' + line(report.overall));
  console.log('报告已写入 ' + reportFile);
})();
