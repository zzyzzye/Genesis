"""读取 LangChain 随依赖提供的模型能力，不维护另一份模型档位表。"""

from functools import lru_cache
from typing import cast
from urllib.parse import urlparse

from langchain.chat_models import init_chat_model
from langchain_core.language_models.model_profile import ModelProfile


def model_provider_for(provider: str, base_url: str) -> str:
    """能力查询和实际调用使用相同适配器，避免网关与原生协议混用。"""
    if urlparse(base_url).hostname == "www.yyapi.cloud":
        return "openai"
    return {
        "openai": "openai", "grok": "xai", "gemini": "google_genai",
        "claude": "anthropic", "mimo": "openai",
    }[provider]


@lru_cache(maxsize=256)
def model_profile_for(adapter: str, model: str) -> ModelProfile:
    """仅构造客户端读取公开 profile，不发请求，也不读取真实凭据。"""
    client = init_chat_model(
        model=model, model_provider=adapter, api_key="profile-inspection-only",
    )
    return cast(ModelProfile, dict(client.profile or {}))
