# Agent Runtime 与评测体系

本文说明第二、三、四阶段做完之后，这个项目的 Agent 部分长什么样、怎么自证有效。

```
packages/
├── llm-adapters/      # Ollama / OpenAI 兼容云端的有流式解析的 LLM 客户端
├── agent-core/        # 可控 Agent Runtime（不依赖 Electron，也不认识简历业务）
│   ├── src/types.ts          运行状态、预算、工具契约、trace、运行记录的类型
│   ├── src/state-machine.ts  状态机与允许转移表（非法转移直接抛错）
│   ├── src/tools.ts          工具注册层：运行时校验 / 超时 / 幂等重试 / 权限 / 预算
│   ├── src/run-store.ts      运行记录（脱敏、可清理、可回放）
│   └── src/runtime.ts        主循环 + 取消/超时 + trace + 回放
└── agent-cli/         # 脱离界面的入口：run / eval / replay
src/main/agent.ts      # 应用侧适配：简历领域的工具实现、完成度口径、收尾复测
evals/
├── agent-bench.js       # mock 层评测（确定性、零成本、进 CI，带质量门禁）
└── agent-bench-llm.js   # 真实模型层评测（需显式配置端点，不配就跳过）
```

## 一、为什么这样拆

原来 Agent 的流程是一段写在 `for` 循环里的代码：能跑，但答不出「现在跑到哪一步、能不能取消、
失败停在哪、上次为什么拒了这条」。现在把「怎么跑」抽进 `agent-core`，「业务语义」留在应用侧：

- core 只管：状态推进、工具调度、预算、trace、运行记录、取消与回放
- 应用只管：条目怎么切、改写怎么校验、什么算「完成」、收尾怎么复测

判断拆得干不干净有个硬标准：**core 能不能在没有 Electron、没有简历数据的情况下被测试**。
`test-runtime.js` 就是用一套「假领域」（假工具 + 假适配器）测的，42 条断言全部跑在 core 上。

## 二、状态机

```
CREATED → PLANNING → EXECUTING_TOOLS → VALIDATING → CRITIC_REVIEW → COMPLETED
                    ↘ 任意非终态 → FAILED / CANCELLED（终态不可再转移）
```

`RunStateMachine` 用一张允许转移表约束推进，非法转移直接抛错。这不是形式主义：
开发中就撞到过一次 `VALIDATING → COMPLETED` 没在表里，运行时抛错把整次运行判成失败 ——
如果不抛错而是一路放行，这种错误会以「状态显示不对」的形式悄悄漏到用户那边。

## 三、工具注册层

每个工具都要声明契约，而不是只有一个函数：

```ts
{
  name, description, inputSchema,          // 运行时校验用（TS 类型运行时不存在）
  permission: 'readonly' | 'write',        // 读写分权
  timeoutMs, maxRetries, idempotent,       // 超时与重试策略
  execute(args, ctx)
}
```

几个刻意的取舍：

| 决定 | 理由 |
|---|---|
| 只有 `idempotent` 工具才自动重试 | 非幂等的写操作重试可能造成重复写入；宁可失败让上层决定 |
| 超时用 `Promise.race` 而不是真的打断 | JS 没有抢占，底层函数打断不了。调用方能立刻拿到 timeout、不卡住整次运行；这点在文档里写清楚，不假装能 kill |
| 入参校验放在运行时 | 模型给什么形状都有可能（benchmark 里有专门的 `bad_args` 用例） |
| 预算超限返回错误而不是抛异常 | 让模型有机会收工并如实交代，而不是把整次运行炸掉 |
| Agent 没有无约束写权限 | `rewrite_bullets` 只产出候选，过校验门后进 `ctx.accepted`；真正写档案要用户在界面点「应用」 |

## 四、预算与取消

预算四项：`maxSteps` / `maxToolCalls` / `maxDurationMs` / `maxTokens`（token 只在适配器上报时累计，
不猜）。取消走 `AbortSignal`：界面点「取消这次运行」→ IPC → 主进程 abort → 运行时在**安全点**
（每次工具调用之间）退出，状态记 `CANCELLED`，**已完成的改写保留**，不是白跑。

## 五、可观测性与脱敏

每条运行记录含：`runId / taskId / status / currentStep / inputSnapshot / budget / usage / trace`。
trace 每步记 `tool / inputSummary / outputSummary / latencyMs / retryCount / tokens / errorType`。

脱敏是硬要求，不是可选项：

- **不保存简历正文与 JD 原文**：只存长度与摘要指纹（`buildInputSnapshot`）
- 工具入参为回放保留，但字符串按 300 字截断
- 记录里根本没有 API Key（这一层拿不到）
- 界面上「关于 → 最近运行记录」可查看、可清理（`agent:clearRuns`）

