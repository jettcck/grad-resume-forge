"""改写接口：一次调用完成「模型改写 → 结构校验 → 数字保全 → 长度约束」。

校验放在服务端而不是只靠提示词，是因为提示词只是建议，
模型完全可以在长上下文里忘掉规则；这里做的是硬约束。
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException, Request

from ..llm import LlmError
from ..prompts import PROMPT_VERSION, build_messages
from ..schemas import RewriteRequest, RewriteResponse, RewrittenBullet, keeps_all_numbers

router = APIRouter(prefix="/v1/rewrite", tags=["rewrite"])

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_rewrites(content: str) -> dict[str, str]:
    """从模型输出里取出 {id: text}。容忍 ```json 包裹与前后噪声。"""
    cleaned = _FENCE.sub("", content).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("模型输出中没有 JSON 对象")
    payload = json.loads(cleaned[start : end + 1])
    items = payload.get("rewrites")
    if not isinstance(items, list):
        raise ValueError("模型输出缺少 rewrites 数组")

    result: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id", "")).strip()
        text = str(item.get("text", "")).strip()
        if item_id and text:
            result[item_id] = text
    if not result:
        raise ValueError("模型输出里没有任何有效改写")
    return result


@router.post("/bullets", response_model=RewriteResponse, summary="改写简历要点（带数字保全校验）")
async def rewrite_bullets(payload: RewriteRequest, request: Request) -> RewriteResponse:
    state = request.app.state
    messages = build_messages(
        [bullet.model_dump() for bullet in payload.bullets],
        payload.job_description,
        payload.max_chars,
    )

    try:
        reply = await state.llm.chat(messages)
    except LlmError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.to_payload()) from exc

    if reply.attempts > 1:
        state.metrics.llm_retry_total += reply.attempts - 1

    try:
        mapping = parse_rewrites(reply.content)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "error": {
                    "code": "upstream_bad_payload",
                    "message": f"无法解析模型输出：{exc}",
                    "upstream_status": None,
                }
            },
        ) from exc

    rewrites: list[RewrittenBullet] = []
    for bullet in payload.bullets:
        text = mapping.get(bullet.id)
        if text is None:
            rewrites.append(
                RewrittenBullet(
                    id=bullet.id,
                    text=bullet.text,
                    kept_numbers=True,
                    rejected=True,
                    reason="missing_in_response",
                )
            )
            continue

        if not keeps_all_numbers(bullet.text, text):
            rewrites.append(
                RewrittenBullet(
                    id=bullet.id,
                    text=bullet.text,
                    kept_numbers=False,
                    rejected=True,
                    reason="numbers_lost",
                )
            )
            continue

        if len(text) > payload.max_chars:
            rewrites.append(
                RewrittenBullet(
                    id=bullet.id,
                    text=text,
                    kept_numbers=True,
                    rejected=True,
                    reason="too_long",
                )
            )
            continue

        rewrites.append(
            RewrittenBullet(id=bullet.id, text=text, kept_numbers=True, rejected=False)
        )

    rejected = sum(1 for item in rewrites if item.rejected)
    state.metrics.rewrite_total += 1
    state.metrics.rewrite_rejected_total += rejected

    return RewriteResponse(
        rewrites=rewrites,
        model=reply.model,
        prompt_version=PROMPT_VERSION,
        attempts=reply.attempts,
        latency_ms=reply.latency_ms,
        rejected=rejected,
    )
