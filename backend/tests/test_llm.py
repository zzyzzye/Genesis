from __future__ import annotations

import httpx
import pytest
from pydantic import SecretStr

from genesis_api.core.config import Settings
from genesis_api.llm.models import AvailableModel
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
    assert result.models[0] == AvailableModel(
        id="gpt-5.6-luna",
        name="gpt-5.6-luna",
        context_window=1_050_000,
    )
    assert result.models[1].id == "custom-model"


@pytest.mark.anyio
async def test_list_grok_models_uses_configured_root_base_url() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "grok-test"}]})

    settings = Settings(
        text_grok_api_key=SecretStr("grok-test-key"),
        text_grok_base_url="https://gateway.example/",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("grok")

    assert str(requests[0].url) == "https://gateway.example/models"
    assert result.models[0].id == "grok-test"


@pytest.mark.anyio
async def test_list_models_uses_yyapi_v1_catalog_without_changing_provider_base_url() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "grok-4"}]})

    settings = Settings(
        text_grok_api_key=SecretStr("grok-test-key"),
        text_grok_base_url="https://www.yyapi.cloud",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("grok")

    assert str(requests[0].url) == "https://www.yyapi.cloud/v1/models"
    assert result.models[0].id == "grok-4"


@pytest.mark.anyio
async def test_list_gemini_models_uses_openai_compatible_url_without_appending_v1() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "gemini-2.5-flash"}]})

    settings = Settings(
        text_gemini_api_key=SecretStr("gemini-test-key"),
        text_gemini_base_url="https://generativelanguage.googleapis.com/v1beta/openai",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("gemini")

    assert str(requests[0].url) == "https://generativelanguage.googleapis.com/v1beta/openai/models"
    assert result.models[0].id == "gemini-2.5-flash"


@pytest.mark.anyio
async def test_list_gemini_models_accepts_native_name_field() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": "models/gemini-2.5-flash"}]})

    settings = Settings(
        text_gemini_api_key=SecretStr("gemini-test-key"),
        text_gemini_base_url="https://gateway.example/",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("gemini")

    assert result.models[0].id == "gemini-2.5-flash"


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
        text_claude_model=None,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("claude")

    assert str(requests[0].url) == "https://gateway.example/v1/models"
    assert requests[0].headers["x-api-key"] == "claude-test-key"
    assert requests[0].headers["anthropic-version"] == "2023-06-01"
    assert result.models[0].name == "Claude Test"


@pytest.mark.anyio
async def test_list_models_enriches_known_model_with_maintained_context_window() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "gemini-3.8-flash"}]})

    settings = Settings(
        text_gemini_api_key=SecretStr("gemini-test-key"),
        text_gemini_base_url="https://gateway.example/",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("gemini")

    assert result.models[0].context_window == 1_048_576


@pytest.mark.anyio
async def test_list_models_keeps_unknown_model_context_window_empty() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "gateway-alias"}]})

    settings = Settings(
        text_openai_api_key=SecretStr("openai-test-key"),
        text_openai_base_url="https://gateway.example/v1",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("openai")

    assert result.models[-1].id == "gateway-alias"
    assert result.models[-1].context_window is None


@pytest.mark.anyio
async def test_list_models_requires_provider_key() -> None:
    service = ModelDiscoveryService(Settings(text_grok_api_key=SecretStr("")))

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


@pytest.mark.anyio
async def test_list_models_falls_back_to_configured_model_when_gateway_blocks_discovery() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "/web-access-denied"})

    settings = Settings(
        text_grok_api_key=SecretStr("grok-test-key"),
        text_grok_base_url="https://gateway.example/",
        text_grok_model="grok-4",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("grok")

    assert result.models == [
        AvailableModel(id="grok-4", name="grok-4", context_window=None)
    ]


@pytest.mark.anyio
async def test_list_models_uses_default_model_when_upstream_is_unavailable(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="upstream unavailable")

    api_key = "test-key-must-not-appear-in-logs"
    settings = Settings(text_openai_api_key=SecretStr(api_key))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await ModelDiscoveryService(settings, client).list_models("openai")

    assert result.models == [
        AvailableModel(
            id="gpt-5.6-luna",
            name="gpt-5.6-luna",
            context_window=1_050_000,
        )
    ]
    assert (
        "模型列表发现不可用，使用已配置的模型：provider=openai，error=HTTPStatusError"
        in caplog.text
    )
    assert api_key not in caplog.text
