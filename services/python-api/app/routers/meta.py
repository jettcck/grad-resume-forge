"""服务元信息：让人一眼看清「这一版到底跑的是什么」。"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..prompts import PROMPT_VERSION
from ..schemas import MetaResponse

router = APIRouter(prefix="/v1", tags=["meta"])


@router.get("/meta", response_model=MetaResponse, summary="服务与模型元信息")
async def meta(request: Request) -> MetaResponse:
    state = request.app.state
    settings = state.settings
    return MetaResponse(
        service=settings.service_name,
        version=state.version,
        model=settings.llm_model,
        endpoint=settings.llm_endpoint,
        corpus_size=len(state.index),
        prompt_version=PROMPT_VERSION,
        rate_limit_per_min=settings.rate_limit_per_min,
    )
