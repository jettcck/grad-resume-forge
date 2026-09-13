# 简历锻造炉 · GradResume Forge

[![CI](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml)
[![Release](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](./LICENSE)
[![English](https://img.shields.io/badge/README-English-blue.svg)](./README.md)

应届生**一键写简历 / 投简历**桌面端 App（全专业通用） —— 本地优先 · 去 AI 味引擎 · 规则 + LLM 混合 Agent。

## 🧭 零门槛起步，AI 是可选增强

除**语义级改写**外的全部功能**不需要任何模型、密钥或配置**——装上就能用：

| 能力 | 需要模型？ |
|---|---|
| 档案编辑 · 简历导入 · 生成 · 导出 PDF | ❌ 不需要 —— 纯本地 |
| 去 AI 味体检与 0-100 评分 | ❌ 不需要 —— 确定性规则 |
| JD 精准匹配 | ❌ 不需要 —— 确定性规则 |
| 投递管理看板 | ❌ 不需要 |
| **简历版本**（一个岗位存一版，带该版针对的 JD 与评分，一键载入） | ❌ 不需要 |
| **面试准备**（按你的档案自动生成自我介绍 + 66 题题库 + 开放题模板） | ❌ 不需要 —— 本地生成 |
| **数据自动轮转备份**（每次启动自动留一份，可在「关于」里一键恢复） | ❌ 不需要 |
| 求职小助手（内置知识库） | ❌ 不需要 —— 本地离线 |
| 按 JD 优化 | ❌ **零配置（规则）**不需要 · ✅ 只有想要语义级改写时才需要 |

按 JD 优化有四条通道，任选其一、随时切换：

1. **零配置（规则）**（什么都不用装）—— 确定性引擎按 JD 改写条目：删套话、强化动词、保量化、按 JD 对齐技能表述。即时、离线、可复现，产出同样要过那道确定性校验门。它**做不到**像大模型那样按 JD 语义重组句子、生成全新表述——这是这条通道诚实的边界。
2. **应用内模型**（零配置，需下载一次）—— Qwen2.5-0.5B 经 WebGPU 在应用内运行。首次需下载 **约 270-281MB**，走国内镜像直连（权重 hf-mirror.com / 运行库 gh-proxy.com），**无需科学上网**，按显卡自动选适配档位、网络抖动自动断点续传，之后完全离线可用。需要较新的显卡（WebGPU）。
3. **你本机已有的本地服务** —— 应用会探测 `127.0.0.1` 上的 Ollama、LM Studio、llama.cpp server、vLLM、Jan、text-generation-webui、KoboldCpp、GPT4All，探测到就一键使用，**不需要你再装任何东西**。
4. **云端 API 密钥**（BYOK）—— DeepSeek / Kimi / 通义 / OpenAI 预设，密钥只存本机。

## ⬇️ 下载安装

直接点链接即可，永远是最新版，无需注册、无需密钥：

| 平台 | 下载 | 安装方式 |
|---|---|---|
| **Windows 10/11 (x64)** | **[⬇ grad-resume-forge-setup.exe](https://github.com/jettcck/grad-resume-forge/releases/latest/download/grad-resume-forge-setup.exe)** | 运行安装程序（NSIS），支持自动更新 |
| **Linux (x64)** | **[⬇ grad-resume-forge-x86_64.AppImage](https://github.com/jettcck/grad-resume-forge/releases/latest/download/grad-resume-forge-x86_64.AppImage)** | `chmod +x` 后直接运行，支持自动更新 |
| | **[⬇ grad-resume-forge-amd64.deb](https://github.com/jettcck/grad-resume-forge/releases/latest/download/grad-resume-forge-amd64.deb)** | `sudo apt install ./grad-resume-forge-amd64.deb`（装到 `/opt`，自动加菜单项）；手动更新 |
| **macOS** | — | 暂未提供 |

> 上面用的是 GitHub 的 `releases/latest/download/<文件名>` 形式，**换版本也不会失效**——产物文件名特意不含版本号。需要指定版本或校验值请看[全部 Releases](https://github.com/jettcck/grad-resume-forge/releases)。

Linux 两点提示：
- **AppImage 沙箱**：在限制非特权 user namespace 的发行版（如 Ubuntu 24.04+）上，Electron 的 AppImage 可能报 `SUID sandbox helper` / namespace 错误而拒绝启动。用 `./grad-resume-forge-x86_64.AppImage --no-sandbox` 运行，或为你的发行版开启非特权 user namespace。
- 想要菜单项就装 `.deb`；想要自动更新、不在系统里留东西就用 AppImage。

> 安装包未做代码签名：Windows 可能弹 SmartScreen「未知发布者」→ 点「更多信息 → 仍要运行」。

## ✨ 核心特性

- **一键导入旧简历**：选个 PDF / TXT，本地解析器（pdfjs + 教育部高校词表反查）自动填表，合并或替换由你选
- **去 AI 味引擎**：确定性规则层删套话、强化动词、保量化数据；体检评分器实时打分（0-100）
- **JD 精准匹配**：粘贴职位描述，按这份 JD 实际提到的技能逐项比对，命中 / 缺失 / 加分项一目了然
- **Agent 深度优化**：三通道任选——应用内模型（默认，约 270-281MB 首次下载后离线跑）/ 本地 Ollama / 云端 API（DeepSeek / Kimi / 通义 / OpenAI，BYOK 密钥只存本机），按 JD 改写条目；每轮产出必须过**确定性校验门**（套话 / 丢数字 / 评分下降一律拒收重生成），档案不会越改越差
- **投递管理看板**：想投 → 已投递 → 面试中 → Offer，全流程跟踪 + 招聘平台直达
- **简历版本**：一个岗位存一版。信息录入页右侧「简历版本」→ 存为新版本并命名（如「字节-后端」），它会把这版**针对的 JD** 与当时的**体检分 / JD 覆盖率**一起记住，方便横向比较哪版更贴岗位；下次同一岗位点「载入」一键回来。载入前会自动把当前档案备份到回炉快照，不会丢东西。
- **面试准备**：30 秒 / 60 秒自我介绍**按你自己的档案自动生成**（绝不编造你没写过的经历和数字），另配 66 题题库——按目标岗位方向筛过，每题给出「考察点 / 回答框架 / 常见坑」，讲经历类的问题还会自动指向**你简历里的哪一条**来答；再加网申开放题模板与面试最后的反问清单
- **本地优先**：数据全部保存在你本机（scrypt 加密），离线可用，无任何遥测
- **自动轮转备份**：每次启动自动留一份数据备份（最多 5 份，重复内容不占位），改坏了在「关于」里一键恢复——恢复前还会先把当前状态也存一份，点错了也回得去
- **自动更新**：electron-updater + GitHub Releases，新版本静默下载、重启安装

## 🏗️ 架构

```
Electron
├── 主进程
│   ├── resume-engine.js    规则引擎：改写 / 体检评分 / JD 匹配（纯确定性，可测试）
│   ├── agent.js            Agent 运行时：工具注册表 + 确定性校验门 + 重生成回路
│   ├── llm-client.js       LLM 客户端：Ollama / OpenAI 兼容云端，可切换（SSE 流式）
│   ├── resume-importer.js  PDF/TXT 简历解析器（学校词表反查 + 分节归位）
│   └── store.js            本地 JSON 存储（原子写 + 会话管理）
├── 渲染进程
│   ├── app.js              三页路由：信息录入 / 简历预览 / 投递看板
│   └── template.js         5 套简历模板（经典/极简/科技/商务/活力）
└── evals/                  双层评测：规则层 golden case（CI 门禁）+ LLM 层离线评测
```

**核心设计**：LLM 只负责生成，质量由规则层把关——
`LLM 改写 → 确定性校验门（套话/丢数字/超长/评分下降 → 拒收）→ 带原因重生成 → 人工逐条勾选审批`

## 🚀 快速开始

```bash
npm install
npm start          # 启动应用
npm test           # 全量测试（400+ 项断言 + 规则层评测）
npm run eval       # 规则层 golden case 评测
npm run eval:llm   # LLM 层评测（需要本机 Ollama）
```

### 启用 Agent 深度优化

推荐 —— **应用内模型，零配置**：应用内 ⚙ 配置 → 「应用内模型」（默认已选）→ 点「下载模型到本机」（约 270-281MB，国内镜像直连、无需科学上网；按显卡自动选档、断点续传；之后离线运行）。需要 WebGPU。

或者：
- **本地**：[安装 Ollama](https://ollama.com) → `ollama pull qwen2.5:7b`（全程不出本机）
- **云端**：应用内 ⚙ 配置 → 云端 API → 选预设（DeepSeek / Kimi / 通义 / OpenAI）→ 填自己的 API 密钥

不配置也不影响其他功能，规则引擎始终可用。

### 打包发布

```bash
npm run dist        # 本地打包（release/ 下出 NSIS 安装包，显式 --publish never）
npm run dist:local  # 国内网络一键本地构建（详见下方）
npm run release     # 打包并发布到 GitHub Releases（需 GH_TOKEN）
```

正式发版走 CI：`npm version patch` → `git push --follow-tags` → 自动构建发布。
推送 `v*` tag 时 CI 会校验 tag 与 package.json 版本一致性、先跑全量测试再构建，**同时出 Windows 与 Linux 产物**（矩阵跑 `windows-latest` + `ubuntu-latest`，串行执行避免两个平台同时往同一个 Release 上传产生竞态）。

另有 `build.yml`（可手动触发，PR 也会跑）：只构建不发布，用于**打 tag 之前**验证打包配置。

本地构建：Windows 用 `npm run dist`，Linux 用 `npm run dist:linux`。
**Linux 目标无法在 Windows 上构建**——AppImage 需要符号链接特权、`.deb` 需要 `fpm`，两者都在 ubuntu runner 上正常（公开仓库免费）。

图标由 `npx electron scripts/make-icon.js --no-sandbox` 生成（`build/icon.png` + `build/icons/`）。
Linux 必须用多尺寸目录：单文件图标会让 electron-builder 把图标丢进 `hicolor/0x0/`（菜单里显示不出来）。

### 本地构建（国内网络环境）

GitHub 直连超时 / 镜像符号链接解压失败时：

```bash
npm run dist:local
```

一键完成：npmmirror 下载 winCodeSign（排除 darwin 符号链接目录重新打包）→
给 `app-builder-lib` 打运行时补丁（`scripts/apply-local-patches.js`，幂等）→
起本地二进制源（`scripts/local-bin-source.js`）→ 构建。产物与 CI 同源。
依赖重装后重跑本命令即可，无需手工操作。

### 推送（GitHub 直连不通时）

`github.com:443` 连不上时，**只给本仓库**挂本地代理：

```bash
git config http.proxy http://127.0.0.1:7890
```

刻意用仓库级而非 `--global`：代理没开时只坏这一个仓库，而不是所有仓库。

### 发版注意事项（补发旧 tag 前必读）

**GitHub 判定哪个 release 算「latest」看的是发布先后，不是版本号。**
`electron-updater` 读的是 `GET /releases/latest`——所以只要你在新版**之后**补发了旧 tag，指针就会**往回走**：老版本用户会被提示升级到那个旧版本，然后**永远收不到更新的版本**（卡住）。

- **按版本升序发布。** 确实要补发旧 tag 时，收尾必须让最新版重新成为「最近发布」的那一个。
- `make_latest` 这个 release 字段在这里**不管用**——实测给最新版设 `true`、给旧版设 `false`，指针纹丝不动。
- 真正有效的做法：**重新发布最新版**——`PATCH /repos/{owner}/{repo}/releases/{id}` 传 `{"draft":true}`，再传 `{"draft":false}`。资产不会丢，`published_at` 会刷新，它重新成为 latest。**不需要重传安装包。**
- **每次发版后的检查项：**
  1. `curl -s https://api.github.com/repos/OWNER/REPO/releases/latest` → `tag_name` 必须是你刚发的版本
  2. 拉取该 release 的 `latest.yml`，确认 `version:` 与之一致（这才是更新器真正读的文件）
  3. 若期间补发过旧 tag 且第 1 步不对，按上面的办法把指针修回来

## 📊 测试与评测

**400+ 项自动化断言**，push 即跑（CI 门禁）。

| 套件 | 内容 | 命令 |
|---|---|---|
| 引擎自测 | 改写 / 体检 / 匹配 / 词边界回归 | `node test-engine.js` |
| 导入器自测 | 中文简历解析 / PDF 抽取 | `node test-importer.js` |
| Agent 自测 | 校验门 / 重生成 / 流式 / 云端客户端（mock 全链路） | `node test-agent.js` |
| 端到端 | 注册 → 登录 → 存档 → 生成 → 投递 → 快照回炉 | `node test-e2e.js` |
| 简历版本 | 存版 / 改名 / 载入 / 上限淘汰 | `node test-versions.js` |
| 数据备份 | 轮转 / 去重 / 保留上限 / 越界文件名拒绝 / 恢复前先快照 | `node test-backup.js` |
| 面试准备 | 自我介绍生成 / 题库覆盖 / 不编造数字 | `node test-interview.js` |
| 小助手 | 知识库命中 / 无匹配时的诚实回退 | `node test-assistant.js` |
| 更新器烟测 | publish 配置 / 镜像规则 | `node test-updater.js` |
| 契约自测 | 渲染层 ↔ preload ↔ 主进程 IPC ↔ 截图 mock 保持一致 | `node test-contract.js` |
| 零门槛守卫 | 应用内模型加载形态 / 国内镜像 / CSP / 文案口径 | `node test-embedded.js` |
| 密钥存储 | 明文不落盘 / 加解密往返 | `node test-secure-store.js` |
| 规则层评测 | 32 个 golden case 回归门禁 | `npm run eval` |
| LLM 层评测 | 真实模型双模式对比 | `npm run eval:llm` |

### 真实模型评测（deepseek-chat，2026-09）

双模式同 JD 同档案对比，4 用例（后端 / 前端 / 算法 / **财务**——覆盖技术与非技术方向）：

| 指标 | 流水线模式 | 自主 Agent 模式 |
|---|---|---|
| 成功率 | 100% | 100% |
| 校验门接受率 | 100% | 100% |
| 平均轮 / 步数 | 1.0 | 3.0 |
| 体检分增益 | +7.5 | **+15.0** |
| JD 覆盖增益 | **+25.8pp** | +13.0pp |
| 平均耗时 | 1.1s | 3.9s |

> 财务用例（全专业）：agentic 模式把体检分 61→88、JD 覆盖 88%→100%——
> 「本人…认真负责…各项任务」类套话同样被确定性校验门与改写清理。
> 校验门接受率 100% 说明确定性约束在技术与非技术方向均零误杀。
> 完整数据见 `evals/llm-report.json`。

## ⚠️ 能力边界——本项目**不**声称做到的事

宁可把天花板写在前面，也不想让你自己撞上去：

| 方面 | 如实说明 |
|---|---|
| **「去 AI 味」是规则引擎，不是语言模型判风格** | 词库 + 改写规则：能稳定干掉**已知**套话（赋能/抓手/闭环/leverage/robust…）且绝不丢你的数字；但新造的 AI 腔、陌生说法可能漏过。确定性正是它的价值——可审计、可复现（`npm run eval`）。 |
| **词库是有限的** | 目前约 70 条硬套话 + 30 个英文 GPT 高频词，靠 golden case 持续扩。既是套话又是真实术语的词（对齐/沉淀/复盘/闭环/生态）**只提示、不自动删**——自动删会悄悄改弱你的原文。 |
| **有实义的形容词会保留** | 「建立了**良好的**客户关系」不该变成「建立了客户关系」。后接有实义中心词（客户关系/业绩/经验/渠道/数据…）的形容词一律保留，只删真空洞的（如「良好的沟通能力」）。 |
| **JD 匹配是词表 + 加权，不是语义理解** | 别名关键词匹配，并区分硬性要求（3 倍权重）与加分项（1 倍）——堆加分项关键词刷不上分。常见换说法已收进别名；若 JD 用完全不同的描述表达同一技能仍可能漏判，需要语义判断时请用「Agent 深度优化」贴同一份 JD。 |
| **匹配分不是录用概率** | 它衡量的是你对这一份 JD 的关键词覆盖度，是投递前的自检参考，不是拿到面试的概率。 |
| **自动备份只在启动时留一份，且只保 5 份** | 每次启动应用时，若数据相比上一份备份有变化就轮转出一份新的，最多保留 5 份（约合最近 5 次改动），可在「关于」里一键恢复。它防的是「改坏了想退回去」，**不是**完整的历史版本管理——重要节点请自己用「简历版本」存一版，或者点「打开备份文件夹」另存到别处。 |
| **平台与维护** | 目前 Windows x64 与 Linux x64（AppImage + deb），macOS 在计划内；单人维护。评测、文档与 CI 的存在就是为了把接手成本压低，而不是假装人多。 |
| **尚无大规模用户验证** | 早期项目、用户量小。公开数字是**可复现的评测结果**，不是用户证言或大规模 A/B 数据——功能宣传请按此口径理解。 |

## 📄 License

MIT
