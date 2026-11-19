"""改写接口：成功路径、硬约束、上游错误分类与重试。"""

from __future__ import annotations

import httpx
import pytest

from app.routers.rewrite import parse_rewrites
from app.schemas import keeps_all_numbers
from tests.helpers import CountingHandler, chat_response, make_client, rewrites_json

BULLETS = [
    {"id": "p0-b0", "text": "负责订单系统开发，支撑日活 3 万"},
    {"id": "p0-b1", "text": "优化查询性能，响应时间从 800ms 降到 120ms"},
]


async def test_rewrite_success_keeps_numbers():
    handler = CountingHandler(
        [
            chat_response(
                rewrites_json(
                    {
                        "p0-b0": "主导订单系统开发，支撑日活 3 万",
                        "p0-b1": "优化查询性能，响应时间从 800ms 降到 120ms",
                    }
                )
            )
        ]
    )
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": BULLETS})

    body = response.json()
    assert response.status_code == 200
    assert body["rejected"] == 0
    assert body["attempts"] == 1
    assert body["prompt_version"] == "python-rewrite-v1"
    first = body["rewrites"][0]
    assert first["id"] == "p0-b0"
    assert first["kept_numbers"] is True
    assert first["rejected"] is False
    assert first["text"].startswith("主导")


async def test_rewrite_rejects_when_numbers_lost():
    handler = CountingHandler([chat_response(rewrites_json({"p0-b0": "主导订单系统开发"}))])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    body = response.json()
    assert response.status_code == 200
    item = body["rewrites"][0]
    assert item["rejected"] is True
    assert item["kept_numbers"] is False
    assert item["reason"] == "numbers_lost"
    # 被拒时回退原文，不能把丢数字的文本返回给调用方
    assert item["text"] == BULLETS[0]["text"]
    assert body["rejected"] == 1


async def test_rewrite_rejects_too_long_text():
    handler = CountingHandler([chat_response(rewrites_json({"p0-b0": "主导订单系统开发并支撑日活 3 万的完整链路" * 3}))])
    async with make_client(handler) as client:
        response = await client.post(
            "/v1/rewrite/bullets", json={"bullets": [BULLETS[0]], "max_chars": 30}
        )

    item = response.json()["rewrites"][0]
    assert item["rejected"] is True
    assert item["reason"] == "too_long"


async def test_rewrite_marks_missing_bullets():
    handler = CountingHandler([chat_response(rewrites_json({"p0-b0": "主导订单系统开发，支撑日活 3 万"}))])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": BULLETS})

    items = {item["id"]: item for item in response.json()["rewrites"]}
    assert items["p0-b0"]["rejected"] is False
    assert items["p0-b1"]["rejected"] is True
    assert items["p0-b1"]["reason"] == "missing_in_response"


async def test_rewrite_accepts_fenced_json():
    handler = CountingHandler(
        [chat_response(rewrites_json({"p0-b0": "主导订单系统开发，支撑日活 3 万"}, fenced=True))]
    )
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert response.status_code == 200
    assert response.json()["rejected"] == 0


async def test_rewrite_retries_5xx_then_succeeds():
    handler = CountingHandler(
        [
            httpx.Response(500, json={"error": "boom"}),
            chat_response(rewrites_json({"p0-b0": "主导订单系统开发，支撑日活 3 万"})),
        ]
    )
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    body = response.json()
    assert response.status_code == 200
    assert body["attempts"] == 2
    assert handler.calls == 2


async def test_rewrite_timeout_maps_to_504():
    handler = CountingHandler([httpx.TimeoutException("slow")])
    async with make_client(handler, llm_max_attempts=1) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert response.status_code == 504
    assert response.json()["detail"]["error"]["code"] == "upstream_timeout"


async def test_rewrite_exhausts_retries_and_reports_502():
    handler = CountingHandler([httpx.ConnectError("refused")])
    async with make_client(handler, llm_max_attempts=3) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert response.status_code == 502
    assert response.json()["detail"]["error"]["code"] == "upstream_unreachable"
    assert handler.calls == 3


