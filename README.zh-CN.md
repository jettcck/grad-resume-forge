# 简历锻造炉 · GradResume Forge

[![CI](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml)
[![Release](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](./LICENSE)
[![English](https://img.shields.io/badge/README-English-blue.svg)](./README.md)

计算机应届生**一键写简历 / 投简历**桌面端 App —— 本地优先 · 去 AI 味引擎 · 规则 + LLM 混合 Agent。

## ✨ 核心特性

- **一键导入旧简历**：选个 PDF / TXT，本地解析器（pdfjs + 教育部高校词表反查）自动填表，合并或替换由你选
- **去 AI 味引擎**：确定性规则层删套话、强化动词、保量化数据；体检评分器实时打分（0-100）
- **JD 精准匹配**：粘贴职位描述，按这份 JD 实际提到的技能逐项比对，命中 / 缺失 / 加分项一目了然
- **Agent 深度优化**：本地 Ollama 或云端 API（DeepSeek / Kimi / 通义 / OpenAI，BYOK 密钥只存本机）按 JD 改写条目；每轮产出必须过**确定性校验门**（套话 / 丢数字 / 评分下降一律拒收重生成），档案不会越改越差
- **投递管理看板**：想投 → 已投递 → 面试中 → Offer，全流程跟踪 + 招聘平台直达
- **本地优先**：数据全部保存在你本机（scrypt 加密），离线可用，无任何遥测
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
npm test           # 全量测试（194 项断言 + 规则层评测）
npm run eval       # 规则层 golden case 评测
npm run eval:llm   # LLM 层评测（需要本机 Ollama）
```

### 启用 Agent 深度优化（可选）

二选一：
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
推送 `v*` tag 时 CI 会校验 tag 与 package.json 版本一致性、先跑全量测试再构建。

### 本地构建（国内网络环境）

GitHub 直连超时 / 镜像符号链接解压失败时：

```bash
npm run dist:local
```

一键完成：npmmirror 下载 winCodeSign（排除 darwin 符号链接目录重新打包）→
给 `app-builder-lib` 打运行时补丁（`scripts/apply-local-patches.js`，幂等）→
起本地二进制源（`scripts/local-bin-source.js`）→ 构建。产物与 CI 同源。
依赖重装后重跑本命令即可，无需手工操作。

## 📊 测试与评测

**240+ 项自动化断言**，push 即跑（CI 门禁）。

| 套件 | 内容 | 命令 |
|---|---|---|
| 引擎自测 | 改写 / 体检 / 匹配 / 词边界回归 | `node test-engine.js` |
| 导入器自测 | 中文简历解析 / PDF 抽取 | `node test-importer.js` |
| Agent 自测 | 校验门 / 重生成 / 流式 / 云端客户端（mock 全链路） | `node test-agent.js` |
| 端到端 | 注册 → 登录 → 存档 → 生成 → 投递 → 快照回炉 | `node test-e2e.js` |
| 更新器烟测 | publish 配置 / 镜像规则 | `node test-updater.js` |
| 规则层评测 | 19 个 golden case 回归门禁 | `npm run eval` |
| LLM 层评测 | 真实模型双模式对比 | `npm run eval:llm` |

### 真实模型评测（deepseek-chat，2026-09）

双模式同 JD 同档案对比，每项 3 用例：

| 指标 | 流水线模式 | 自主 Agent 模式 |
|---|---|---|
| 成功率 | 100% | 100% |
| 校验门接受率 | 100% | 100% |
| 平均轮 / 步数 | 1.0 | 3.0 |
| 体检分增益 | +6.0 | **+9.0** |
| JD 覆盖增益 | +20.0pp | **+36.7pp** |
| 平均耗时 | 1.3s | 4.7s |

> 自主模式用 3 步换取近两倍的 JD 覆盖增益——模型先主动 `analyze_jd` 看缺口再针对性改写，
> 代价是 3.6 倍延迟。产品策略：日常走流水线，重要投递切自主模式。
> 校验门接受率 100% 说明确定性约束零误杀。完整数据见 `evals/llm-report.json`。

## 📄 License

MIT
