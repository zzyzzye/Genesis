from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
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
        """优先使用完整连接串，否则由独立字段安全地组装连接串。"""
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
        """返回 psycopg/LangGraph checkpoint 可直接使用的连接串。"""
        return self.resolved_database_url.replace("postgresql+psycopg://", "postgresql://", 1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
