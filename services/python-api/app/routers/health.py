"""健康检查与指标。

/healthz 只证明「进程活着」，不碰任何外部依赖；
/readyz 才检查语料是否加载、上游模型是否可达。
把两者分开是为了让编排系统区分「该重启」和「等上游恢复」。
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from ..schemas import HealthResponse, ReadyResponse

router = APIRouter()

_PROBE_TTL_S = 5.0


@router.get("/healthz", response_model=HealthResponse, summary="存活探针")
async def healthz(request: Request) -> HealthResponse:
    state = request.app.state
    return HealthResponse(
        status="ok",
        service=state.settings.service_name,
        version=state.version,
        uptime_s=round(time.monotonic() - state.started_at, 3),
        corpus_size=len(state.index),
    )


@router.get("/readyz", response_model=ReadyResponse, summary="就绪探针（含上游探测，5 秒缓存）")
async def readyz(request: Request) -> ReadyResponse:
    state = request.app.state
    now = time.monotonic()
    cached = state.llm_probe_cache
    if cached is None or now - cached[0] > _PROBE_TTL_S:
        probe = await state.llm.probe()
        state.llm_probe_cache = (now, probe)
    else:
        probe = cached[1]

    corpus_ok = len(state.index) > 0
    # 语料缺失是硬故障；上游不可达只是降级（检索接口仍可用）
    status = "ok" if corpus_ok and probe.get("reachable") else ("degraded" if corpus_ok else "unavailable")
    return ReadyResponse(status=status, corpus_size=len(state.index), llm=probe)


@router.get("/metrics", response_class=PlainTextResponse, summary="进程内指标")
async def metrics(request: Request) -> PlainTextResponse:
    return PlainTextResponse(request.app.state.metrics.render(), media_type="text/plain; version=0.0.4")