async def test_rewrite_does_not_retry_client_error():
    handler = CountingHandler([httpx.Response(400, json={"error": "bad request"})])
    async with make_client(handler, llm_max_attempts=3) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert response.status_code == 400
    assert response.json()["detail"]["error"]["code"] == "upstream_rejected"
    # 参数错误重试没有意义，只能浪费一次上游调用
    assert handler.calls == 1


async def test_rewrite_bad_payload_maps_to_502():
    handler = CountingHandler([chat_response("抱歉，我无法完成。")])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert response.status_code == 502
    assert response.json()["detail"]["error"]["code"] == "upstream_bad_payload"


async def test_rewrite_validates_empty_bullets():
    async with make_client() as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": []})

    assert response.status_code == 422


async def test_rewrite_rate_limited():
    handler = CountingHandler([chat_response(rewrites_json({"p0-b0": "主导订单系统开发，支撑日活 3 万"}))])
    async with make_client(handler, rate_limit_per_min=1) as client:
        first = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})
        second = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limited"
    assert "retry-after" in {k.lower() for k in second.headers}


def test_parse_rewrites_tolerates_noise_around_json():
    content = '以下是改写结果：\n{"rewrites":[{"id":"a","text":"做了一件事"}]}\n希望有帮助'
    assert parse_rewrites(content) == {"a": "做了一件事"}


@pytest.mark.parametrize("original,rewritten,expected", [
    ("变化 -5%", "变化 +5%", False),
    ("变化 +5%", "变化 -5%", False),
    ("变化 −5%", "变化 -5%", True),
    ("覆盖 3\t万人", "覆盖 3 万人", True),
    ("响应 800ms", "响应 800s", False),
    ("费用 5 美元", "费用 5 元", False),
    ("流量 5k", "流量 5w", False),
    ("响应从 800ms 降到 120ms", "将响应从 800ms 缩减至 120ms", True),
])
def test_number_preservation(original, rewritten, expected):
    assert keeps_all_numbers(original, rewritten) is expected


async def test_rewrite_rejects_sign_change_and_returns_original():
    bullet = {"id": "a", "text": "成本变化 -5%"}
    handler = CountingHandler([chat_response(rewrites_json({"a": "成本变化 +5%"}))])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [bullet]})
    item = response.json()["rewrites"][0]
    assert response.status_code == 200
    assert item["rejected"] is True
    assert item["text"] == bullet["text"]


@pytest.mark.parametrize("upstream_body", [
    [], None, "unexpected", {"choices": {}}, {"choices": [None]},
    {"choices": [{"message": []}]}, {"choices": [{"message": {"content": None}}]},
    {"choices": [{"message": {"content": {"rewrites": []}}}]},
    {"choices": [{"message": {"content": "  "}}]},
])
async def test_malformed_upstream_response_maps_to_502(upstream_body):
    handler = CountingHandler([httpx.Response(200, json=upstream_body)])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0]]})
    assert response.status_code == 502
    assert response.json()["detail"]["error"]["code"] == "upstream_bad_payload"
    assert handler.calls == 1


@pytest.mark.parametrize("text", [None, 42, {}, []])
async def test_non_string_rewrite_is_rejected(text):
    import json
    handler = CountingHandler([chat_response(json.dumps({"rewrites": [{"id": "a", "text": text}]}))])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [{"id": "a", "text": "开发系统"}]})
    assert response.status_code == 502
    assert response.json()["detail"]["error"]["code"] == "upstream_bad_payload"


async def test_duplicate_bullet_ids_are_rejected_before_upstream_call():
    handler = CountingHandler([chat_response("unused")])
    async with make_client(handler) as client:
        response = await client.post("/v1/rewrite/bullets", json={"bullets": [BULLETS[0], BULLETS[0]]})
    assert response.status_code == 422
    assert handler.calls == 0


def test_duplicate_rewrite_ids_are_rejected():
    with pytest.raises(ValueError, match="重复"):
        parse_rewrites('{"rewrites":[{"id":"a","text":"第一条"},{"id":"a","text":"第二条"}]}')
