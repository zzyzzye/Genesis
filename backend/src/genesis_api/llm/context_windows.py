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
    return MODEL_CONTEXT_WINDOWS[provider].get(model_id)
