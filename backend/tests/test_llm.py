from __future__ import annotations

import httpx
import pytest
from pydantic import SecretStr

from genesis_api.core.config import Settings
from genesis_api.llm.service import ModelDiscoveryError, ModelDiscoveryService


@pytest.mark.anyio
async def test_list_openai_models_uses_configured_url_and_bearer_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"data": [{"id": "custom-model", "owned_by": "test"}]},
        )

    settings = Settings(
        text_openai_api_key=SecretStr("openai-test-key"),
        text_openai_base_url="https://gateway.example/v1",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("openai")

    assert str(requests[0].url) == "https://gateway.example/v1/models"
    assert requests[0].headers["authorization"] == "Bearer openai-test-key"
    assert result.models[0].id == "custom-model"


@pytest.mark.anyio
async def test_list_claude_models_supports_base_url_with_v1() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, json={"data": [{"id": "claude-test", "display_name": "Claude Test"}]}
        )

    settings = Settings(
        text_claude_api_key=SecretStr("claude-test-key"),
        text_claude_base_url="https://gateway.example/v1",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("claude")

    assert str(requests[0].url) == "https://gateway.example/v1/models"
    assert requests[0].headers["x-api-key"] == "claude-test-key"
    assert requests[0].headers["anthropic-version"] == "2023-06-01"
    assert result.models[0].name == "Claude Test"


@pytest.mark.anyio
async def test_list_models_requires_provider_key() -> None:
    service = ModelDiscoveryService(Settings())

    with pytest.raises(ModelDiscoveryError, match="未配置 grok 的 API Key"):
        await service.list_models("grok")


@pytest.mark.anyio
async def test_list_models_rejects_invalid_response() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"id": "not-a-list"}})

    settings = Settings(text_grok_api_key=SecretStr("grok-test-key"))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ModelDiscoveryError, match="响应格式无效"):
            await ModelDiscoveryService(settings, client).list_models("grok")
