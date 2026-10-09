"""应用配置与派生连接地址，使用 Pydantic Settings 校验配置边界。"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    """应用、数据库与模型供应商配置，敏感字段通过 SecretStr 包装。

    配置由 Pydantic Settings 按 GENESIS_ 前缀解析；禁止输出完整配置对象
    或已展开的敏感字段。派生数据库地址仅交给连接层使用。
    """

    model_config = SettingsConfigDict(
        env_prefix="GENESIS_",
        extra="ignore",
    )

    app_name: str = "Genesis API"
    environment: str = "development"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173"]
    database_url: str | None = None
    database_host: str = "postgres"
    database_port: int = 5432
    database_name: str = "genesis"
    database_user: str = "genesis"
    database_password: SecretStr = SecretStr("genesis")
    jwt_secret: SecretStr = SecretStr("development-only-jwt-secret-do-not-use-in-production")
    jwt_access_token_expire_minutes: int = 120
    development_owner_password: SecretStr = SecretStr("genesis-local-only")

    text_provider: Literal["openai", "grok", "gemini", "claude", "mimo"] = "openai"
    text_openai_api_key: SecretStr | None = None
    text_openai_base_url: str = "https://api.openai.com/v1"
    text_openai_model: str = "gpt-5.6-luna"
    text_grok_api_key: SecretStr | None = None
    text_grok_base_url: str = "https://api.x.ai/v1"
    text_grok_model: str | None = None
    text_gemini_api_key: SecretStr | None = None
    text_gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    text_gemini_model: str | None = None
    text_claude_api_key: SecretStr | None = None
    text_claude_base_url: str = "https://api.anthropic.com"
    text_claude_model: str | None = None
    text_mimo_api_key: SecretStr | None = None
    text_mimo_base_url: str = "https://api.xiaomimimo.com/v1"
    text_mimo_model: str = "mimo-v2.6-flash"
    text_temperature: float = 0.7
    text_max_tokens: int = 4096

    agent_action_secret: SecretStr = SecretStr("development-only-agent-action-secret")
    agent_action_expire_seconds: int = 600
    agent_max_concurrent_runs: int = 4

    @model_validator(mode="after")
    def validate_production_secrets(self) -> Settings:
        """拒绝生产环境沿用开发签名配置，并检查任务并发上限。

        Returns:
            校验通过的配置对象，不修改已有配置值。

        Raises:
            ValueError: 生产环境签名配置未替换，或任务并发上限小于一。
        """
        if (
            self.environment == "production"
            and self.jwt_secret.get_secret_value()
            == "development-only-jwt-secret-do-not-use-in-production"
        ):
            raise ValueError("生产环境必须设置 GENESIS_JWT_SECRET")
        if (
            self.environment == "production"
            and self.agent_action_secret.get_secret_value()
            == "development-only-agent-action-secret"
        ):
            raise ValueError("生产环境必须设置 GENESIS_AGENT_ACTION_SECRET")
        if self.agent_max_concurrent_runs < 1:
            raise ValueError("GENESIS_AGENT_MAX_CONCURRENT_RUNS 必须大于 0")
        return self

    @property
    def resolved_database_url(self) -> str:
        """优先使用完整连接串，否则由独立字段组装 SQLAlchemy 地址。

        Returns:
            包含认证信息的连接字符串，只供数据库连接使用，不得输出或记录。
        """
        if self.database_url is not None:
            return self.database_url
        return URL.create(
            "postgresql+psycopg",
            username=self.database_user,
            password=self.database_password.get_secret_value(),
            host=self.database_host,
            port=self.database_port,
            database=self.database_name,
        ).render_as_string(hide_password=False)

    @property
    def resolved_postgres_uri(self) -> str:
        """转换为 psycopg 与 LangGraph checkpoint 接受的协议前缀。

        Returns:
            PostgreSQL 连接字符串，保留原认证信息，不得输出或记录。
        """
        return self.resolved_database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    """构建并缓存进程共享配置，调用方不应原地修改返回对象。

    Returns:
        通过配置校验的 Settings 实例。

    Raises:
        ValidationError: 配置字段或生产环境约束不符合契约。
    """
    return Settings()
