"""异步 LLM 客户端：超时、有限重试、错误分类。

三条设计约束：
1. 只对「可能自愈」的错误重试（超时、连接失败、429、5xx）；
   参数错误（400/422）重试一百次也不会变好，只会把延迟翻倍。
2. 重试之间做指数退避 + 抖动，避免上游一抖动就被同一批请求打穿。
3. 错误必须分类向上抛，让路由层能给出 504 / 502 / 503 而不是一律 500。
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


class LlmError(RuntimeError):
    """上游模型错误。status 表示应回给调用方的 HTTP 状态码。"""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        status: int,
        retryable: bool,
        upstream_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.retryable = retryable
        self.upstream_status = upstream_status

    def to_payload(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": str(self),
                "upstream_status": self.upstream_status,
            }
        }


@dataclass(frozen=True)
class LlmReply:
    content: str
    model: str
    attempts: int
    latency_ms: int
    usage: dict[str, Any]


class LlmClient:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.llm_endpoint,
            timeout=httpx.Timeout(settings.llm_timeout_s),
            transport=transport,
            headers=self._headers(settings),
        )

    @staticmethod
    def _headers(settings: Settings) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if settings.llm_api_key:
            headers["authorization"] = f"Bearer {settings.llm_api_key}"
        return headers

    async def aclose(self) -> None:
        await self._client.aclose()

    async def probe(self) -> dict[str, Any]:
        """就绪检查用：只请求 /models，不产生生成成本。"""
        try:
            response = await self._client.get("/models")
        except httpx.TimeoutException:
            return {"reachable": False, "reason": "timeout"}
        except httpx.TransportError as exc:
            return {"reachable": False, "reason": f"transport: {exc.__class__.__name__}"}
        if response.status_code >= 400:
            return {"reachable": False, "reason": f"status {response.status_code}"}
        return {"reachable": True, "reason": "ok"}

    async def chat(self, messages: list[dict[str, str]], *, temperature: float = 0.2) -> LlmReply:
        payload = {
            "model": self._settings.llm_model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        started = time.perf_counter()
        attempts = 0
        last_error: LlmError | None = None

        for attempt in range(1, self._settings.llm_max_attempts + 1):
            attempts = attempt
            try:
                response = await self._client.post("/chat/completions", json=payload)
            except httpx.TimeoutException:
                last_error = LlmError(
                    "上游模型超时", code="upstream_timeout", status=504, retryable=True
                )
            except httpx.TransportError as exc:
                last_error = LlmError(
                    f"上游模型不可达：{exc.__class__.__name__}",
                    code="upstream_unreachable",
                    status=502,
                    retryable=True,
                )
            else:
                if response.status_code < 400:
                    latency_ms = int((time.perf_counter() - started) * 1000)
                    return self._parse(response, attempts=attempts, latency_ms=latency_ms)

                last_error = self._classify_status(response)
                if not last_error.retryable:
                    raise last_error

            if attempt < self._settings.llm_max_attempts:
                await asyncio.sleep(self._backoff(attempt))

        assert last_error is not None
        raise last_error

    def _backoff(self, attempt: int) -> float:
        base = self._settings.llm_backoff_base_s
        if base <= 0:
            return 0.0
        return base * (2 ** (attempt - 1)) + random.uniform(0, base)

    @staticmethod
    def _classify_status(response: httpx.Response) -> LlmError:
        status = response.status_code
        if status == 429:
            return LlmError(
                "上游模型限流", code="upstream_rate_limited", status=503,
                retryable=True, upstream_status=status,
            )
        if status >= 500:
            return LlmError(
                "上游模型服务端错误", code="upstream_server_error", status=502,
                retryable=True, upstream_status=status,
            )
        return LlmError(
            "上游模型拒绝了请求", code="upstream_rejected", status=400,
            retryable=False, upstream_status=status,
        )

    def _parse(self, response: httpx.Response, *, attempts: int, latency_ms: int) -> LlmReply:
        try:
            body = response.json()
        except json.JSONDecodeError as exc:  # pragma: no cover - 上游异常时才触发
            raise LlmError(
                "上游返回的不是 JSON", code="upstream_bad_payload", status=502, retryable=False
            ) from exc

        choices = body.get("choices") or []
        if not choices:
            raise LlmError(
                "上游返回缺少 choices", code="upstream_bad_payload", status=502, retryable=False
            )
        message = choices[0].get("message") or {}
        content = message.get("content")
        if content is None:
            raise LlmError(
                "上游返回缺少 content", code="upstream_bad_payload", status=502, retryable=False
            )
        return LlmReply(
            content=str(content),
            model=str(body.get("model") or self._settings.llm_model),
            attempts=attempts,
            latency_ms=latency_ms,
            usage=body.get("usage") or {},
        )
