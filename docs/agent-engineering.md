# Agent 工程说明（面向招聘方 / 代码评审）

> 产品是「应届生简历锻造炉」，但真正值得评审的是底下这套**可控 Agent 运行时**。
> 本文只写已实现、可跑、可测的部分；没做到的直接列在最后一节。
> 所有数字的唯一来源是 [`benchmarks/baseline.json`](../benchmarks/baseline.json)，改代码后跑 `npm run baseline:full` 重算。

---

## 0. 一句话定位

> 独立设计并实现了一个本地优先的可控 Agent Runtime：工具契约 + 运行时参数校验 + 四项预算 + 幂等重试 + 取消 / 回放 / 脱敏 trace；针对简历改写场景构建确定性校验门，并用 mock 场景与真实模型分别评估「运行时可靠性」与「模型效果」。

---

## 1. 架构

```
renderer (Electron)                 main (Node/TS)                    packages/
┌──────────────────┐   IPC   ┌────────────────────────┐   import   ┌─────────────────────┐
│ 录入 / 预览 / 投递 │ ──────▶ │ agent.ts               │ ─────────▶ │ agent-core           │
│ 笔试 / 面试       │         │  · 领域提示词与工具实现  │            │  · runtime.ts 状态机 │
└──────────────────┘         │  · 确定性校验门         │            │  · tools.ts 注册层   │
                             └───────────┬────────────┘            │  · trace / replay    │
                                         │                          └─────────────────────┘
                                         │ tools                    ┌─────────────────────┐
                                         └─────────────────────────▶│ llm-adapters         │
                                                                    │  Ollama / OpenAI 兼容 │
                                                                    └─────────────────────┘
```

关键取舍：**把运行时从业务里剥出来**。`packages/agent-core` 不 import Electron、不 import 业务数据，
因此可以在一台没有 GUI、没有网络的机器上跑完整测试（52 条断言，见 `test-runtime.js`）。

---

## 2. 运行时（`packages/agent-core/src/runtime.ts`）

### 2.1 状态机

11 个状态，转移由一张显式表约束，非法转移直接抛错：

```
CREATED → ANALYZING_JD → PLANNING → EXECUTING_TOOLS ⇄ VALIDATING ⇄ CRITIC_REVIEW
                                            ↓              ↓
                                 WAITING_HUMAN_APPROVAL → COMPLETED
                                            ↓
                                    PARTIAL / FAILED / CANCELLED（终态）
```

要点：
- `EXECUTING_TOOLS → EXECUTING_TOOLS` 是显式允许的（多轮工具调用），不是靠循环隐式推进。
- 终态集合单独判定，避免「看起来跑完、其实还在改」。
- 每次转移写进 `history`（时间戳 + from/to + note），这是 trace 的骨架。

### 2.2 预算

四项预算是**运行时强制**的，不是提示词里劝模型省着用：

| 预算 | 默认值 | 触发后的行为 |
|---|---|---|
| `maxSteps` | 12 | 停止推进，标 `PARTIAL` |
| `maxToolCalls` | 40 | 拒绝新的工具调用 |
| `maxDurationMs` | 180_000 | 取消运行 |
| `maxTokens` | 120_000 | 停止新的模型调用 |

### 2.3 取消 / 回放 / trace

- **取消**：`AbortSignal` 贯穿到模型请求与工具执行；取消后状态为 `CANCELLED`，不会写成 `FAILED`（这两种失败语义不同）。
- **回放**：`replayRun()` 从 JSONL 运行记录重建一次运行的工具序列与结论，用于复现线上问题。
- **脱敏**：trace 写入前对密钥、手机号、邮箱做替换；运行记录默认落在用户数据目录。

---

## 3. 工具契约（`packages/agent-core/src/tools.ts`）

模型给什么参数都有可能，TypeScript 类型在运行时不存在。所以：

1. **运行时校验**：只支持真正用到的 JSON Schema 子集（`type` / `required` / `minLength` / `maxItems` / 枚举 / 嵌套对象），
   失败返回**结构化错误**：`{ error, errorType, retryable, fix: { path, expected, received } }`。
   给字段而不是只给一句话，是因为模型能修的是「rewrites 应为 array，收到 string」这类可执行信息；
   只给「参数不合法」它只能瞎猜，重试照样错。
2. **自修复回路**：错误回灌 → 模型按 `fix.path` 改参数 → 重新调用同一工具。成功即记一次 `usage.repairs`。
3. **重复同一错误会被叫停**：同一个 `path + expected + message` 连续出现 3 次 → `validation_exhausted`，
   直接告诉模型「换个做法」。它防的不是「试错」，是「用同一个错参数反复烧预算」。
