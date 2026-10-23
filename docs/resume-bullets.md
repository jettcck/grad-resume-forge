# 简历条目 · Agent 开发实习（可直接粘贴）

> 所有数字均可在本仓库复现（`npm test` / `node evals/agent-bench.js`）。
> 按版面选 3–4 条，不要全贴——条目之间要有"不同侧面"。

---

## 一、中文版（国内投递）

### 版本 A · 主推（技术深度优先，3 条 + 1 条工程兜底）

**简历锻造炉 · 本地优先的求职桌面端（个人项目 / 独立开发 · 30k 行 TS+JS）**

- **可控 Agent Runtime（独立包，1.1k 行，零 Electron 依赖）**：设计 11 状态机（CREATED→ANALYZING_JD→PLANNING→EXECUTING_TOOLS→VALIDATING→CRITIC_REVIEW→COMPLETED + 4 终态），用允许转移表约束推进、非法转移直接抛错——开发期即拦截过一次 `VALIDATING→COMPLETED` 漏配导致的整次运行判失败；6 个工具统一声明 `inputSchema / permission / timeoutMs / maxRetries / idempotent`，**仅幂等工具自动重试**，非幂等写操作宁可失败交上层决策；四项预算（steps / toolCalls / duration / tokens）+ AbortSignal 安全点取消，取消后**保留已完成改写**。
- **Agent 评测体系（65 用例 / 9 类场景 / 门禁进 CI）**：用真实 `agenticLoop` 与真实校验门、只把模型换成脚本化 mock，实现确定性零成本评测；场景覆盖 happy / no_analysis / lazy / partial / all_rejected / bad_args / unknown_tool / **injection** / 长文与空档案；**双口径指标**（行为符合预期 100%、业务完成率 63.1%）修正了上一版把"未完成"算成成功的乐观偏差；门禁断言"每个用例失败次数恰好等于注入次数"，多一次少一次都算回归。
- **防幻觉与脱敏**：改写必须过校验门（数字保全率 100%、编造技能率 0%），注入用例专门验证"JD 里夹带指令诱导编造技能"会被拦下；运行记录落盘做白名单式脱敏（超 12 字字符串替换为 `{len, digest}`，入参**与出参摘要走同一规则**），阈值由测试反推——初版 24 字被一条 18 字改写用例证伪。
- **跨语言判题沙箱（43 题 × JS/Python/C++）**：编译一次多用例复用；超时/超限用 `taskkill /T /F` 杀进程树防孤儿；输出 64KB 截断判 OLE，编译错误带行号回传判 CE。实测发现 Defender 扫描新编译 exe 导致冷启动 1.6s 与误判 RE，加 1.5s 启动宽限 + RE 自动重试（真崩溃仍崩）。

**可选第 5 条 · 检索层（投 RAG / 知识库方向的岗位时加上，其他岗位可省）**

- **自建检索层并做四路对照评测（BM25 / 向量 / RRF）**：零依赖实现中文 bigram 分词 + BM25（建索引 7ms、单查询 0.2ms），另接 Ollama embedding 做向量检索；用 20 条人工标注 query（8 条关键词型 + 12 条语义型）评测——**bge-m3 的 hit@3 达 80%（关键词组 100%）、BM25 为 65%、nomic-embed-text 仅 50%**；实测 RRF 融合的 MRR（0.762）反而低于单用 bge-m3（0.785），据此得出「两路能力差距大时融合会拉低上限」，最终定下「BM25 兜底 + 有模型时用向量」的落地形态。

### 版本 B · 紧凑（一页简历用，2 条）

- **独立设计并实现可控 Agent Runtime**（1.1k 行独立包，不依赖 Electron）：11 状态机 + 允许转移表、6 工具契约（运行时入参校验 / 读写分权 / 仅幂等重试）、四项预算与安全点取消、逐步 trace 与脱敏回放；能脱离宿主用假领域测试（52 条断言）。
- **自建 Agent 评测体系并量化效果**：65 用例 9 类场景（含注入攻击与错误参数），mock 层确定性评测进 CI；数字保全率 100%、编造技能率 0%、改写通过率 87.2%（143 通过 / 21 拒收），双口径指标区分"行为符合预期"与"业务完成"。

### 版本 C · 技能清单式（投递系统自动解析用）

```
语言        TypeScript（主）· JavaScript · Python · C++（判题链路）
Agent       状态机驱动运行时 · 工具契约与调度 · 预算控制 · 安全点取消 · trace/回放 · 防幻觉校验门
LLM          Ollama 与 OpenAI 兼容双协议适配 · SSE 流式解析 · token 计量 · prompt 约束
评测         65 用例 9 类场景 · mock 层确定性评测 · 双口径指标 · 质量门禁进 CI · 注入攻击用例
工程          Electron 主进程/渲染层 IPC 隔离 · 子进程沙箱与超时强杀 · 1.5k 条自动化断言
```

---

## 二、英文版（外企 / 开源投递 / GitHub Profile）

**Grad Resume Forge — local-first desktop app for new-grad job hunting (solo, ~30k LOC TypeScript)**

