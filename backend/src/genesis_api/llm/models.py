"""模型目录响应契约，能力未知的字段允许为空。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

ProviderName = Literal["openai", "grok", "gemini", "claude", "mimo"]


class AvailableModel(BaseModel):
    """可选模型及统一能力元数据；数值限制单位为 token，未知字段为空。"""

    id: str
    name: str | None = None
    created: int | None = None
    context_window: int | None = None
    max_output_tokens: int | None = None
    # 缺少能力信息时不猜测档位，前端只提供默认设置。
    reasoning_effort_levels: list[str] | None = None
    reasoning_effort_default: str | None = None
    thinking_modes: list[str] | None = None
    thinking_mode_default: str | None = None


class ProviderModels(BaseModel):
    """按供应商分组的模型列表，不包含认证配置。"""

    provider: ProviderName
    models: list[AvailableModel]