4. **超时**：单工具 `timeoutMs`，超时记为该次调用失败（对应已知限制：`Promise.race` 不会真的杀掉底层任务）。
5. **幂等重试**：仅对声明为幂等的工具重试，且重试次数计入 `maxToolCalls`——防止「重试把预算吃光」。
6. **未知参数**：直接拒绝（`出现未声明的参数 X`），不做静默丢弃——静默丢弃会让模型以为调用成功了。

已注册的领域工具（`src/main/agent.ts`）：

| 工具 | 作用 | 备注 |
|---|---|---|
| `analyze_jd` | 抽 JD 硬性要求、技能词、优先级 | 确定性 |
| `audit_text` | 对单条文案做去 AI 味体检 | 确定性 |
| `llm_rewrite` | 语义改写一条 bullet | 需要模型 |
| `rewrite_bullets` | 流水线模式的批量改写 | 需要模型 |
| `validate_rewrites` | 批量过校验门 | 确定性 |
| `submit_result` | 收工提交 | 由运行时检查完成度 |

---

## 4. 确定性校验门（`src/main/agent.ts`）

LLM 的输出**不能直接进档案**，必须先过门。门只做机器能判定的事：

| 检查 | 判定方式 | 处置 |
|---|---|---|
| 数字是否被改动 | 抽出原文所有数字（含 `%`、`万`、`ms`），逐项比对 | 改动 → 拒收 |
| 是否编造技能 | 改写结果里出现档案中没有的技能词 | 出现 → 拒收 |
| 是否套话回归 | 词典 + 句式规则（"负责…工作"、"有效提升"…） | 命中 → 拒收或降分 |
| 长度 / 结构 | 单条 bullet 长度、是否退化成散文 | 越界 → 拒收 |

设计原则：**门必须是确定性的**。同一份输入永远得到同一个判定，才能被测试、被回放、被当成回归基线。
代价是它只能守「可机械判定」的约束，语义质量仍要靠模型和人工——这点不掩饰。

---

## 5. 提示词版本化

prompt 是「会被反复调参的输入」，不是逻辑。放在 `agent.ts` 里时，改一个字就混进代码 diff，
评测报告也没法记录「这轮跑的是哪版」，于是「prompt 改好了吗」只能回答「我手动试过」。

| 约定 | 落地方式 |
|---|---|
| 版本号写在文件名里 | `prompts/rewrite-system-v1.txt` · `rewrite-rules-v1.txt` · `agentic-system-v2.txt`（Agentic P2 接入检索后的版本） |
| 改内容必须新建版本 | 不许原地改 v1；否则历史评测记录全部失真（`test-prompts.js` 守着不变量） |
| 代码里不许有第二份副本 | `test-prompts.js` 扫描 `agent.ts`，出现内联提示词即失败 |
| 运行时按版本取回原文 | `src/main/prompts.ts` 的 `loadPrompt()` / `promptVersion()`，路径同时兼容 `dist/main` 与打包后的 `app.asar` |
| 运行记录带版本 | `RunRecord.promptVersion`（`agentic-system-v2`） |
| 评测报告带版本与温度 | `evals/llm-report.json` 新增 `temperature` / `promptVersion` / `cases` / `commit` |
| 打包不漏文件 | `package.json` 的 `build.files` 含 `prompts/**/*`；`smoke:packaged` 检查 asar 内确实有这几个 txt |

这样「prompt 改了有没有变好」才能用数据回答：同一批用例、同一个 commit 区间，只换 `promptVersion` 跑对比。

## 6. 评测

### 6.1 mock 层（`evals/agent-bench.js`，72 用例 / 12 类场景）

用脚本化的假模型驱动**真实运行时**，验证的是运行时与门，不是模型：

| 指标 | 实测 | 说明 |
|---|---|---|
| 行为符合预期 | 100% | 该成功的成功、该失败的失败 |
| 干净路径工具成功率 | 100% | 不含故意注入的失败 |
| 工具调用成功率 | 86.2% | 含注入失败（152 次调用） |
| 数字保全率 | 100% | 改写不许动数字 |
| 编造技能率 | 0% | 注入用例守护 |
| 参数自修复率 | 100% | 7 个 `schema_repair` 用例：看到结构化错误后改对 |
| 校验拒绝 → 修好 | 14 → 14 | 全部在 1 次内修复，没有反复烧预算 |
| 业务完成率 | 66.7% | 失败样本本来就该不完成 |
| 改写通过率 | 88.2% | 157 通过 / 21 拒收 |