- **Built a controllable agent runtime as a standalone package (1.1k LOC, zero Electron dependency)**: 11-state machine with an explicit allowed-transition table that throws on illegal moves — caught a missing `VALIDATING → COMPLETED` edge during development instead of letting it surface as a wrong status in the UI. Six tools declare a full contract (`inputSchema / permission / timeoutMs / maxRetries / idempotent`); **only idempotent tools retry automatically**. Four budgets (steps / tool calls / duration / tokens) with `AbortSignal` cancellation at safe points that **keeps already-accepted rewrites**.
- **Designed an agent evaluation suite (65 cases / 9 categories) with CI quality gates**: runs the real agentic loop and the real validation gate with a scripted model, making it deterministic and free. Covers happy path, skipped analysis, lazy termination, partial acceptance, all-rejected, malformed tool args, unknown tool calls, and **prompt injection inside the JD**. Introduced **two separate metrics** (behavior-conformance 100% vs. task-completion 63.1%) after finding the original metric counted incomplete work as success.
- **Hallucination and privacy controls**: every rewrite passes a deterministic gate (metric-preservation 100%, fabricated-skill rate 0%); run records are redacted by whitelist — strings over 12 chars become `{len, digest}`, with **the same rule applied to tool outputs**, not just inputs. The 12-char threshold came from a failing test: the initial 24-char rule let an 18-char rewrite through.
- **Built a retrieval layer and benchmarked four configurations**: zero-dependency Chinese bigram tokenizer + BM25 (7ms index build, 0.2ms per query), plus vector search over Ollama embeddings. Evaluated with 20 hand-labeled queries (8 keyword-style, 12 semantic-style): **bge-m3 reached hit@3 80% (100% on keyword), BM25 65%, nomic-embed-text only 50%**. RRF fusion actually **underperformed** pure bge-m3 on MRR (0.762 vs 0.785) — a weaker retriever dilutes a stronger one — which is why the shipped design is "BM25 fallback, vector when a model is available" rather than either-or.
- **Cross-language judging sandbox (43 problems × JS / Python / C++)**: compile once, reuse the binary across cases; timeouts kill the whole process tree via `taskkill /T /F`; 64KB output cap; compiler errors returned verbatim with line numbers. Diagnosed a Windows Defender cold-start penalty (1.6s, sometimes misreported as runtime error) and added a 1.5s grace window plus a single retry.

---

## 三、投递时按 JD 选取（映射表）

| JD 关键词 | 优先贴哪条 | 备注 |
|---|---|---|
| Agent / 智能体 / 工具调用 | 版本 A 第 1 条 | 这条是核心差异点，不要省 |
| 评测 / eval / 效果验证 | 版本 A 第 2 条 | 多数候选人没有，这是最强的区分度 |
| Prompt 工程 / 防幻觉 | 版本 A 第 3 条 | 强调"校验门"而不是"调 prompt" |
| 工程能力 / 高并发 / 沙箱 | 版本 A 第 4 条 | 体现"真跑过"，有具体异常处理 |
| RAG / 检索增强 | 版本 A 第 5 条 | 有实测对比，能答"为什么不用向量库""为什么融合没赢" |
| 多 Agent / 编排 | ⚠️ 只能讲 critic 阶段 | 不能说 multi-agent |

---

## 四、面试口述版（背下来，60 秒）

> 我做的是一个本地优先的求职桌面端，核心是一个可控的 LLM Agent。
> 它最容易出的问题是编造技能和改坏数字，所以我做了两件事：
> 一是把 Agent 运行时抽成独立包——状态机、工具契约、预算、取消、trace，
> 这样能脱离界面用假领域测，52 条断言；
> 二是搭了评测——65 个用例 9 类场景，包括专门往 JD 里塞指令诱导模型编造技能的注入用例。
> 结果是数字保全率 100%、编造技能率 0%、改写通过率 87.2%。
> 我特意把指标拆成两个口径：行为符合预期 100% 和业务完成率 63%，因为之前一版把没做完的也算成功，
> 那个指标是虚的。
> 没做的是 RAG 和多 Agent 编排——不是不知道，是当前规模用不上，我判断几千条以内暴力检索就够。

---

## 五、常见追问与应答要点

| 追问 | 应答要点（不要背稿，抓住关键句） |
|---|---|
| 为什么不用 LangChain / AutoGPT？ | 需要的是可控性：状态可断言、工具可校验、失败可定位。框架给的是自由度，我要的是约束。 |
| 状态机有必要吗？一个 while 循环不行？ | 行，但答不出"现在在哪一步、能不能取消、上次为什么拒"。状态机让这些变成可断言的事实。 |
| 怎么保证不编造？靠 prompt 吗？ | 不靠。prompt 只是第一道，真正的门是确定性校验：候选里出现档案外的技能就拒，注入用例专门测这个。 |
| 87.2% 通过率是不是有点低？ | 拒收 21 条是设计目标——宁可拒也不放不合格的过门。这个数的意义是"门的严格程度"，不是"模型能力"。 |
| 63.1% 完成率是不是说明效果不好？ | 失败样本（全部被拒 / 一上来就收工 / 跳过分析）本来就该不完成，它们不计入门禁。真正衡量"该成功时是否成功"的是行为符合预期，100%。 |
| 真实模型效果如何？ | 见下方"真实模型评测"一节，按实际跑出来的数字说，不要夸大。 |
| 检索做了但没接进组卷，为什么？ | 现有 tag 精确匹配在「JD 明确写技能名」时够用；换检索要重新验证组卷质量（知识点覆盖、难度分布），属于独立工作不是顺手改。 |
| 为什么不上向量库？ | 151 条语料，暴力余弦 0.5ms。临界点我算过：10 万条 50–80ms，50 万条必须上 HNSW。 |
| 为什么 RRF 融合没赢？ | 实测 MRR 0.762 < 纯 bge-m3 0.785。弱路（BM25 semantic 50%）的排名稀释了强路判断。融合的价值在鲁棒性，不在必然提升精度。 |
