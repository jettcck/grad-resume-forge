"""请求 / 响应模型与「数字保全」判定。

数字保有判定刻意放在 schema 层：它是这个服务的业务红线，
和 HTTP 形状无关，测试可以直接调用函数验证，不必先起服务。
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

# 与 src/main/validate.ts 的口径一致：数字 + 可选单位，去空白后逐个比对
_NUMBER = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:%|‰|万|亿|千|百|ms|s|秒|分钟|小时|天|周|月|年|人|次|个|条|倍|元|GB|MB|KB|TB|QPS|qps)?"
)


def extract_numbers(text: str | None) -> list[str]:
    return [match.group(0).replace(" ", "") for match in _NUMBER.finditer(text or "")]


def keeps_all_numbers(original: str, rewritten: str) -> bool:
    before = set(extract_numbers(original))
    after = set(extract_numbers(rewritten))
    return before.issubset(after)


class Bullet(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=400)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text 不能为空白")
        return value


class RewriteRequest(BaseModel):
    bullets: list[Bullet] = Field(min_length=1, max_length=20)
    job_description: str = Field(default="", max_length=4000)
    max_chars: int = Field(default=60, ge=20, le=200)


class RewrittenBullet(BaseModel):
    id: str
    text: str
    kept_numbers: bool
    rejected: bool
    reason: str | None = None


class RewriteResponse(BaseModel):
    rewrites: list[RewrittenBullet]
    model: str
    prompt_version: str
    attempts: int
    latency_ms: int
    rejected: int


class KnowledgeQuery(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    top_k: int = Field(default=5, ge=1, le=20)
    domain: str | None = Field(default=None, max_length=32)

    @field_validator("query")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("query 不能为空白")
        return value.strip()


class KnowledgeHit(BaseModel):
    id: str
    score: float
    rank: int
    domain: str
    tags: list[str]
    difficulty: int
    snippet: str


class KnowledgeResponse(BaseModel):
    query: str
    total: int
    corpus_size: int
    hits: list[KnowledgeHit]


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    uptime_s: float
    corpus_size: int


class ReadyResponse(BaseModel):
    status: str
    corpus_size: int
    llm: dict


class MetaResponse(BaseModel):
    service: str
    version: str
    model: str
    endpoint: str
    corpus_size: int
    prompt_version: str
    rate_limit_per_min: int
