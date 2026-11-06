'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/baseline.json'), 'utf8'));
const comparison = baseline.agent.modelComparison;
assert(Array.isArray(comparison) && comparison.length >= 2, '先完成两种模型评测并运行 node scripts/baseline.js --llm');
const percent = (v) => v == null ? '—' : v + '%';
const seconds = (v) => v == null ? '—' : (Math.round(v / 10) / 100).toFixed(2) + ' s';
const labels = { no_tool_calls: '连续未调用工具而终止', all_rejected: '候选全部拒收', incomplete: '关键步骤未完成',
  timeout: '超时', step_budget: '步数预算', token_budget: 'token 预算', tool_budget: '工具预算',
  request_error: '请求错误', no_accepted_rewrites: '无有效改写', runtime_error: '运行错误', cancelled: '取消' };
const failures = (m) => Object.entries(m.failureCounts || {}).map(([k, v]) => (labels[k] || k) + ' ' + v + ' 次').join('；') || '0';
const sourceReports = comparison.map((m) => JSON.parse(fs.readFileSync(path.join(root, m.source), 'utf8')));
const rows = [];
for (const model of comparison) {
  assert(model.byMode && model.byMode.pipeline && model.byMode.agentic, '报告需包含 pipeline 和 agentic 两种模式');
  for (const mode of ['pipeline', 'agentic']) {
    const m = model.byMode[mode];
    rows.push('| ' + model.model + ' | ' + (mode === 'pipeline' ? '流水线' : '自主 Agent') + ' | ' + m.completedRuns + '/' + m.totalRuns +
      '（' + percent(m.successRate) + '） | ' + m.successRateCi95.join('–') + '% | ' + percent(m.acceptedCoverage) +
      ' | ' + seconds(m.avgLatencyMs) + ' | ' + seconds(m.p95LatencyMs) + ' | ' + (m.avgTokens == null ? '未完整上报' : m.avgTokens) +
      ' | ' + failures(m) + ' |');
  }
}
const total = sourceReports.reduce((n, r) => n + r.metrics.totalRuns, 0);
const accepted = sourceReports.reduce((n, r) => n + r.metrics.accepted, 0);
const lost = sourceReports.reduce((n, r) => n + r.metrics.metricLoss, 0);
const fabricated = sourceReports.reduce((n, r) => n + r.metrics.fabricated, 0);
const allRuns = sourceReports.flatMap((r) => r.runs.map((run) => ({ ...run, model: r.model })));
const noTools = allRuns.find((r) => /未调用工具/.test(r.error || '') && r.requests.every((q) => !q.rawToolCalls.length));
const rejected = allRuns.find((r) => r.model === 'qwen3:8b' && r.case === 'frontend-profile-vue-jd-v1' && r.mode === 'pipeline' && !r.accepted && r.rejections.length);
const badArgs = allRuns.find((r) => r.model === 'qwen3:8b' && r.mode === 'agentic' && r.case === 'frontend-profile-vue-jd-v1');
const partial = allRuns.find((r) => r.status === 'PARTIAL');
const argumentErrors = badArgs ? badArgs.stepTrace.filter((s) => !s.ok && s.tool === 'analyze_jd').slice(0, 3).map((s) => '- `' + s.tool + '`：' + s.detail).join('\n') : '';
const modelLines = comparison.map((m) => '- `' + m.model + '`：' + m.modelInfo.details.quantization_level + '，Ollama ' + m.modelInfo.ollamaVersion + '。');
const sourceLines = comparison.map((m) => '- [' + m.model + ' 原始报告](../' + m.source + ')；Ollama 模型 digest `' + m.modelInfo.digest +
  '`；[执行代码快照](../' + m.sourceSnapshot.path + ')。');
