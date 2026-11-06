"""服务配置：全部来自环境变量，前缀 RESUME_API_。

为什么用 pydantic-settings 而不是手写 os.environ：
配置项会随部署方式变化（本地 / Docker / CI），手写解析很容易出现
「字符串 "false" 被当成 True」这类静默错误，模型层校验能直接拦住。
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_CORPUS = PACKAGE_DIR.parent / "data" / "corpus.json"


class Settings(BaseSettings):
    """运行时配置。所有字段都能用 RESUME_API_<NAME> 覆盖。"""

    model_config = SettingsConfigDict(
        env_prefix="RESUME_API_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- 上游模型（OpenAI 兼容端点，Ollama 也走这一套）----
    llm_endpoint: str = "http://127.0.0.1:11434/v1"
    llm_model: str = "qwen3:8b"
    llm_api_key: str = ""
    llm_timeout_s: float = Field(default=60.0, gt=0, le=600)
    llm_max_attempts: int = Field(default=3, ge=1, le=6)
    llm_backoff_base_s: float = Field(default=0.2, ge=0, le=10)

    # ---- 服务自身 ----
    corpus_path: Path = DEFAULT_CORPUS
    rate_limit_per_min: int = Field(default=60, ge=0, le=100000)
    log_level: str = "INFO"
    service_name: str = "resume-agent-api"

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        normalized = str(value).upper()
        if normalized not in allowed:
            raise ValueError(f"log_level 必须是 {sorted(allowed)} 之一")
        return normalized

    @field_validator("llm_endpoint")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return str(value).rstrip("/")

    @property
    def llm_available(self) -> bool:
        return bool(self.llm_endpoint and self.llm_model)


def get_settings() -> Settings:
    """默认配置入口。测试里可以直接构造 Settings(...) 覆盖。"""
    return Settings()
