from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ProviderName = Literal["openai", "grok", "gemini", "claude"]


class AvailableModel(BaseModel):
    id: str
    name: str | None = None
    created: int | None = None
    context_window: int | None = None


class ProviderModels(BaseModel):
    provider: ProviderName
    models: list[AvailableModel]
