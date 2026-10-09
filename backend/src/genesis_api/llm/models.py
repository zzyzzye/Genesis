from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ProviderName = Literal["openai", "grok", "gemini", "claude", "mimo"]


class AvailableModel(BaseModel):
    id: str
    name: str | None = None
    created: int | None = None
    context_window: int | None = None
    # 缺少能力信息时不猜测档位，前端只提供默认设置。
    reasoning_effort_levels: list[str] | None = None
    reasoning_effort_default: str | None = None


class ProviderModels(BaseModel):
    provider: ProviderName
    models: list[AvailableModel]
