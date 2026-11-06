# 简历 Agent · Python 服务

一个可独立部署的 **FastAPI 异步服务**，把「简历要点改写」和「题库检索」做成 HTTP 接口。

存在的意义不是「给简历凑一个 Python 项目」，而是补上桌面端缺的那一层：
桌面端是单机 Electron，没有服务端并发、超时治理、限流和健康检查。
这些能力只能在一个真实服务里体现，写在本机代码里不算数。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` | 存活探针，不碰任何外部依赖 |
| GET | `/readyz` | 就绪探针，检查语料加载与上游模型可达（5 秒缓存） |
| GET | `/metrics` | 进程内指标（重启清零） |
| GET | `/v1/meta` | 版本、模型、Prompt 版本、语料规模 |
| POST | `/v1/knowledge/search` | BM25 检索题库，可按 `domain` 过滤 |
| POST | `/v1/rewrite/bullets` | 改写简历要点，服务端做数字保全与长度硬校验 |
| GET | `/docs` | OpenAPI 文档 |

## 关键实现点

**异步 I/O**
`httpx.AsyncClient` + `async def` 路由，单进程可同时挂起多个上游请求；
超时由 `httpx.Timeout` 统一控制，不靠 `asyncio.wait_for` 包一层。

**有限重试**
只对超时、连接失败、429、5xx 重试；400/422 直接返回。
重试间隔做指数退避 + 抖动，避免上游抖动时被同批请求打穿。

**错误分类**
上游超时 → `504`，不可达/5xx → `502`，上游限流 → `503`，
参数错误 → `400`，模型输出不是合法 JSON → `502 upstream_bad_payload`。
全链路错误体形状统一：`{"error": {"code", "message", "upstream_status"}}`。

**业务硬约束在服务端**
提示词只是建议。数字是否保全、文本是否超长，由 `keeps_all_numbers()` 判定；
不通过的条目回退原文并标记 `rejected` / `reason`，绝不把丢数字的文本返回给调用方。

**限流**
令牌桶按客户端维度计数，容量等于每分钟额度，按秒匀速补充；
健康检查与指标路径豁免，避免编排系统探针被限流误杀。

**可观测性**
每请求一个 `x-request-id`（可透传），访问日志为单行 JSON，字段含
`request_id / method / path / status / duration_ms`。

## 语料

`data/corpus.json` 由题库导出，不是手写：

```bash
node scripts/export-exam-corpus.js   # 从 dist/main/exam-bank.js 生成，当前 151 条
```

分词与打分与 `packages/retrieval` 的 TS 实现逐项对齐（中文 bigram、BM25 k1=1.5/b=0.75），
两边结果可以直接对比。

## 本地运行

```bash
# 安装（推荐用虚拟环境，避免污染系统 Python）
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r requirements-dev.txt

# 启动
RESUME_API_LLM_ENDPOINT=http://127.0.0.1:11434/v1 \
RESUME_API_LLM_MODEL=qwen3:8b \
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## 测试

```bash
pytest            # 29 个用例：健康检查、检索、改写、重试、超时、限流、错误映射
```

测试用 `httpx.MockTransport` 注入假上游，**不依赖真实模型、不依赖网络**；
另有一条独立冒烟：启动真实 `uvicorn` + 真实 HTTP 请求（见 `docs/python-service.md`）。

## 配置

全部通过环境变量覆盖，前缀 `RESUME_API_`：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `RESUME_API_LLM_ENDPOINT` | `http://127.0.0.1:11434/v1` | OpenAI 兼容端点 |
| `RESUME_API_LLM_MODEL` | `qwen3:8b` | 模型名 |
| `RESUME_API_LLM_API_KEY` | 空 | 云端端点用 |
| `RESUME_API_LLM_TIMEOUT_S` | `60` | 单次请求超时 |
| `RESUME_API_LLM_MAX_ATTEMPTS` | `3` | 最大尝试次数（含首次） |
| `RESUME_API_RATE_LIMIT_PER_MIN` | `60` | 每客户端每分钟额度，0 表示关闭 |
| `RESUME_API_CORPUS_PATH` | `data/corpus.json` | 语料路径 |
| `RESUME_API_LOG_LEVEL` | `INFO` | 日志级别 |

## Docker

```bash
docker build -t resume-agent-api .
docker run --rm -p 8000:8000 \
  -e RESUME_API_LLM_ENDPOINT=http://host.docker.internal:11434/v1 \
  resume-agent-api
```

镜像内含 `HEALTHCHECK`，以非 root 用户运行。

## 边界

- 没有接数据库：语料随镜像分发，改写是无状态调用，不存在需要持久化的会话。
- 没有做鉴权：定位是「本机/内网工具服务」。要对外暴露必须先加认证与 TLS。
- 限流是单进程内存态，多副本部署时额度不共享，需要换成 Redis 计数。
