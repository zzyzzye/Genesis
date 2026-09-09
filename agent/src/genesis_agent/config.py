from __future__ import annotations

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GENESIS_", extra="ignore")
    text_provider: str = "openai"
    text_openai_api_key: SecretStr | None = None
    text_openai_base_url: str = "https://api.openai.com/v1"
    text_openai_model: str | None = None
    text_grok_api_key: SecretStr | None = None
    text_grok_base_url: str = "https://api.x.ai/v1"
    text_grok_model: str | None = None
    text_gemini_api_key: SecretStr | None = None
    text_gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    text_gemini_model: str | None = None
    text_claude_api_key: SecretStr | None = None
    text_claude_base_url: str = "https://api.anthropic.com"
    text_claude_model: str | None = None
    text_temperature: float = 0.7
    text_max_tokens: int = 4096
    database_url: str = "postgresql+psycopg://genesis:genesis@postgres:5432/genesis"

@lru_cache
def get_settings() -> AgentSettings:
    return AgentSettings()
