"""统一合并框架模型能力与集中维护的缺失项，供目录和运行时共用。"""

import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Literal, cast

from langchain_core.language_models.model_profile import ModelProfile
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from genesis_api.llm.profiles import capability_provider_for, model_profile_for


class CapabilitySupplement(BaseModel):
    """静态补充契约；未填写与明确不支持（空列表）含义不同。"""

    model_config = ConfigDict(extra="forbid", strict=True)

    max_input_tokens: int | None = Field(default=None, gt=0)
    max_output_tokens: int | None = Field(default=None, gt=0)
    reasoning_effort_levels: list[str] | None = None
    reasoning_effort_default: str | None = None
    thinking_modes: list[Literal["enabled", "disabled"]] | None = None
    thinking_mode_default: Literal["enabled", "disabled"] | None = None
    reasoning_output: bool | None = None
    tool_calling: bool | None = None
    structured_output: bool | None = None


class ModelCapabilities(BaseModel):
    """统一能力结果；profile 原样交给框架，额外开关仅由协议适配处理。"""

    profile: ModelProfile
    thinking_modes: list[Literal["enabled", "disabled"]] | None = None
    thinking_mode_default: Literal["enabled", "disabled"] | None = None


@lru_cache(maxsize=1)
def _supplements() -> dict[str, dict[str, CapabilitySupplement]]:
    """加载并校验集中配置；配置错误立即报错，不静默猜测能力。"""
    path = Path(__file__).with_name("capability_supplements.toml")
    with path.open("rb") as source:
        return TypeAdapter(dict[str, dict[str, CapabilitySupplement]]).validate_python(
            tomllib.load(source)
        )


def model_capabilities_for(provider: str, model: str) -> ModelCapabilities:
    """返回指定模型的能力，新建结果避免调用者修改框架缓存。

    Args:
        provider: 模型原生供应商，与网关传输协议无关。
        model: 精确模型 ID；未知模型不做模糊匹配。

    Returns:
        框架字段优先、静态配置仅填补缺失字段的统一能力；未知字段保持缺失。
        框架输入上限用于 context_window 展示，不另行推算总窗口。
    """
    supplement = _supplements().get(provider, {}).get(model, CapabilitySupplement())
    fallback = supplement.model_dump(
        exclude_none=True, exclude={"thinking_modes", "thinking_mode_default"}
    )
    native = model_profile_for(capability_provider_for(provider), model)
    profile = cast(ModelProfile, fallback | {
        key: value for key, value in native.items() if value is not None
    })
    return ModelCapabilities(
        profile=profile,
        thinking_modes=supplement.thinking_modes,
        thinking_mode_default=supplement.thinking_mode_default,
    )
