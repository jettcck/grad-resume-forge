"""FastAPI 应用工厂。

用工厂而不是模块级 `app = FastAPI()`，是为了让测试能注入
「自定义配置 + 假上游 transport」，不必依赖真实模型或真实网络。
生产入口仍然是模块底部的 `app`，uvicorn 直接 `app.main:app` 即可。
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import SERVICE_VERSION
from .config import Settings, get_settings
from .llm import LlmClient
from .logging_setup import configure_logging, get_logger
from .metrics import Metrics
from .middleware import RateLimitMiddleware, RequestContextMiddleware
from .retrieval import Bm25Index, Doc, load_corpus
from .routers import health, knowledge, meta, rewrite

logger = get_logger("resume_api.app")


def create_app(
    settings: Settings | None = None,
    *,
    llm_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        docs: list[Doc] = load_corpus(settings.corpus_path)
        app.state.settings = settings
        app.state.version = SERVICE_VERSION
        app.state.index = Bm25Index(docs)
        app.state.metrics = Metrics(started_at=time.monotonic())
        app.state.started_at = time.monotonic()
        app.state.llm = LlmClient(settings, transport=llm_transport)
        app.state.llm_probe_cache = None
        app.state._domain_indexes = {}

        def domain_index(domain: str) -> Bm25Index:
            key = domain.strip().lower()
            cache = app.state._domain_indexes
            if key not in cache:
                subset = [doc for doc in docs if doc.domain.lower() == key]
                cache[key] = Bm25Index(subset)
            return cache[key]

        app.state.domain_index = domain_index
        logger.info(
            "service started",
            extra={"event": "startup"},
        )
        try:
            yield
        finally:
            await app.state.llm.aclose()
            logger.info("service stopped", extra={"event": "shutdown"})

    app = FastAPI(
        title="简历 Agent Python 服务",
        version=SERVICE_VERSION,
        description=(
            "面向简历改写与题库检索的异步 HTTP 服务。\n\n"
            "- `POST /v1/rewrite/bullets`：调用 OpenAI 兼容端点改写要点，并做数字保全校验\n"
            "- `POST /v1/knowledge/search`：BM25 检索题库，可按 domain 过滤\n"
            "- `/healthz` 存活、`/readyz` 就绪、`/metrics` 进程内指标\n"
        ),
        lifespan=lifespan,
    )

    # 后 add 的在更外层：RequestContext 必须包住限流，否则 429 没有 request_id
    app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_min)
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health.router)
    app.include_router(meta.router)
    app.include_router(knowledge.router)
    app.include_router(rewrite.router)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover
        logger.exception("unhandled", extra={"event": "unhandled"})
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "服务内部错误", "upstream_status": None}},
        )

    return app


app = create_app()
