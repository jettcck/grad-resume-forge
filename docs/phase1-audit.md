# 第一阶段审计：修 bug 与补安全

本文件回应外部评审给出的「第一阶段」清单（6 条 bug/安全项 + 回归测试要求）。
结论按 **已正确 / 已修复 / 本轮新修 / 未做** 四类给出，每条都附可自行复现的证据。

> 审计目的：避免重复「修」已经正确的代码。评审给我的清单里有 3 条与当前代码不符，
> 直接照着改会引入回归，所以先把事实固定下来。

---

## 一、逐条结论

| # | 评审意见 | 实际结论 | 证据（可自行核对） |
|---|---|---|---|
| 1 | 「取消勾选仍然应用」：`app.js` 应使用 `acceptedList` 而不是 `result.accepted` | **已正确，不需改** | `src/renderer/app.js:2224` 函数签名接收 `acceptedList`；`:2225` 即 `const accepted = acceptedList || result.accepted;`。专属回归套件 `test-renderer-apply.js`（16 条）从 `app.js` 里切出真实函数跑，断言「未勾选的条目逐字保留原文」。界面管线另有真实 DOM 断言（取消勾选后应用，档案里那条保持原文） |
| 2 | 「仍缺失技能」用了优化前的 `jdBefore.missing` | **已正确，不需改** | 管线路径 `src/main/agent.ts:525-528` 用 `afterMatch.missing`；Agentic 路径 `:809-811` 同样。函数内还留了注释说明这次取的是复测后的 matchJd |
| 3 | Agentic `submit_result` 基本等于无条件成功，应校验：JD 分析 / 体检 / 目标条目覆盖 / 拒收项 / 最终复测 | **本轮新修（原来是部分实现）** | 见下方「二、本轮改动」。现在拆成 5 项检查、分 critical/advisory 两级 |
| 4 | 流式响应尾部丢失：连接关闭时应解析剩余 buffer | **已修复** | `src/main/llm-client.ts:128`（Ollama NDJSON）与 `:224`（OpenAI SSE）都调用 `takeTail`（`:141`）。`test-stream.js`（6 条）覆盖「无尾换行不丢最后一段」「多字节跨分片不乱码」；负向验证：从编译产物里去掉 `takeTail` 后正好 3 条断言变红 |
| 5 | `configureUpdater()` 重复注册监听器 | **已修复** | `src/main/main.ts:697` `let updaterBound = false;`、`:717-718` 只绑一次。`test-updater.js`（56 条）含 publish 配置与镜像规则 |
| 6 | IPC 直接信任 renderer 传入的 `userId` | **已修复** | `main.ts` 中 **17 处** `sessionUserId(_e)`（15 个数据接口 + settings 两个），会话由 `auth:login/register/session` 写入主进程、不再采信参数。`scripts/smoke-real-ipc.js`：加载**真实主进程**断言「未登录被拒 / 拿别人 userId 读到的仍是自己的档案 / 密钥不回显 / 密钥无明文落盘」共 10 条 |

补充：清单外的三项安全项在本轮之前也已落地 —— 输入长度与形状校验（`src/main/validate.ts`，`test-validate.js` 16 条）、`safeStorage` 不可用时界面明确提示明文保存、导出 PDF 的离屏窗口关闭 JS/开沙箱。

---

## 二、本轮改动（第一阶段实质工作）

### 1. Agentic 完成校验：把「完成」拆成可判定的项

原实现只做「什么都没做就催一次 + 如实标注」，评审要求的覆盖度、拒收、复测都没有检查。

现在收工前跑 5 项检查，分两级：

- **critical（缺了就是没干完 → 提醒模型补做，最多 2 次）**
  - `jd_analyzed`：分析过这份 JD（没有它，覆盖率数字没有意义）
  - `rewrites_accepted`：至少一条改写通过校验门（写回档案的前提）