const example = noTools && noTools.requests.find((q) => q.content);
const rejectionLines = rejected ? rejected.rejections.slice(0, 3).map((r) => '- `' + r.id + '`：' + r.reason).join('\n') : '本次未出现全部拒收样本。';
const content = `# 真实模型双模式评测（${sourceReports[sourceReports.length - 1].timestamp.slice(0, 10)}）

完成 ${total} 次真实模型运行：${comparison.map((m) => m.model).join('、')}，各用同一份固定用例集跑流水线和自主 Agent。
数据从 [统一基线](../benchmarks/baseline.json) 的 \`agent.modelComparison\` 生成；逐次输出与工具轨迹保存在原始报告中。

这是第二步的历史基线：使用 rewrite-rules-v1 / agentic-system-v2，执行代码由报告内的源码快照固定。第三步已启用用户经历检索与 v3 提示词，新用例与新结果见 [用户经历检索对照](./resume-evidence.md)；本表不代表当前 v3 实现重新跑出的双模式结果。

## 实测结果

| 模型 | 模式 | 成功次数与成功率 | 成功率 95% 区间 | 改写条目覆盖率 | 平均耗时 | P95 耗时 | 平均 token | 失败分类 |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

在最终接受的 ${accepted} 条改写中，原文数字丢失 ${lost} 条，已标注缺失技能命中 ${fabricated} 条。
缺失技能检查覆盖 Docker/容器化、分布式和 React 的大小写与别名；这是有限标注集检查，其他事实与表达质量尚未人工评分。
四组请求 token 的统计覆盖率均为 100%；缺失用量保留为空值。

${modelLines.join('\n')}

本用例集上两种模型均以流水线模式取得更高成功率；8B 自主模式平均 token 与耗时显著增加。
两种模型来自不同模型系列，8B 还具备 thinking 能力，本次结果用于评价具体配置与任务，不能推导模型参数规模的因果结论。

## 统计口径

- 用例固定为后端、前端、算法、财务四份档案；每模型、每模式各重复 ${comparison[0].sample} 次。
- 成功按 \`runAgent.ok\` 或 \`agenticLoop.ok\` 计数。流水线执行固定分析与校验流程；自主 Agent 需要完成关键工具步骤并提交结果。
- 条目覆盖率为通过校验的条目 ID 数量除以输入条目 ID 数量。成功状态与条目覆盖率分别报告。
- \`acceptanceRate\` 按运行返回的接受项与拒收项计数；逐轮重试细节在 \`stepTrace\` 和 \`rejections\` 中。
- 温度固定 0.3，最多 2 轮改写或 12 个模型决策步骤，运行期限 180 秒。延迟包含冷启动、模型请求和工具执行。
- 区间采用 Wilson 95% 区间，描述本固定用例集的重复运行成功比例。不同模型分别记录权重指纹、服务版本和量化形式。
- 使用服务默认上下文配置，未在每次请求中固定上下文窗口；报告中的模型架构最大上下文长度不等于本次实际运行窗口。

## 失败证据

${noTools ? `\`${noTools.model}\` 的 \`${noTools.case}\` 自主运行以“${noTools.error}”结束。该次响应的原生 \`rawToolCalls\` 均为空，普通文本中却出现了工具名称与参数：` : '逐次失败原因与工具输出见原始报告。'}

\`\`\`text
${example ? example.content.slice(0, 1000) : '原始输出见报告 requests 字段。'}
\`\`\`

[简单 \`ping\` 协议探测](../benchmarks/tool-probe-1.5b.json) 已返回原生工具调用，探测仅记录模型响应，工具执行未执行。
完整任务中的文本输出需要按任务输入检查，不能据此把模型的全部工具能力归为不可用。

${badArgs ? `8B 前端自主运行曾产生工具调用，但反复传入契约未声明的参数，最后连续不调工具而终止；\`no_tool_calls\` 分类并不表示整次运行从未调用工具。轨迹示例：` : ''}

${argumentErrors}

${partial ? `8B 算法用例第 ${partial.run} 次自主运行已有 ${partial.accepted} 条接受项，但 \`completion.checks\` 的 \`jd_analyzed\` 为 false，最终状态 \`${partial.status}\`，计为失败。需要完成的是成功的 JD 分析，发出调用本身不足以完成该步骤。` : ''}

${rejected ? `全部拒收示例：\`${rejected.model}\` 的 \`${rejected.case}\`（${rejected.mode}，第 ${rejected.run} 次）。` : ''}

${rejectionLines}

前端用例原文含组件开发和性能优化相关经历。上述拒收原因提示技能门可能误拒合理表达，误拒率尚未人工标注；接受率不能解释为全部候选的真实质量。

后续改进的验证点：工具协议遵循、拒收后的参数与内容自修复、技能门误拒、通过条目的覆盖率，以及长工具链的 token 和延迟成本。

## 复跑与核对

本次 1.5B 服务在 \`127.0.0.1:11434\`，8B 服务在 \`127.0.0.1:11435\`。端点应指向报告中对应的模型。
以下 PowerShell 评测命令在本次已执行：

\`\`\`powershell
$env:AGENT_BENCH_ENDPOINT = 'http://127.0.0.1:11434'
$env:AGENT_BENCH_MODEL = 'qwen2.5:1.5b'
node evals/agent-bench-llm.js --mode both --sample 3 --output benchmarks/real-model-1.5b.json
$env:AGENT_BENCH_ENDPOINT = 'http://127.0.0.1:11435'
$env:AGENT_BENCH_MODEL = 'qwen3:8b'
node evals/agent-bench-llm.js --mode both --sample 3
node scripts/baseline.js --llm
node scripts/report-real-model.js
\`\`\`

报告保留工作区状态与执行模块快照；快照包括固定用例脚本、已编译模块、提示词和依赖清单，可按每个文件的 SHA-256 核对。

${sourceLines.join('\n')}

[2026-10-28 的 8B 历史报告](../benchmarks/history/qwen3-8b-2026-10-28.json) 单独留存。
7B 下载尝试未完成，其评测未执行；本次对照使用上述两个已验证模型。
`;
const output = path.join(root, 'docs/real-model-eval.md');
fs.writeFileSync(output, content, 'utf8');
console.log('已生成 ' + output);
