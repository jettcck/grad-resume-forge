"""题库检索接口：BM25，可选按 domain 过滤。

domain 过滤用「每个 domain 一个索引」的缓存，而不是先取 top_k 再筛。
后者会在过滤后返回不足 top_k 条，调用方无法区分「没有更多」和「被筛掉了」。
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..retrieval import Bm25Index
from ..schemas import KnowledgeHit, KnowledgeQuery, KnowledgeResponse

router = APIRouter(prefix="/v1/knowledge", tags=["knowledge"])

_SNIPPET_CHARS = 90


@router.post("/search", response_model=KnowledgeResponse, summary="BM25 检索题库")
async def search(payload: KnowledgeQuery, request: Request) -> KnowledgeResponse:
    state = request.app.state
    index: Bm25Index = state.index
    if payload.domain:
        index = state.domain_index(payload.domain)

    hits = index.search(payload.query, payload.top_k)
    state.metrics.knowledge_total += 1
    return KnowledgeResponse(
        query=payload.query,
        total=len(hits),
        corpus_size=len(state.index),
        hits=[
            KnowledgeHit(
                id=hit.id,
                score=hit.score,
                rank=hit.rank,
                domain=hit.doc.domain,
                tags=list(hit.doc.tags),
                difficulty=hit.doc.difficulty,
                snippet=hit.doc.text[:_SNIPPET_CHARS],
            )
            for hit in hits
        ],
    )