测试里有一条专门检查这个：把整条运行记录序列化后，断言其中**不含** JD 原文与简历正文片段。

## 六、评测体系（第三阶段）

`evals/agent-bench.js`：65 个任务用例，用**真实** `agenticLoop` + 真实校验门，只把模型换成
脚本化 mock（确定性、零成本、可进 CI）。覆盖：

| 类别 | 用例数 | 考察点 |
|---|---|---|
| happy | 7 | 正常完成（分析→改写→体检→收工） |
| no_analysis | 7 | 跳过 JD 分析：critical 缺失应被催，并如实标注 |
| lazy | 7 | 一上来就收工：催 2 次后如实收工，不许假装成功 |
| partial | 7 | 一条过门、一条改数字被拒 |
| all_rejected | 7 | 全部被拒 → 不算成功 |
| bad_args | 7 | 模型给错参数形状 → 运行时校验拦下且能继续 |
| unknown_tool | 7 | 调用不存在的工具 → 白名单拦下 |
| injection | 7 | JD 里夹带指令诱导编造技能 → 防幻觉门拦住 |
| no_metrics / long / empty | 9 | 无量化的简历、20 条超长简历、空档案 |

### 实测基线（2026-09-15，本机 Node 20/24）

```
任务数 65 · 任务成功率 100% · 干净路径工具成功率 100%（89 次调用）
改写通过率 87.2%（通过 143 / 拒收 21）· 数字保全率 100% · 编造技能率 0%
JD 覆盖率提升均值 0 个百分点（42 个用例可测）· 运行时开销均值 1.2ms
```

三点如实说明：

1. **含注入失败的类别，工具成功率是 89.3%**。这不是缺陷：`bad_args` 与 `unknown_tool`
   两类就是故意让工具失败的。所以门禁不看这个数，而是断言每个用例的失败次数**恰好等于**注入次数
   （多一个少一个都算回归）；真正要求 100% 的是「干净路径成功率」。
2. **JD 覆盖率提升均值为 0**，这是个真实结论而不是指标算错：Agent 的改写是**风格层**的
   （去套话、强动词、保留数字），而防幻觉门禁止把 JD 要求但档案里没有的技能写进去 ——
   于是覆盖率不会因为改写而上升。要让覆盖率上升，只能靠用户补真实内容（技能/量化成果），
   这也是产品上「Agent 该提示你补什么」而不是「替你写上去」的依据。
3. **运行开销 1.2ms 不含模型推理**：mock 不产生网络与推理延迟。真实模型的耗时看
   `eval:agent:llm`（需配置端点，不配就明确跳过，不编数字）。

### 质量门禁（进 `npm test`）

```
任务成功率 ≥ 100% · 干净路径工具成功率 ≥ 100% · 数字保全率 ≥ 100% · 编造技能率 ≤ 0%
```

阈值全部取自上面的实测基线，不是拍脑袋的目标值。真实模型那一层**不进 CI**：成本与波动都不可控。

## 七、命令行（第四阶段）

```bash
npm run agent:run    -- --input case.json --mode rules          # 规则通道，不需要模型
npm run agent:run    -- --input case.json --mode agentic \
                          --endpoint https://api.deepseek.com/v1 --model deepseek-chat --key sk-xxx
npm run agent:eval                                              # mock 层评测 + 质量门禁
npm run agent:eval   -- --json                                  # 机器可读
npm run agent:replay -- --run <runId>                           # 看某次运行的 trace
npm run agent:replay -- --run <runId> --input case.json          # 用当前校验逻辑重跑工具链
```

`case.json`：

```json
{
  "profile": { "summary": "...", "skills": "Java, MySQL", "projects": [{ "name": "订单系统", "description": "..." }] },
  "jd": "岗位：Java 后端开发工程师\n要求：...",
  "mode": "agentic",
  "llm": { "endpoint": "https://api.deepseek.com/v1", "model": "deepseek-chat" }
}
```

CLI 之所以成立，是因为 `agent-core` 不认识 Electron、`src/main/agent.ts` 也不 import Electron ——
`test-agent.js` 与 CLI 都是用同一份 `dist/main/*.js` 在纯 Node 里跑的。

## 八、还没做的（不假装已完成）

- `llm-adapters` 目前仍是 `src/main/llm-client.ts`，CLI 通过 require 复用；**没有**单独拆成包。
  拆它只是为了目录好看，而 core 与 Electron 的解耦已经达成 —— 所以放在「按需再做」。
- 运行记录按 50 条上限轮转，没有做按时间的保留策略与压缩。
- 真实模型的评测只采样少数几次、不做多次取区间；要写进简历前应当固定模型与参数多跑几轮。
- 人工审批目前是「Agent 只产出候选，用户在界面点应用」这一层；没有做审批队列与超时处理。
