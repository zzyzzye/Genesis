"""读取 LangChain 随依赖提供的模型能力，不维护另一份模型档位表。"""

from functools import lru_cache
from typing import cast
from urllib.parse import urlparse

from langchain.chat_models import init_chat_model
from langchain_core.language_models.model_profile import ModelProfile


def thinking_modes_for(provider: str, model: str) -> list[str] | None:
    """补充框架尚未描述的 MiMo 思考开关，不推断其他模型或强度档位。

    框架 profile 目前不提供该开关，因此仅按官方文档增加最小补充：
    https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/text-generation/deep-thinking

    Args:
        provider: 模型所属供应商。
        model: 官方模型标识，未知别名不匹配。

    Returns:
        官方明确支持的开关值；其他模型返回 None。

    """
    if provider == "mimo" and model in {
        "mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed",
        "mimo-v2.5-pro", "mimo-v2.5",
    }:
        return ["enabled", "disabled"]
    return None


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
        LangChain 供应商标识；已识别的兼容网关统一使用 openai。

    Raises:
        KeyError: 原生调用的供应商标识不受支持。
    """
    if urlparse(base_url).hostname == "www.yyapi.cloud":
        return "openai"
    return capability_provider_for(provider)


@lru_cache(maxsize=256)
def model_profile_for(adapter: str, model: str) -> ModelProfile:
    """仅构造客户端读取公开 profile，不请求上游或使用真实凭据。

    Args:
        adapter: 模型原生供应商的 LangChain 适配器标识，不是网关传输适配器。
        model: 模型名称，不自行转换未知别名。

    Returns:
        框架提供的能力字典，缺少 profile 时为空；按适配器与模型缓存。
        返回字典供只读查询，调用方不得修改共享缓存内容。
    """
    client = init_chat_model(
        model=model, model_provider=adapter, api_key="profile-inspection-only",
    )
    return cast(ModelProfile, dict(client.profile or {}))
