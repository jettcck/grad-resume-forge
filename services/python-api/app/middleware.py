"""中间件：请求 ID、访问日志、令牌桶限流。

限流放在 ASGI 中间件而不是路由依赖里，是因为它对所有路由都要生效，
写成依赖会漏掉 /healthz 这类不经过业务函数的路径。
"""

from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .logging_setup import get_logger

logger = get_logger("resume_api.access")

# 健康检查不参与限流：编排系统的探针被限流会导致容器被误杀
_RL_EXEMPT = {"/healthz", "/readyz", "/metrics", "/docs", "/openapi.json"}


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # pragma: no cover - 交给上层异常处理
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            logger.exception(
                "unhandled error",
                extra={
                    "event": "request_error",
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                },
            )
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["x-request-id"] = request_id
        try:
            request.app.state.metrics.inc(str(response.status_code))
        except AttributeError:  # 生命周期未初始化时（如启动失败）不阻塞请求
            pass
        logger.info(
            "request",
            extra={
                "event": "request",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response


class TokenBucket:
    """按客户端维度计数的令牌桶。容量 = 每分钟额度，按秒匀速补充。"""

    def __init__(self, per_minute: int) -> None:
        self.capacity = float(max(per_minute, 1))
        self.refill_per_s = self.capacity / 60.0
        self._buckets: dict[str, tuple[float, float]] = {}

    def consume(self, key: str, now: float | None = None) -> tuple[bool, float]:
        current = time.monotonic() if now is None else now
        tokens, last = self._buckets.get(key, (self.capacity, current))
        tokens = min(self.capacity, tokens + (current - last) * self.refill_per_s)
        if tokens < 1.0:
            self._buckets[key] = (tokens, current)
            wait_s = (1.0 - tokens) / self.refill_per_s if self.refill_per_s else 60.0
            return False, round(wait_s, 2)
        self._buckets[key] = (tokens - 1.0, current)
        return True, 0.0


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, per_minute: int) -> None:
        super().__init__(app)
        self.enabled = per_minute > 0
        self.bucket = TokenBucket(per_minute) if self.enabled else None

    async def dispatch(self, request: Request, call_next) -> Response:
        if not self.enabled or request.url.path in _RL_EXEMPT:
            return await call_next(request)

        client = request.client.host if request.client else "unknown"
        allowed, retry_after = self.bucket.consume(client)  # type: ignore[union-attr]
        if not allowed:
            logger.warning(
                "rate limited",
                extra={"event": "rate_limited", "path": request.url.path, "request_id": getattr(request.state, "request_id", None)},
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "rate_limited",
                        "message": "请求过于频繁，请稍后重试",
                        "retry_after_s": retry_after,
                    }
                },
                headers={"retry-after": str(int(retry_after) + 1)},
            )
        return await call_next(request)
