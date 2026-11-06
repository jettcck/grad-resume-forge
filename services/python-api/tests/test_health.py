"""健康检查、就绪检查、元信息、指标。"""

from __future__ import annotations

import httpx
import pytest

from tests.helpers import CountingHandler, make_client


async def test_healthz_reports_corpus_size():
    async with make_client() as client:
        response = await client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["corpus_size"] == 151
    assert body["uptime_s"] >= 0
    assert response.headers["x-request-id"]


async def test_readyz_ok_when_upstream_reachable():
    handler = CountingHandler([httpx.Response(200, json={"data": [{"id": "fake-model"}]})])
    async with make_client(handler) as client:
        response = await client.get("/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["llm"]["reachable"] is True


async def test_readyz_degraded_when_upstream_unreachable():
    handler = CountingHandler([httpx.ConnectError("refused")])
    async with make_client(handler) as client:
        response = await client.get("/readyz")

    assert response.status_code == 200
    body = response.json()
    # 上游挂了不影响检索，属于降级而不是不可用
    assert body["status"] == "degraded"
    assert body["llm"]["reachable"] is False


async def test_readyz_probe_is_cached():
    handler = CountingHandler([httpx.Response(200, json={"data": []})])
    async with make_client(handler) as client:
        await client.get("/readyz")
        await client.get("/readyz")

    assert handler.calls == 1


async def test_meta_exposes_model_and_prompt_version():
    async with make_client() as client:
        response = await client.get("/v1/meta")

    body = response.json()
    assert response.status_code == 200
    assert body["model"] == "fake-model"
    assert body["prompt_version"] == "python-rewrite-v1"
    assert body["corpus_size"] == 151


async def test_metrics_exposes_counters():
    async with make_client() as client:
        await client.post("/v1/knowledge/search", json={"query": "Redis 缓存", "top_k": 3})
        response = await client.get("/metrics")

    assert response.status_code == 200
    assert "resume_api_knowledge_queries_total 1" in response.text
    assert 'status="200"' in response.text


async def test_openapi_schema_is_generated():
    async with make_client() as client:
        response = await client.get("/openapi.json")

    schema = response.json()
    assert response.status_code == 200
    assert "/v1/rewrite/bullets" in schema["paths"]
    assert "/v1/knowledge/search" in schema["paths"]


@pytest.mark.parametrize("path", ["/healthz", "/metrics"])
async def test_probe_endpoints_are_not_rate_limited(path):
    async with make_client(rate_limit_per_min=1) as client:
        for _ in range(3):
            response = await client.get(path)
            assert response.status_code == 200
