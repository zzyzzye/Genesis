"""模型上下文容量的展示回退表，不代表上游服务的实时额度或能力。"""

from __future__ import annotations

from collections.abc import Mapping

from genesis_api.llm.models import ProviderName

# 仅维护已核实的精确模型 ID；网关别名和自动路由模型不猜测上下文长度。
MODEL_CONTEXT_WINDOWS: Mapping[ProviderName, Mapping[str, int]] = {
    "openai": {
        "gpt-5.5": 1_050_000,
        "gpt-5.6-luna": 1_050_000,
        "gpt-5.6-sol": 1_050_000,
        "gpt-5.6-terra": 1_050_000,
        "gpt-6-astra": 1_050_000,
    },
    "grok": {},
    "mimo": {},
    "gemini": {
        "gemini-2.5-flash": 1_048_576,
        "gemini-2.5-pro": 1_048_576,
        "gemini-3.1-pro-preview": 1_048_576,
        "gemini-3.6-flash": 1_048_576,
        "gemini-3.7-flash": 1_048_576,
        "gemini-3.8-flash": 1_048_576,
        "gemini-3-flash": 1_048_576,
        "gemini-3-pro-preview": 1_048_576,
    },
    "claude": {
        "claude-sonnet-4-6": 1_000_000,
        "claude-opus-4-6": 1_000_000,
        "claude-opus-4-7": 1_000_000,
        "claude-opus-4-8": 1_000_000,
        "claude-opus-5": 1_000_000,
        "claude-fable-5": 1_000_000,
        "claude-sonnet-5": 1_000_000,
    },
}


def context_window_for(provider: ProviderName, model_id: str) -> int | None:
    """查询已知模型的上下文容量，不根据模型名称猜测未知别名。

    Args:
        provider: 已校验的供应商标识。
        model_id: 上游目录中的模型 ID。

    Returns:
        已知容量，单位为 token；未知模型返回 None，仅用于界面展示回退。
    """
    return MODEL_CONTEXT_WINDOWS[provider].get(model_id)
