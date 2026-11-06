"""测试辅助：构造可注入假上游的应用实例。

不引入 asgi-lifespan 之类的额外依赖：
Starlette 的 `router.lifespan_context` 就是官方入口，直接用它即可。
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable

import httpx

from app.config import Settings
from app.main import create_app

CORPUS_PATH = Path(__file__).resolve().parents[1] / "data" / "corpus.json"


def make_settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "corpus_path": CORPUS_PATH,
        "rate_limit_per_min": 0,  # 默认关限流，只有限流用例单独打开
        "llm_endpoint": "http://fake-llm.local/v1",
        "llm_model": "fake-model",
        "llm_timeout_s": 5.0,
        "llm_max_attempts": 3,
        "llm_backoff_base_s": 0.0,  # 测试不等待退避
        "log_level": "WARNING",
    }
    base.update(overrides)
    return Settings(**base)


@asynccontextmanager
async def make_client(handler: Callable[[httpx.Request], httpx.Response] | None = None, **overrides: Any):
    transport = httpx.MockTransport(handler) if handler is not None else None
    app = create_app(make_settings(**overrides), llm_transport=transport)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            yield client


def chat_response(content: str, *, model: str = "fake-model") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "cmpl-test",
            "object": "chat.completion",
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )


def rewrites_json(mapping: dict[str, str], *, fenced: bool = False) -> str:
    body = json.dumps({"rewrites": [{"id": k, "text": v} for k, v in mapping.items()]}, ensure_ascii=False)
    return f"```json\n{body}\n```" if fenced else body


class CountingHandler:
    """记录调用次数，并按脚本依次返回响应 / 抛异常。"""

    def __init__(self, script: list[httpx.Response | Exception]) -> None:
        self.script = script
        self.calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        step = self.script[min(self.calls - 1, len(self.script) - 1)]
        if isinstance(step, Exception):
            raise step
        return step
