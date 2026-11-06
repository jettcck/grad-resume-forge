"""进程内指标：够用即可，不引 Prometheus 客户端。

指标口径只在 /metrics 暴露，且明确标注「进程内累计，重启清零」，
避免被误读成持久化的业务指标。
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field


@dataclass
class Metrics:
    requests_total: Counter = field(default_factory=Counter)
    rewrite_total: int = 0
    rewrite_rejected_total: int = 0
    knowledge_total: int = 0
    llm_retry_total: int = 0
    started_at: float = 0.0

    def inc(self, key: str) -> None:
        self.requests_total[key] += 1

    def render(self) -> str:
        lines = [
            "# 进程内累计指标，重启后清零",
            f"resume_api_rewrite_total {self.rewrite_total}",
            f"resume_api_rewrite_rejected_total {self.rewrite_rejected_total}",
            f"resume_api_knowledge_queries_total {self.knowledge_total}",
            f"resume_api_llm_retry_total {self.llm_retry_total}",
        ]
        for key, value in sorted(self.requests_total.items()):
            lines.append(f'resume_api_requests_total{{status="{key}"}} {value}')
        return "\n".join(lines) + "\n"
