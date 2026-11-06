"""检索接口：命中、排序、domain 过滤、参数校验。"""

from __future__ import annotations

from tests.helpers import make_client


async def test_search_hits_backend_questions_for_java_query():
    async with make_client() as client:
        response = await client.post(
            "/v1/knowledge/search", json={"query": "Java String 不可变 原因", "top_k": 5}
        )

    body = response.json()
    assert response.status_code == 200
    assert body["total"] >= 1
    assert body["corpus_size"] == 151
    assert body["hits"][0]["rank"] == 1
    assert body["hits"][0]["score"] > 0
    assert body["hits"][0]["domain"] == "backend"
    # 排序必须单调不增，否则 rank 与 score 自相矛盾
    scores = [hit["score"] for hit in body["hits"]]
    assert scores == sorted(scores, reverse=True)


async def test_search_respects_top_k():
    async with make_client() as client:
        response = await client.post("/v1/knowledge/search", json={"query": "缓存", "top_k": 3})

    assert len(response.json()["hits"]) <= 3


async def test_search_filters_by_domain():
    async with make_client() as client:
        response = await client.post(
            "/v1/knowledge/search", json={"query": "哈希表 查找 时间复杂度", "top_k": 5, "domain": "algorithm"}
        )

    hits = response.json()["hits"]
    assert hits, "algorithm 域内应有命中"
    assert all(hit["domain"] == "algorithm" for hit in hits)


async def test_search_unknown_domain_returns_empty_not_error():
    async with make_client() as client:
        response = await client.post(
            "/v1/knowledge/search", json={"query": "Java", "top_k": 5, "domain": "no-such-domain"}
        )

    assert response.status_code == 200
    assert response.json()["hits"] == []


async def test_search_rejects_blank_query():
    async with make_client() as client:
        response = await client.post("/v1/knowledge/search", json={"query": "   "})

    assert response.status_code == 422


async def test_search_rejects_out_of_range_top_k():
    async with make_client() as client:
        response = await client.post("/v1/knowledge/search", json={"query": "Java", "top_k": 99})

    assert response.status_code == 422


async def test_search_with_english_query_matches_latin_tokens():
    async with make_client() as client:
        response = await client.post("/v1/knowledge/search", json={"query": "Redis", "top_k": 5})

    hits = response.json()["hits"]
    assert hits, "英文技术词应能召回"
