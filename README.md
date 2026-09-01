# 简历锻造炉 · GradResume Forge

[![CI](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/ci.yml)
[![Release](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml/badge.svg)](https://github.com/jettcck/grad-resume-forge/actions/workflows/release.yml)

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

### 打包发布（全自动流水线）

推送即测，打 tag 即发版：

```bash
npm version patch        # 1.1.0 → 1.1.1（自动改版本号 + 提交 + 打 tag）
git push --follow-tags   # 推送提交与 tag → CI 自动构建并发布到 Releases
```

- **CI**：push / PR 自动跑全量测试与语法检查（`.github/workflows/ci.yml`）
- **Release**：推送 `v*` tag 触发（`.github/workflows/release.yml`）——校验 tag 与 `package.json` 版本一致 → 跑一遍测试 → 构建 Windows 安装包 → 发布正式版 Releases（含 `latest.yml`，用户端自动更新依赖它）
- 本地打包仅供自用：`npm run dist`（显式 `--publish never`，不会误发版）

## 📊 测试与评测

| 套件 | 内容 | 命令 |
|---|---|---|
| 引擎自测 | 改写 / 体检 / 匹配 / 词边界回归 | `node test-engine.js` |
| 导入器自测 | 中文简历解析 / PDF 抽取 | `node test-importer.js` |
| Agent 自测 | 校验门 / 重生成 / 流式 / 云端客户端（mock 全链路） | `node test-agent.js` |
| 端到端 | 注册 → 登录 → 存档 → 生成 → 投递 | `node test-e2e.js` |
| 更新器烟测 | publish 配置 / 镜像规则 | `node test-updater.js` |
| 规则层评测 | 19 个 golden case 回归门禁 | `npm run eval` |
| LLM 层评测 | 真实模型成功率 / 接受率 / 增益 | `npm run eval:llm` |

## 📄 License

MIT
