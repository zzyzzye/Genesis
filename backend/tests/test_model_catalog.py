"""验证目录按渠道复用、并发合并、过期恢复与权限隔离。"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from langchain.chat_models import init_chat_model
from pydantic import SecretStr

from genesis_api.api.routes import llm
from genesis_api.billing.pricing import yyapi_pricing_service
from genesis_api.core.config import Settings
from genesis_api.identity.models import User, UserRole
from genesis_api.llm import catalog
from genesis_api.llm import service as discovery_service
from genesis_api.llm.catalog import ModelCatalog
from genesis_api.llm.models import AvailableModel, ProviderModels
from genesis_api.llm.profiles import model_profile_for
from genesis_api.llm.service import ModelDiscoveryService
from genesis_api.media import image, video


@pytest.mark.anyio
async def test_channel_cache_coalesces_requests_and_returns_independent_copies() -> None:
    """多个调用方共用一次请求，大小写与默认 Accept 不影响渠道身份。"""
    cache = ModelCatalog()
    calls = 0
    entered, release = asyncio.Event(), asyncio.Event()

    async def respond(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        entered.set()
        await release.wait()
        return httpx.Response(200, json={"data": [{"id": "test-model"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        first = asyncio.create_task(cache.get(
            "https://test.invalid/v1/models", {"Authorization": "Bearer synthetic-a"},
            client=client,
        ))
        await entered.wait()
        second = asyncio.create_task(cache.get(
            "https://test.invalid/v1/models",
            {"authorization": "Bearer synthetic-a", "accept": "application/json"},
            client=client, refresh=True,
        ))
        await asyncio.sleep(0)
        release.set()
        a, b = await asyncio.gather(first, second)
        a["data"].clear()
        assert b["data"] == [{"id": "test-model"}]
        await cache.get("https://test.invalid/v1/models", {
            "Authorization": "Bearer synthetic-a",
        }, client=client)
        assert calls == 1
        await cache.get("https://test.invalid/v1/models", {
            "Authorization": "Bearer synthetic-b",
        }, client=client)
        await cache.get("https://other.invalid/v1/models", {
            "Authorization": "Bearer synthetic-a",
        }, client=client)
        await cache.get("https://test.invalid/v1/models", {
            "x-api-key": "synthetic-a", "anthropic-version": "2023-06-01",
        }, client=client)
        assert calls == 4


@pytest.mark.anyio
async def test_stale_cache_is_bounded_and_auth_failure_evicts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """刷新失败保留近期成功目录并退避；过期或撤销认证不能无限沿用旧值。"""
    cache = ModelCatalog()
    now, code, calls = 0.0, 200, 0
    monkeypatch.setattr(catalog, "monotonic", lambda: now)

    def respond(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(code, json={"data": [{"id": "cached"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        async def get(refresh: bool = False) -> dict[str, object]:
            return await cache.get(
                "https://test.invalid/models", {}, client=client, refresh=refresh,
            )

        assert (await get())["data"]
        now = 12 * 60 * 60 - 1
        assert (await get())["data"]
        assert calls == 1
        now, code = 12 * 60 * 60, 503
        assert (await get())["data"]
        assert (await get())["data"]
        assert calls == 2
        now = 12 * 60 * 60 + 30 * 60
        with pytest.raises(httpx.HTTPStatusError):
            await get()
        code = 200
        await get(True)
        code = 401
        with pytest.raises(httpx.HTTPStatusError):
            await get(True)
        assert not cache.entries


@pytest.mark.anyio
async def test_invalid_payload_is_not_cached() -> None:
    cache = ModelCatalog()
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"data": "invalid"}),
    )) as client:
        with pytest.raises(ValueError, match="格式无效"):
            await cache.get("https://test.invalid/models", {}, client=client)
    assert not cache.entries


@pytest.mark.anyio
async def test_text_image_video_share_the_same_upstream_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = ModelCatalog()
    for module in (discovery_service, image, video):
        monkeypatch.setattr(module, "model_catalog", cache)
    settings = Settings(
        text_openai_base_url="https://shared.invalid/v1",
        image_api_base_url="https://shared.invalid", video_api_base_url="https://shared.invalid",
        text_openai_api_key=SecretStr("synthetic-shared"),
        image_api_key=SecretStr("synthetic-shared"), video_api_key=SecretStr("synthetic-shared"),
    )
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        return httpx.Response(200, json={"data": [{"id": "shared-model"}]})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs,
    ))
    text_models, images, videos = await asyncio.gather(
        ModelDiscoveryService(settings).list_models("openai"),
        image.available_models(settings), video.available_models(settings),
    )
    assert any(model.id == "shared-model" for model in text_models.models)
    assert images == [{"id": "shared-model", "image_edit": False}]
    assert videos == ["shared-model"]
    assert requests == ["/v1/models"]


@pytest.mark.anyio
async def test_catalog_response_does_not_wait_for_pricing(monkeypatch: pytest.MonkeyPatch) -> None:
    discovery = AsyncMock(return_value=ProviderModels(
        provider="openai", models=[AvailableModel(id="test-model")],
    ))
    prices = AsyncMock(side_effect=AssertionError("首次目录请求不应同步价格"))
    monkeypatch.setattr(ModelDiscoveryService, "list_models", discovery)
    monkeypatch.setattr(yyapi_pricing_service, "for_models", prices)
    user = User(id=uuid4(), handle="test", display_name="测试", role=UserRole.OWNER)
    result = await llm.list_provider_models(
        "openai", user, Settings(), MagicMock(), include_pricing=False,
    )
    assert result.models[0].id == "test-model"
    assert result.models[0].billing_mode == "platform"
    prices.assert_not_called()


@pytest.mark.parametrize(("adapter", "model"), [
    ("openai", "gpt-5"), ("anthropic", "claude-sonnet-4-5"),
    ("google_genai", "gemini-2.5-flash"), ("xai", "grok-4"),
    ("openai", "unknown-model"),
])
def test_lightweight_profile_matches_framework_client(adapter: str, model: str) -> None:
    """依赖升级时确保轻量查询与框架客户端原生能力保持一致。"""
    client = init_chat_model(model=model, model_provider=adapter, api_key="synthetic-profile-test")
    assert model_profile_for(adapter, model) == (client.profile or {})
