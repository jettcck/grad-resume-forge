# 代码与工作流审查（2026-11-20）

v1.15.2 修复了本轮复现的工作流缺陷；本地编译、全量回归与真实桌面烟测通过。

## 覆盖范围

全仓库跟踪的 JavaScript 语法检查、TypeScript 严格编译及类型检查，审核主进程、渲染层、Agent Runtime、LLM 适配器、检索包、Python 服务与构建/CI/Release 配置。核心路径覆盖注册登录、档案保存、导入、生成、改写应用、岗位与投递、版本/快照、笔试判题、备份恢复及更新。

## 已复现并修复

| 触发条件 | 原行为 | 修复与回归 |
|---|---|---|
| 规则改写以 800ms、-5%、3.5 万开头 | 行首数字被误当编号剥离 | 仅剥离带分隔符的编号和项目符号；test-engine.js 覆盖数字与编号 |
| 同毫秒保存或系统时钟回拨 | updatedAt 碰撞，旧改写可能覆盖新保存 | 每次保存递增版本；test-e2e.js 覆盖同毫秒和回拨 |
| Agent 收尾复测抛异常 | finished=true、COMPLETED 记录与错误并存 | 收尾成功后才提交完成状态；test-runtime.js 覆盖完成与部分完成候选 |
| Python 模型将 -5% 改为 +5% | 数字门错误放行 | 保留正负号和单位，归一化空白及 Unicode 负号 |
| 模型返回数组、错误 choices/message/content、非字符串改写或重复 id | 未分类异常或错误文本被接受 | 明确返回 502；重复输入 id 在请求校验时返回 422 |
| CI 未安装 Python 测试依赖 | Python 测试跳过但流水线仍绿 | CI/Release 安装 Python 3.11 与测试依赖；CI 缺依赖直接失败 |
| 界面断言打印失败 | 截图脚本仍退出 0 | 累计失败并返回非零退出码；接入 Windows 桌面 CI |
| 干净检出直接启动或本地打包 | 核心包 dist 缺失；手工 asar 缺检索包和提示词 | 启动/打包先执行完整 build，补齐资源及契约检查 |
| 已有回归未纳入 npm test；引擎没有断言汇总 | 检查漏跑，统计遗漏 | 补入 UI/地图交互/笔试安全/同步预览 4 套回归，补齐引擎统计 |

## 本地验证

- 121 个跟踪 JavaScript 文件：node --check 全部通过。
- npm run build / npm run typecheck：通过。
- npm test：原 34 套汇总 1,822 项全绿；引擎补齐统计后单独执行 109 项全绿，共 35 套、1,931 项，0 失败。
- Python 服务：53 项通过；CI 缺依赖与本地可选跳过分支已验证。
- 真实 IPC：140 项通过；界面：210 项通过、20 张截图。
- PDF 导入：76 项通过；单实例锁：5 项通过。
- Windows NSIS 构建与打包版启动：通过，asar 必需文件检查通过。
- npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org：0 项漏洞。
- 所有 GitHub Actions YAML 可解析；git diff --check 通过。

本地验证日志保留在仓库下 npm-test-audit-*.log（已被忽略）。真实模型评测未执行，本轮没有改写历史真实模型报告。Linux 打包和远端 CI 在 GitHub 验证，结果以该提交对应 Actions 记录为准。