- **advisory（只如实记录，不额外催、不弹警告）**
  - `audited`：看过体检分
  - `coverage`：还有几个条目一次都没提交过
  - `rejected_retried`：被拒的条目有没有再试

**为什么分两级（这是我改掉的第一版设计）**：第一版把 advisory 缺失也算作「未完成」，
结果**几乎每次运行都会弹「⚠ 提前收工」**——诚实信号一旦每次都响就没人看了（狼来了）。
现在 `incomplete` 只由 critical 触发；advisory 明细进 `result.completion`，
供执行轨迹与后续评测统计使用。

**为什么不无限催**：每次催促 = 一次额外模型调用（费钱费时），弱模型还会原地打转。
上限 2 次，兜底是 `maxSteps`，并把未完成如实标给用户。

**产出**：`AgenticResult.completion`（checks / coverage / rejectedPendingRetry / nudges / toolCalls）。
测试：`test-agent.js` 新增「催促次数限死 2 次」「critical 未通过 → 不算成功且标注」
「advisory 缺失不弹警告」「completion 记下覆盖与工具调用次数」「收工那一步写出可改进项」。

### 2. 数字保全校验：从「有没有数字」改成「每个数字都在」

发现的问题（不在评审清单里，是在写测试时撞出来的）：校验门原文是

```ts
if (/\d/.test(target.text) && !/\d/.test(text)) reject('丢失了原文的量化数据');
```

它只判断「原文有数字、改写里还有没有数字」，于是下面这些**全部放行**：

```
支撑日活 3 万   → 支撑日活 30 万      （放大 10 倍）
P99 800ms      → P99 1200ms          （性能数字改大）
提升 50%       → 提升 5%             （缩水 10 倍）
```

而「为了让简历好看把数字改大」正是这套系统最该拦住的失真形态 —— 这条检查等于把项目
最核心的承诺（不篡改数字）让掉了。

现在改为按 **token 比对**：抽取原文每个「数字 + 单位」（`3 万` / `800ms` / `50%` / `2.5 倍`），
要求改写里**逐个原样保留**；只判「丢没丢」，不判「多没多」（补充原文没有的量化数据仍允许，
用户自己会看到并对内容负责）。错误信息会点名是哪个数字被改动了。

同时给**规则引擎**补了同一条不变量测试：规则改写是「删套话 + 换强动词」式的字符串手术，
理论上不动数字，但此前没有任何断言守着（LLM 路径有门，规则路径也该有）。

---

## 三、明确未做（归入后续阶段，不在第一阶段硬凑）

| 事项 | 归属 | 说明 |
|---|---|---|
| 最大 token / 最大耗时 / 工具调用次数预算 | 第二阶段（Runtime） | 现在只有 `maxSteps`；预算要和工具注册层一起做才有意义 |
| 运行记录（runId/status/inputSnapshot）、取消、超时恢复、重放 | 第二阶段 | 需要状态机，单独一阶段 |
| 完整 trace（latency/token/retry/error_type）与脱敏 | 第二阶段 | 同上 |
| 50～100 任务评测集与 CI 质量门禁 | 第三阶段 | 指标必须真跑出来再写，不做无数据宣称 |
| `agent-core` / `llm-adapters` 拆分 + CLI + replay | 第四阶段 | 架构级改动，放最后以免前期反复搬代码 |

---

## 四、如何复现以上结论

```bash
npm test              # 全量：引擎/导入/Agent/端到端/契约/流式/校验/备份/更新器/面试/助手 + 评测
node test-agent.js    # 收工校验 + 数字保全（含强化用例）
node test-engine.js   # 规则改写不丢数字的不变量
node test-renderer-apply.js   # 「取消勾选必须保留原文」回归
node test-stream.js   # 流式尾部与多字节分片
npm run smoke:ipc     # 真实主进程：会话授权 / 防越权 / 密钥不回显（需 Electron）
npm run smoke:ui      # 界面管线：170+ 条真实 DOM 断言 + 截图
```
