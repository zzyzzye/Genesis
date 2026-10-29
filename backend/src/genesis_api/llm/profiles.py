"""读取 LangChain 原生 profile，并选择与能力来源分离的传输适配器。"""

from functools import lru_cache
from typing import cast
from urllib.parse import urlparse

from langchain_anthropic.chat_models import _get_default_model_profile as anthropic_profile
from langchain_core.language_models.model_profile import ModelProfile
from langchain_google_genai.chat_models import _get_default_model_profile as google_profile
from langchain_openai.chat_models.base import _get_default_model_profile as openai_profile
from langchain_xai.chat_models import _get_default_model_profile as xai_profile


def capability_provider_for(provider: str) -> str:
    """选择模型原生供应商的能力来源，不受网关地址影响。

    Args:
        provider: 项目供应商标识，不依据模型名称猜测归属。

    Returns:
        LangChain 原生适配器标识；MiMo 沿用已有 OpenAI 兼容实现。

    Raises:
        KeyError: 供应商标识不受支持。
    """
    return {
        "openai": "openai", "grok": "xai", "gemini": "google_genai",
        "claude": "anthropic", "mimo": "openai",
    }[provider]


def transport_provider_for(provider: str, base_url: str) -> str:
    """选择实际发送请求的 LangChain 协议适配器，不用于查询模型能力。

    Args:
        provider: 项目供应商标识，应已通过请求或配置校验。
        base_url: 上游基础地址，用于识别已支持的兼容网关。

    Returns:
        LangChain 供应商标识；Claude 保留原生协议，其他已识别的兼容通道使用 openai。

    Raises:
        KeyError: 原生调用的供应商标识不受支持。
    """
    if provider != "claude" and urlparse(base_url).hostname == "www.yyapi.cloud":
        return "openai"
    return capability_provider_for(provider)


@lru_cache(maxsize=2048)
def model_profile_for(adapter: str, model: str) -> ModelProfile:
    """复用框架的本地 profile 查询，不为目录中每个模型构造 HTTP 客户端。

    Args:
        adapter: 模型原生供应商的 LangChain 适配器标识，不是网关传输适配器。
        model: 模型名称，不自行转换未知别名。

    Returns:
        框架提供的能力字典，缺少 profile 时为空；按适配器与模型缓存。
        返回字典供只读查询，调用方不得修改共享缓存内容。
    """
    # 当前依赖的客户端本身也调用这些函数；升级时由一致性测试校验。
    lookup = {
        "openai": openai_profile, "anthropic": anthropic_profile,
        "google_genai": google_profile, "xai": xai_profile,
    }[adapter]
    return cast(ModelProfile, dict(lookup(model)))
