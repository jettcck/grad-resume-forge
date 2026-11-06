"""检索层：与 packages/retrieval 的 TS 实现保持同一套分词与 BM25 公式。

为什么要重写一遍而不是调用 Node：
这个服务要独立部署（容器里没有 Node），重复实现是刻意的，
但分词规则和打分公式必须逐项对齐，否则两边结果不可比。
函数 `tokenize` 与 TS 版同样处理：
  - 英文/数字/技术符号按连续串切词并小写
  - 中文按 bigram 切，单字块保留单字
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

_LATIN = re.compile(r"[a-z0-9][a-z0-9_+#.\-]*")
_CJK = re.compile(r"[\u4e00-\u9fa5]+")


@dataclass(frozen=True)
class Doc:
    id: str
    text: str
    domain: str = ""
    tags: tuple[str, ...] = ()
    difficulty: int = 0


@dataclass(frozen=True)
class Hit:
    id: str
    score: float
    rank: int
    doc: Doc


def tokenize(text: str | None) -> list[str]:
    lower = "" if text is None else str(text).lower()
    out: list[str] = []

    for token in _LATIN.findall(lower):
        cleaned = token.rstrip(".-")
        if cleaned:
            out.append(cleaned)

    for block in _CJK.findall(lower):
        if len(block) == 1:
            out.append(block)
            continue
        out.extend(block[i : i + 2] for i in range(len(block) - 1))
    return out


class Bm25Index:
    """Okapi BM25，k1=1.5、b=0.75，与 TS 版一致。"""

    def __init__(self, docs: Iterable[Doc], *, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self._docs: list[Doc] = []
        self._tf: list[dict[str, int]] = []
        self._len: list[int] = []
        self._df: dict[str, int] = {}
        total_len = 0

        for doc in docs:
            tokens = tokenize(doc.text)
            tf: dict[str, int] = {}
            for token in tokens:
                tf[token] = tf.get(token, 0) + 1
            for token in tf:
                self._df[token] = self._df.get(token, 0) + 1
            self._docs.append(doc)
            self._tf.append(tf)
            self._len.append(len(tokens))
            total_len += len(tokens)

        self._avg_len = (total_len / len(self._docs)) if self._docs else 1.0

    def __len__(self) -> int:
        return len(self._docs)

    @property
    def avg_len(self) -> float:
        return self._avg_len

    def search(self, query: str, top_k: int = 5) -> list[Hit]:
        q_tokens = tokenize(query)
        if not q_tokens or not self._docs:
            return []
        n = len(self._docs)
        scored: list[tuple[int, float]] = []
        for idx, tf in enumerate(self._tf):
            score = 0.0
            for term in set(q_tokens):
                freq = tf.get(term)
                if not freq:
                    continue
                df = self._df.get(term, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                norm = 1 - self.b + self.b * (self._len[idx] / self._avg_len)
                score += idf * (freq * (self.k1 + 1)) / (freq + self.k1 * norm)
            if score > 0:
                scored.append((idx, score))

        scored.sort(key=lambda item: item[1], reverse=True)
        return [
            Hit(id=self._docs[idx].id, score=round(score, 6), rank=rank, doc=self._docs[idx])
            for rank, (idx, score) in enumerate(scored[:top_k], start=1)
        ]


def load_corpus(path: Path) -> list[Doc]:
    """从 JSON 读取语料。文件缺失时抛错而不是静默返回空索引。

    静默空索引会让 /v1/knowledge/search 永远返回 0 条，
    「检索不可用」和「检索没命中」就分不开了。
    """
    if not path.exists():
        raise FileNotFoundError(f"语料文件不存在：{path}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    docs_raw = raw.get("docs") if isinstance(raw, dict) else raw
    if not isinstance(docs_raw, list) or not docs_raw:
        raise ValueError(f"语料文件格式不正确或为空：{path}")

    docs: list[Doc] = []
    for item in docs_raw:
        docs.append(
            Doc(
                id=str(item["id"]),
                text=str(item.get("text", "")),
                domain=str(item.get("domain", "")),
                tags=tuple(str(t) for t in item.get("tags", []) or ()),
                difficulty=int(item.get("difficulty", 0) or 0),
            )
        )
    return docs
