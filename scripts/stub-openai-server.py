"""最小 OpenAI 兼容桩服务：仅用于真实 HTTP 链路验证。

放在 scripts/ 下而不是 tests/ 里，是因为它要被「启动真实 uvicorn + 真实 HTTP 调用」
的冒烟脚本使用；tests/ 里的桩走的是 ASGITransport，不产生真实 socket。
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [{"id": "stub-model", "object": "model"}]})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "bad json"})
            return

        user_text = ""
        for message in payload.get("messages", []):
            if message.get("role") == "user":
                user_text = message.get("content", "")
        # 从 user 消息里抠出 "[id] 原文"，原样回传，用于验证数字保全链路
        mapping: dict[str, str] = {}
        for line in user_text.splitlines():
            if line.startswith("[") and "]" in line:
                item_id, _, text = line[1:].partition("]")
                mapping[item_id.strip()] = text.strip()
        rewrites = [{"id": k, "text": v} for k, v in mapping.items()] or [
            {"id": "p0-b0", "text": "主导订单系统开发，支撑日活 3 万"}
        ]
        self._json(
            200,
            {
                "id": "cmpl-stub",
                "object": "chat.completion",
                "model": "stub-model",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": json.dumps({"rewrites": rewrites}, ensure_ascii=False)},
                    }
                ],
                "usage": {"prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18},
            },
        )

    def log_message(self, fmt: str, *args) -> None:  # 静音访问日志
        return


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
