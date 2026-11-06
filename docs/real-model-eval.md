# 真实模型双模式评测（2026-11-02）

完成 48 次真实模型运行：qwen2.5:1.5b、qwen3:8b，各用同一份固定用例集跑流水线和自主 Agent。
数据从 [统一基线](../benchmarks/baseline.json) 的 `agent.modelComparison` 生成；逐次输出与工具轨迹保存在原始报告中。

这是第二步的历史基线：使用 rewrite-rules-v1 / agentic-system-v2，执行代码由报告内的源码快照固定。第三步已启用用户经历检索与 v3 提示词，新用例与新结果见 [用户经历检索对照](./resume-evidence.md)；本表不代表当前 v3 实现重新跑出的双模式结果。

## 实测结果

| 模型 | 模式 | 成功次数与成功率 | 成功率 95% 区间 | 改写条目覆盖率 | 平均耗时 | P95 耗时 | 平均 token | 失败分类 |
|---|---|---|---|---|---|---|---|---|
| qwen2.5:1.5b | 流水线 | 11/12（91.7%） | 64.6–98.5% | 40% | 0.62 s | 2.17 s | 446 | 候选全部拒收 1 次 |
| qwen2.5:1.5b | 自主 Agent | 0/12（0%） | 0–24.2% | 0% | 0.72 s | 1.38 s | 2214 | 连续未调用工具而终止 12 次 |
| qwen3:8b | 流水线 | 8/12（66.7%） | 39.1–86.2% | 33.3% | 22.63 s | 32.66 s | 1563 | 候选全部拒收 4 次 |
| qwen3:8b | 自主 Agent | 3/12（25%） | 8.9–53.2% | 43.3% | 81.25 s | 132.77 s | 19448 | 连续未调用工具而终止 5 次；关键步骤未完成 2 次；步数预算 2 次 |

在最终接受的 35 条改写中，原文数字丢失 0 条，已标注缺失技能命中 0 条。
缺失技能检查覆盖 Docker/容器化、分布式和 React 的大小写与别名；这是有限标注集检查，其他事实与表达质量尚未人工评分。
四组请求 token 的统计覆盖率均为 100%；缺失用量保留为空值。

- `qwen2.5:1.5b`：Q4_K_M，Ollama 0.40.7。
- `qwen3:8b`：Q4_K_M，Ollama 0.40.7。

本用例集上两种模型均以流水线模式取得更高成功率；8B 自主模式平均 token 与耗时显著增加。
两种模型来自不同模型系列，8B 还具备 thinking 能力，本次结果用于评价具体配置与任务，不能推导模型参数规模的因果结论。

## 统计口径

- 用例固定为后端、前端、算法、财务四份档案；每模型、每模式各重复 3 次。
- 成功按 `runAgent.ok` 或 `agenticLoop.ok` 计数。流水线执行固定分析与校验流程；自主 Agent 需要完成关键工具步骤并提交结果。
- 条目覆盖率为通过校验的条目 ID 数量除以输入条目 ID 数量。成功状态与条目覆盖率分别报告。
- `acceptanceRate` 按运行返回的接受项与拒收项计数；逐轮重试细节在 `stepTrace` 和 `rejections` 中。
- 温度固定 0.3，最多 2 轮改写或 12 个模型决策步骤，运行期限 180 秒。延迟包含冷启动、模型请求和工具执行。
- 区间采用 Wilson 95% 区间，描述本固定用例集的重复运行成功比例。不同模型分别记录权重指纹、服务版本和量化形式。
- 使用服务默认上下文配置，未在每次请求中固定上下文窗口；报告中的模型架构最大上下文长度不等于本次实际运行窗口。

## 失败证据

`qwen2.5:1.5b` 的 `backend-profile-java-jd-v1` 自主运行以“模型连续未调用工具，终止”结束。该次响应的原生 `rawToolCalls` 均为空，普通文本中却出现了工具名称与参数：

```text
{"name": "analyze_jd", "arguments": {"target": "Java 后端开发工程师", "required_skills": ["熟悉 Java / Spring Boot / MySQL / Redis", "有 Docker 与分布式系统实践经验"]}}
{"name": "retrieve_knowledge", "arguments": {"mode": "bm25", "query": "Java 后端开发工程师", "topK": 5}}
{"name": "audit_text", "arguments": {"summary": "应届生，求职后端开发工程师"}}

```

[简单 `ping` 协议探测](../benchmarks/tool-probe-1.5b.json) 已返回原生工具调用，探测仅记录模型响应，工具执行未执行。
完整任务中的文本输出需要按任务输入检查，不能据此把模型的全部工具能力归为不可用。

8B 前端自主运行曾产生工具调用，但反复传入契约未声明的参数，最后连续不调工具而终止；`no_tool_calls` 分类并不表示整次运行从未调用工具。轨迹示例：

- `analyze_jd`：出现未声明的参数 jd
- `analyze_jd`：出现未声明的参数 jd
- `analyze_jd`：出现未声明的参数 jd_text

8B 算法用例第 2 次自主运行已有 2 条接受项，但 `completion.checks` 的 `jd_analyzed` 为 false，最终状态 `PARTIAL`，计为失败。需要完成的是成功的 JD 分析，发出调用本身不足以完成该步骤。

全部拒收示例：`qwen3:8b` 的 `frontend-profile-vue-jd-v1`（pipeline，第 1 次）。

- `p0-b0`：疑似编造技能「组件化」：你的档案里没有（确实会的话请先把技能加进档案）
- `p0-b1`：疑似编造技能「性能优化」：你的档案里没有（确实会的话请先把技能加进档案）

前端用例原文含组件开发和性能优化相关经历。上述拒收原因提示技能门可能误拒合理表达，误拒率尚未人工标注；接受率不能解释为全部候选的真实质量。

后续改进的验证点：工具协议遵循、拒收后的参数与内容自修复、技能门误拒、通过条目的覆盖率，以及长工具链的 token 和延迟成本。

## 复跑与核对

本次 1.5B 服务在 `127.0.0.1:11434`，8B 服务在 `127.0.0.1:11435`。端点应指向报告中对应的模型。
以下 PowerShell 评测命令在本次已执行：

```powershell
$env:AGENT_BENCH_ENDPOINT = 'http://127.0.0.1:11434'
$env:AGENT_BENCH_MODEL = 'qwen2.5:1.5b'
node evals/agent-bench-llm.js --mode both --sample 3 --output benchmarks/real-model-1.5b.json
$env:AGENT_BENCH_ENDPOINT = 'http://127.0.0.1:11435'
$env:AGENT_BENCH_MODEL = 'qwen3:8b'
node evals/agent-bench-llm.js --mode both --sample 3
node scripts/baseline.js --llm
node scripts/report-real-model.js
```

报告保留工作区状态与执行模块快照；快照包括固定用例脚本、已编译模块、提示词和依赖清单，可按每个文件的 SHA-256 核对。

- [qwen2.5:1.5b 原始报告](../benchmarks/real-model-1.5b.json)；Ollama 模型 digest `65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b`；[执行代码快照](../benchmarks/source-snapshots/e7e66a9466a4678a.json)。
- [qwen3:8b 原始报告](../benchmarks/real-model.json)；Ollama 模型 digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`；[执行代码快照](../benchmarks/source-snapshots/bd934b80b9cf8c35.json)。

[2026-10-28 的 8B 历史报告](../benchmarks/history/qwen3-8b-2026-10-28.json) 单独留存。
7B 下载尝试未完成，其评测未执行；本次对照使用上述两个已验证模型。
