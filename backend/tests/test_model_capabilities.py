"""验证能力来源优先级、未知值、上游长度解析与运行时输出预算。"""

import httpx
import pytest
from langchain_core.messages import HumanMessage
from pydantic import SecretStr, ValidationError

from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.core.config import Settings
from genesis_api.llm import capabilities
from genesis_api.llm.capabilities import CapabilitySupplement, model_capabilities_for
from genesis_api.llm.service import ModelDiscoveryService


def test_framework_fields_win_and_missing_fields_use_supplements(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """框架已有值（包括 False、空列表）不能被静态补充覆盖。"""
    monkeypatch.setattr(capabilities, "model_profile_for", lambda *_: {
        "max_input_tokens": 2000, "reasoning_effort_levels": [], "tool_calling": False,
    })
    monkeypatch.setattr(capabilities, "_supplements", lambda: {"mimo": {"custom":
        CapabilitySupplement(
            max_input_tokens=1000, max_output_tokens=500,
            reasoning_effort_levels=["high"], tool_calling=True,
        ),
    }})
    result = model_capabilities_for("mimo", "custom")
    assert result.profile["max_input_tokens"] == 2000
    assert result.profile["max_output_tokens"] == 500
    assert result.profile["reasoning_effort_levels"] == []
    assert result.profile["tool_calling"] is False


def test_unknown_models_stay_unknown_and_results_are_isolated() -> None:
    """未知别名不继承同系列能力，调用方修改结果不污染后续查询。"""
    assert model_capabilities_for("mimo", "mimo-v2.6-custom").profile == {}
    original = model_capabilities_for("openai", "gpt-5")
    original.profile["max_output_tokens"] = 1
    assert model_capabilities_for("openai", "gpt-5").profile["max_output_tokens"] != 1
    assert model_capabilities_for("mimo", "mimo-v2.6-flash").thinking_mode_default == "enabled"


def test_supplement_rejects_typos_and_invalid_limits() -> None:
    """静态配置拼错字段或写入无效容量时应明确失败。"""
    with pytest.raises(ValidationError):
        CapabilitySupplement.model_validate({"max_output_token": 1000})
    for limit in (0, -1, True):
        with pytest.raises(ValidationError):
            CapabilitySupplement.model_validate({"max_output_tokens": limit})


@pytest.mark.anyio
async def test_native_catalog_limits_and_mimo_fallback_are_exposed() -> None:
    """原生目录长度字段可用；目录失败也获得完整 MiMo 补充能力。"""
    settings = Settings(text_gemini_api_key=SecretStr("test"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"models": [{
            "name": "models/custom", "inputTokenLimit": 9000, "outputTokenLimit": 1000,
        }]}),
    )) as client:
        result = await ModelDiscoveryService(settings, client).list_models("gemini")
    custom = next(model for model in result.models if model.id == "custom")
    assert (custom.context_window, custom.max_output_tokens) == (9000, 1000)
    settings = Settings(text_mimo_api_key=SecretStr("test"), text_mimo_model="mimo-v2.6-flash")
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(503),
    )) as client:
        result = await ModelDiscoveryService(settings, client).list_models("mimo")
    model = result.models[0]
    assert (model.context_window, model.max_output_tokens) == (1_000_000, 128_000)
    assert model.reasoning_effort_levels == []
    assert model.thinking_modes == ["enabled", "disabled"]


@pytest.mark.parametrize("budget, expected", [(200000, 128000), (2048, 2048)])
def test_runtime_caps_output_budget_using_shared_capabilities(budget: int, expected: int) -> None:
    """实际序列化预算不能超过模型上限，也不能擅自提高用户配置预算。"""
    settings = Settings(text_mimo_api_key=SecretStr("test"), text_max_tokens=budget)
    model = EmbeddedAgentRuntime()._build_model(settings, "mimo", "mimo-v2.6-flash")
    payload = model._get_request_payload([HumanMessage("hi")])  # type: ignore[attr-defined]
    assert payload["max_completion_tokens"] == expected
    assert model.profile is not None
    assert model.profile["max_output_tokens"] == 128000


@pytest.mark.parametrize("name, levels", [
    ("grok-4.5", ["low", "medium", "high"]),
    ("grok-4.6", ["low", "medium", "high", "xhigh"]),
    ("grok-4.7", ["low", "medium", "high", "xhigh"]),
])
def test_documented_grok_effort_levels(name: str, levels: list[str]) -> None:
    """静态档位仅补框架缺失字段，Grok 的思考不能关闭。"""
    result = model_capabilities_for("grok", name)
    assert result.profile["reasoning_effort_levels"] == levels
    assert result.profile["reasoning_effort_default"] == "high"
    assert result.thinking_modes == []
