"""验证 MiMo 思考内容的保留、模型发现回退与兼容聊天接口。"""

import json

import httpx
import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage, ToolMessage
from pydantic import SecretStr

from genesis_api.agent.mimo import ChatMiMo
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.ai.runs import _configured_model
from genesis_api.ai.schemas import AiChatRequest
from genesis_api.core.config import Settings
from genesis_api.llm.capabilities import model_capabilities_for
from genesis_api.llm.service import ModelDiscoveryService


def test_thinking_switch_scope_is_limited_to_documented_mimo_models() -> None:
    """官方开关范围不扩展到未知名称、语音模型或其他供应商。"""
    for name in (
        "mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed",
        "mimo-v2.5-pro", "mimo-v2.5",
    ):
        assert model_capabilities_for("mimo", name).thinking_modes == ["enabled", "disabled"]
    assert model_capabilities_for("mimo", "mimo-v2.5-tts").thinking_modes is None
    assert model_capabilities_for("mimo", "unknown").thinking_modes is None
    assert model_capabilities_for("openai", "mimo-v2.6-flash").thinking_modes is None


@pytest.mark.parametrize("mode", [None, "enabled", "disabled"])
def test_mimo_thinking_switch_uses_extra_body(mode: str | None) -> None:
    """思考开关独立序列化，默认不发送，显式关闭时才使用配置温度。"""
    settings = Settings(text_mimo_api_key=SecretStr("test-placeholder"))
    model = EmbeddedAgentRuntime()._build_model(
        settings, "mimo", "mimo-v2.6-flash", thinking_mode=mode
    )
    assert isinstance(model, ChatMiMo)
    payload = model._get_request_payload([HumanMessage("hi")])
    assert "reasoning_effort" not in payload
    if mode:
        assert payload["extra_body"] == {"thinking": {"type": mode}}
    else:
        assert not payload.get("extra_body")
    assert ("temperature" in payload) == (mode == "disabled")
    with pytest.raises(RuntimeError, match="思考开关"):
        EmbeddedAgentRuntime()._build_model(
            settings, "mimo", "unknown", thinking_mode="enabled"
        )


def test_thinking_switch_survives_request_persistence_and_graph_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """后台恢复保留思考开关，不同开关不能复用同一张图。"""
    from typing import Any, cast

    from genesis_api.ai.runs import _request_from_payload, _request_payload

    request = AiChatRequest(
        surface="studio", provider="mimo", thinking_mode="disabled",
        messages=[{"role": "user", "content": "hi"}],
    )
    assert _request_from_payload(_request_payload(request)).thinking_mode == "disabled"
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, object())
    monkeypatch.setattr(runtime, "_build_model", lambda *_: object())
    monkeypatch.setattr("genesis_api.agent.runtime.create_deep_agent", lambda **_: object())
    settings = Settings()
    enabled = runtime._graph(settings, "mimo", "mimo-v2.6-flash", "blog", None, "enabled")
    assert runtime._graph(
        settings, "mimo", "mimo-v2.6-flash", "blog", None, "enabled"
    ) is enabled
    assert runtime._graph(
        settings, "mimo", "mimo-v2.6-flash", "blog", None, "disabled"
    ) is not enabled


def test_mimo_configuration_and_reasoning_roundtrip() -> None:
    settings = Settings(text_provider="mimo", text_mimo_api_key=SecretStr("test-placeholder"))
    model = EmbeddedAgentRuntime()._build_model(settings, "mimo", settings.text_mimo_model)
    assert isinstance(model, ChatMiMo)
    assert model.openai_api_base == "https://api.xiaomimimo.com/v1"
    assert model.use_responses_api is False
    assert model.default_headers == {"api-key": "test-placeholder"}
    assert _configured_model(settings, "mimo") == settings.text_mimo_model
    AiChatRequest(surface="studio", provider="mimo", messages=[{"role": "user", "content": "hi"}])
    chunks = []
    for delta in [
        {"role": "assistant", "reasoning_content": "先"},
        {"reasoning_content": "查文章"},
        {
            "tool_calls": [
                {
                    "index": 0,
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "list_posts", "arguments": "{}"},
                }
            ]
        },
    ]:
        chunk = model._convert_chunk_to_generation_chunk(
            {"choices": [{"delta": delta}]}, AIMessageChunk, None
        )
        assert chunk is not None
        chunks.append(chunk.message)
    merged = chunks[0] + chunks[1] + chunks[2]
    payload = model._get_request_payload(
        [
            HumanMessage("查看文章"),
            merged,
            ToolMessage(content="[]", tool_call_id="call_1"),
        ]
    )
    assert payload["messages"][1]["reasoning_content"] == "先查文章"
    assert payload["messages"][1]["tool_calls"][0]["function"]["name"] == "list_posts"
    result = model._create_chat_result(
        {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "完成",
                        "reasoning_content": "已检查",
                    },
                    "finish_reason": "stop",
                }
            ],
        }
    )
    assert result.generations[0].message.additional_kwargs["reasoning_content"] == "已检查"


@pytest.mark.anyio
@pytest.mark.parametrize("status", [200, 404])
async def test_mimo_discovery_and_fallback(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.xiaomimimo.com/v1/models"
        assert request.headers["api-key"] == "test-placeholder"
        return httpx.Response(status, json={"data": [
            {"id": "mimo-v2.6-flash"}, {"id": "mimo-v2.5-tts"}, {"id": "mimo-v2.5-asr"},
        ]})

    settings = Settings(text_mimo_api_key=SecretStr("test-placeholder"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("mimo")
    assert result.models[0].id == "mimo-v2.6-flash"
    assert len(result.models) == 1


@pytest.mark.anyio
async def test_mimo_stream_uses_chat_completions() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["api-key"] == "test-placeholder"
        assert json.loads(request.content)["stream"] is True
        events = [
            {
                "choices": [
                    {"index": 0, "delta": {"role": "assistant", "reasoning_content": "思考"}}
                ]
            },
            {"choices": [{"index": 0, "delta": {"content": "你好"}, "finish_reason": "stop"}]},
        ]
        body = "".join(f"data: {json.dumps(event)}\n\n" for event in events) + "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = ChatMiMo(
            model="mimo-v2.6-flash",
            api_key=SecretStr("test-placeholder"),
            base_url="https://api.xiaomimimo.com/v1",
            use_responses_api=False,
            default_headers={"api-key": "test-placeholder"},
            http_async_client=client,
        )
        chunks = [chunk async for chunk in model.astream("你好")]
    assert "".join(str(chunk.content) for chunk in chunks) == "你好"
    assert any(chunk.additional_kwargs.get("reasoning_content") == "思考" for chunk in chunks)
