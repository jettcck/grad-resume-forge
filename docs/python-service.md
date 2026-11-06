# Python 服务：FastAPI 异步改写与检索

## 1. 它解决什么问题

桌面端是单机 Electron 应用，天然没有这些东西：

- 服务端并发与连接池
- 超时治理与有限重试
- 限流与配额
- 健康检查、就绪检查、结构化访问日志

这些能力写在 Electron 主进程里没有意义，只能在一个真实服务进程里体现。
所以 `services/python-api` 不是「为了简历加一个 Python 项目」，
而是把 Agent 的两项能力（要点改写、题库检索）做成可独立部署的 HTTP 服务。

## 2. 目录

```text
services/python-api/
├── app/
│   ├── main.py          # 应用工厂 + lifespan（加载语料、初始化客户端）
│   ├── config.py        # pydantic-settings，RESUME_API_* 环境变量
│   ├── llm.py           # 异步上游客户端：超时、有限重试、错误分类
│   ├── retrieval.py     # 分词 + BM25（与 TS 实现逐项对齐）
│   ├── schemas.py       # Pydantic v2 模型 + 数字保全判定
│   ├── prompts.py       # 提示词与 PROMPT_VERSION
│   ├── middleware.py    # 请求 ID、访问日志、令牌桶限流
│   ├── metrics.py       # 进程内指标
│   └── routers/         # health / meta / knowledge / rewrite
├── data/corpus.json     # 由题库导出，151 条
├── tests/               # 29 个 pytest 用例
├── Dockerfile
├── requirements.txt
└── pyproject.toml
```

## 3. 接口与实现要点

| 方法 | 路径 | 关键实现 |
|---|---|---|
| GET | `/healthz` | 只证明进程活着，不碰外部依赖 |
| GET | `/readyz` | 语料 + 上游可达性，5 秒缓存，上游挂了返回 `degraded` 而不是 `unavailable` |
| GET | `/metrics` | 进程内计数，明确标注重启清零 |
| GET | `/v1/meta` | 模型、Prompt 版本、语料规模、限流额度 |
| POST | `/v1/knowledge/search` | BM25；`domain` 过滤用「每域一个索引」缓存，避免先取 top_k 再筛导致条数不足 |
| POST | `/v1/rewrite/bullets` | 上游改写 + 数字保全 + 长度硬校验，不通过回退原文并标记原因 |

### 错误映射

| 上游情况 | 返回 | code |
|---|---|---|
| 超时 | 504 | `upstream_timeout` |
| 连接失败 / 5xx | 502 | `upstream_unreachable` / `upstream_server_error` |
| 429 | 503 | `upstream_rate_limited` |
| 4xx 参数错误 | 400 | `upstream_rejected` |
| 返回不是合法 JSON | 502 | `upstream_bad_payload` |

重试只发生在「可能自愈」的分支（超时、连接失败、429、5xx）。
参数错误重试只会把延迟翻倍，所以一次就返回。

### 为什么数字保全放在服务端

提示词是建议，不是约束。模型在长上下文里忘掉「保留数字」非常常见。
`keeps_all_numbers()` 把原文与改写文本里的「数字 + 单位」分别抽出来做集合包含判断，
不通过就不返回该条改写，而是回退原文 + `reason: numbers_lost`。
这样调用方拿到的永远是可用的文本，失败原因也能量化。

## 4. 验证记录（2026-10-28 实测）

### 4.1 单元/集成测试

```bash
cd services/python-api && python -m pytest
# 29 passed
```

覆盖：健康/就绪/指标/OpenAPI、检索命中与排序、domain 过滤、参数校验、
改写成功、数字丢失、超长、缺失条目、fenced JSON 解析、
5xx 重试后成功、超时映射 504、重试耗尽映射 502、4xx 不重试、限流 429。

测试用 `httpx.MockTransport` 注入假上游，不需要真实模型、不需要网络。

### 4.2 真实 HTTP 链路（uvicorn + curl）

启动 `uvicorn app.main:app --port 8123`，用一个最小 OpenAI 兼容桩服务做上游：

```text
GET  /healthz   → {"status":"ok","corpus_size":151,"version":"1.0.0"}
GET  /readyz    → {"status":"ok","llm":{"reachable":true}}
GET  /v1/meta   → {"model":"stub-model","prompt_version":"python-rewrite-v1",...}
POST /v1/knowledge/search → algo-ds-02 排第 1（哈希表查找复杂度）
POST /v1/rewrite/bullets  → rejected=0，attempts=1
GET  /metrics   → requests_total{status="200"} 5
```

### 4.3 真实模型（本机 Ollama qwen3:8b）

同一服务指向 `http://127.0.0.1:11434/v1`，真实改写两条要点：

```json
{"rewrites":[
  {"id":"p0-b0","text":"重构订单系统架构，支撑日活 3 万","kept_numbers":true,"rejected":false},
  {"id":"p0-b1","text":"优化查询性能，响应时间从 800ms 缩短至 120ms","kept_numbers":true,"rejected":false}
],"model":"qwen3:8b","attempts":1,"latency_ms":24440,"rejected":0}
```

286 个字符的输入，单次 24.4 秒完成，数字全部保留，0 条被拒。
这说明链路对真实模型可用，而不只是对假服务可用。

## 5. 边界（必须主动说明）

- **没有数据库**：语料随镜像分发，改写是无状态调用。这个服务没有需要持久化的状态，
  为了「看起来像后端」硬加一个 PostgreSQL 只会增加部署成本。
- **没有鉴权**：定位是本机/内网工具服务。要对外暴露必须先加认证与 TLS。
- **限流是单进程内存态**：多副本部署时额度不共享，需要换成 Redis 计数。
- **没有压测数据**：目前只有单次延迟（24.4 秒，且大部分是模型推理时间），
  没有 QPS、P95、并发连接数。这些数字没有实测就不写。
- **不改桌面端运行方式**：Electron 仍然本地优先、离线可用；这个服务是可选的。

## 6. 简历措辞建议

可以写：

> 使用 FastAPI 构建异步 Python 服务，封装简历改写与题库检索接口；
> 基于 httpx 实现超时与有限重试，按错误类型映射 502/503/504；
> 服务端做数字保全与长度硬校验，并用 pytest + httpx 覆盖 29 个用例。

可以写：

> 实现令牌桶限流、请求 ID 贯穿的结构化日志、存活/就绪分离的健康检查，并提供 Docker 部署。

不要写：

- 「高并发」——没有压测数据
- 「微服务架构」——只有一个服务
- 「生产级」——没有鉴权、没有持久化、没有多副本治理