断言的关键设计：**失败次数必须恰好等于注入次数**。多一次说明误伤，少一次说明门漏了。

`schema_repair` 这一组不是「写死正确答案」：脚本模型会读上一轮的工具结果，
只有拿到 `retryable: true` + `fix.path` 才改参数，否则继续传错——测的是错误回灌链路，不是脚本。

### 6.2 真实模型层（`evals/agent-bench-llm.js`）

同一套用例打真实端点（DeepSeek / Ollama 均可）。`--self-test` 用本地假服务跑通链路，
所以「评测台本身」在没有模型、没有网络的环境里也能验证。

**已有的真实结果**（`evals/llm-report.json`，2026-09-05，deepseek-chat，8 次运行）：
成功率 100%、校验门接收率 100%、平均 2 轮、平均延迟 2.5s（流水线 1.1s / agentic 3.9s）。

**必须承认的缺口**：这份报告没有记录 `temperature` 与 `promptVersion`，因此严格来说**不可完全复现**。
这是下一步要补的第一件事（见第 7 节）。

### 6.3 复现契约

一次可复现的评测必须固定并记录：

```json
{
  "model": "deepseek-chat",
  "temperature": 0.2,
  "promptVersion": "rewrite-v3",
  "cases": 65,
  "commit": "dc3b4c6",
  "runs": 30
}
```

缺任何一项，指标就只能当「参考值」，不能当基线。

---

## 7. 怎么跑

```bash
# 运行时单测（无 Electron / 无网络）
node test-runtime.js
node test-prompts.js        # 提示词版本化：文件/版本号/无内联副本/打包清单

# mock 层评测 + 质量门禁（72 用例，零模型成本）
npm run eval:agent

# 真实模型评测（不配端点则明确跳过，不会假装跑过）
# 跑完自动写 benchmarks/real-model.json：模型 + 温度 + promptVersion + 采样数 + commit
set AGENT_BENCH_ENDPOINT=https://api.deepseek.com/v1
set AGENT_BENCH_MODEL=deepseek-chat
set AGENT_BENCH_KEY=sk-xxx
node evals/agent-bench-llm.js --sample 30

# 只想验证评测脚本本身（本地假服务，不写基线）
node evals/agent-bench-llm.js --self-test

# 单独跑一次 agent（CLI）
npm run agent:run -- --input case.json --mode agentic
node packages/agent-cli/dist/index.js replay --run <runId>

# 重算基线（发版前）
npm run baseline:full
```

---

## 8. 已知限制与下一步

按「对 Agent 岗位的说服力 / 成本」排序：

| 优先级 | 事项 | 现状 | 计划 |
|---|---|---|---|
| P1 | 真实模型基线 | 有一份 2026-09 的 8 次运行报告（缺 `temperature` / `promptVersion`） | 报告字段已补，缺的是用固定参数跑 30 次，产出 `benchmarks/real-model.json` |
| ~~P2~~ | ~~检索接入 Agent~~ | **已实现**：`retrieve_knowledge(query, topK, mode)` 已进入 Agent 工具链，支持 `none` / `bm25` / `vector` / `hybrid`；向量不可用时明确返回状态，hybrid 明确降级 BM25 | `src/main/retrieval.ts` + `evals/agent-retrieval-eval.js`；用同一查询对比 no-retrieval / BM25 / vector |
| ~~P3~~ | ~~参数错误自修复~~ | **已实现**：结构化错误（`fix.path`）→ 回灌 → 一次内改对；同一错误连续 3 次即 `validation_exhausted` | 实测 7/7 用例修复，`usage.repairs` 计入基线 |
| ~~P4~~ | ~~Prompt 版本化~~ | **已实现**：`prompts/*-v1.txt` + `src/main/prompts.ts` + 运行记录/评测报告带版本 | 改 prompt 时新建 v2 文件，用同一批用例做 A/B |

此外，这些限制在面试里应当主动说，不要包装：

- 单机 Electron 应用：没有服务端并发、队列、配额、多租户。
- **单 Agent 循环 + critic 阶段**，不是 multi-agent；不建议为了「看起来像」硬加角色。
- 工具超时是 `Promise.race`，底层任务未必真停（代码注释已标明）。
- 校验门是强领域规则（数字 / 技能 / 套话），迁移到通用 Agent 还需要抽象更多约束类型。
- Agent 的向量检索依赖本地 Ollama embedding 端点；端点不可用时 vector 不返回伪造结果，hybrid 明确降级 BM25。检索工具已进入主循环，但当前默认语料仍是 151 条客观题，后续可扩展为用户简历与 JD 专属语料。
