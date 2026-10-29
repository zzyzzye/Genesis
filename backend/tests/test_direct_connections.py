"""验证模型与价格客户端直连，不连接真实供应商。"""

from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import SecretStr

from genesis_api.agent.google_transport import DirectGoogleTransport
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.billing.pricing import YyapiPricingService
from genesis_api.core.config import Settings


@pytest.mark.anyio
async def test_native_gemini_uses_direct_httpx_for_sync_and_async() -> None:
    runtime = EmbeddedAgentRuntime()
    model = runtime._build_model(Settings(
        text_gemini_api_key=SecretStr("synthetic-direct-test"),
        text_gemini_base_url="https://generativelanguage.googleapis.com",
    ), "gemini", "gemini-2.5-flash")
    assert isinstance(model, ChatGoogleGenerativeAI)
    assert model.client_args is not None
    assert model.client_args["trust_env"] is False
    assert isinstance(model.client_args["transport"], DirectGoogleTransport)
    assert model.client is not None
    client = model.client
    try:
        # 验证实际 SDK 路径，防止依赖升级后又回到默认读取代理的 aiohttp。
        api: Any = client._api_client
        assert not api._use_aiohttp()
        assert api._httpx_client._trust_env is False
        assert api._async_httpx_client._trust_env is False
        assert api._httpx_client._transport is model.client_args["transport"]
        assert api._async_httpx_client._transport is model.client_args["transport"]
    finally:
        client.close()
        await client.aio.aclose()
        await runtime.shutdown()


@pytest.mark.anyio
async def test_google_transport_delegates_both_interfaces(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(httpx, "HTTPTransport", lambda **_: httpx.MockTransport(handle))
    monkeypatch.setattr(httpx, "AsyncHTTPTransport", lambda **_: httpx.MockTransport(handle))
    transport = DirectGoogleTransport()
    with httpx.Client(transport=transport, trust_env=False) as sync:
        assert sync.get("https://synthetic.invalid/sync").status_code == 200
    async with httpx.AsyncClient(transport=transport, trust_env=False) as asynchronous:
        assert (await asynchronous.get("https://synthetic.invalid/async")).status_code == 200
    assert requests == ["/sync", "/async"]


@pytest.mark.anyio
async def test_pricing_client_has_no_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    options: list[dict[str, Any]] = []
    original = httpx.AsyncClient

    def make_client(**kwargs: Any) -> httpx.AsyncClient:
        options.append(kwargs)
        return original(**kwargs)

    service = YyapiPricingService()
    monkeypatch.setattr(service, "_load", AsyncMock())
    monkeypatch.setattr(httpx, "AsyncClient", make_client)
    await service.catalog(Settings(yyapi_access_token=SecretStr("synthetic-pricing-test")))
    assert len(options) == 1
    assert options[0]["trust_env"] is False
    assert "proxy" not in options[0]
    assert "yyapi_proxy_url" not in Settings.model_fields
