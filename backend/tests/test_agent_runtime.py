from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import httpx
import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from pydantic import SecretStr

from genesis_api.agent import tools as agent_tools
from genesis_api.agent.prompt import AgentPrompt
from genesis_api.agent.runtime import (
    EmbeddedAgentRuntime,
    YyapiAsyncTransport,
    _message_text,
)
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.ai.service import AgentService
from genesis_api.core.config import Settings
from genesis_api.identity.models import UserRole


class FakeSession:
    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def scalars(self, _: object) -> list[SimpleNamespace]:
        return []


def test_prompt_and_message_text() -> None:
    assert "写入任务" in AgentPrompt.system_message()
    assert _message_text(AIMessage(content="回答")) == ["回答"]
    assert _message_text(AIMessageChunk(content="流式回答")) == ["流式回答"]
    assert _message_text(AIMessage(content=[{"type": "text", "text": "分块"}])) == ["分块"]
    assert _message_text(HumanMessage(content="问题")) == []
    assert _message_text(object()) == []


@pytest.mark.anyio
async def test_runtime_lifecycle_uses_postgres_checkpointer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    class FakeSaver:
        async def setup(self) -> None:
            events.append("setup")

    @asynccontextmanager
    async def fake_context(_: str) -> Any:
        events.append("enter")
        yield FakeSaver()
        events.append("exit")

    monkeypatch.setattr(
        "genesis_api.agent.runtime.AsyncPostgresSaver.from_conn_string", fake_context
    )
    runtime = EmbeddedAgentRuntime()
    await runtime.startup(Settings())
    await runtime.startup(Settings())
    await runtime.shutdown()
    assert events == ["enter", "setup", "exit"]


@pytest.mark.anyio
async def test_runtime_lifecycle_closes_failed_checkpointer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    class BrokenSaver:
        async def setup(self) -> None:
            raise RuntimeError("setup failed")

    @asynccontextmanager
    async def broken_context(_: str) -> Any:
        events.append("enter")
        try:
            yield BrokenSaver()
        finally:
            events.append("exit")

    monkeypatch.setattr(
        "genesis_api.agent.runtime.AsyncPostgresSaver.from_conn_string", broken_context
    )
    with pytest.raises(RuntimeError, match="setup failed"):
        await EmbeddedAgentRuntime().startup(Settings())
    assert events == ["enter", "exit"]


@pytest.mark.anyio
async def test_gateway_transport_filters_diagnostic_headers() -> None:
    captured: list[httpx.Request] = []

    class InnerTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            captured.append(request)
            return httpx.Response(200, request=request)

    transport = YyapiAsyncTransport()
    transport._transport = InnerTransport()  # type: ignore[assignment]
    request = httpx.Request(
        "GET", "https://example.com", headers={"x-stainless-test": "remove"}
    )
    response = await transport.handle_async_request(request)
    await transport.aclose()
    assert response.status_code == 200
    assert "x-stainless-test" not in captured[0].headers
    assert captured[0].headers["user-agent"] == "Genesis-Agent/0.1"


@pytest.mark.anyio
async def test_runtime_streams_only_ai_text_and_resumes_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor_id = uuid4()
    received_inputs: list[object] = []

    class FakeCheckpointer:
        async def aget_tuple(self, _: object) -> object:
            return object()

    class FakeGraph:
        async def astream(self, graph_input: object, **_: object) -> Any:
            received_inputs.append(graph_input)
            yield HumanMessage(content="忽略"), {}
            yield AIMessage(content="保留"), {}

    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, FakeCheckpointer())
    monkeypatch.setattr(runtime, "_graph", lambda *_: FakeGraph())
    settings = Settings(text_openai_api_key=SecretStr("test"), text_openai_model="model")
    request = AiChatRequest(
        surface="studio",
        messages=[AiMessage(role="user", content="测试")],
        actor_id=actor_id,
        actor_role="owner",
        resume_from_checkpoint=True,
    )

    assert [item async for item in runtime.stream(request, settings, thread_id="thread")] == [
        "保留"
    ]
    assert received_inputs == [None]

    service = AgentService(settings, runtime)
    assert [item async for item in service.stream(request, thread_id="thread")] == ["保留"]


@pytest.mark.anyio
async def test_runtime_validates_context_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = EmbeddedAgentRuntime()
    request = AiChatRequest(
        surface="studio", messages=[AiMessage(role="user", content="测试")]
    )
    with pytest.raises(RuntimeError, match="用户上下文"):
        _ = [item async for item in runtime.stream(request, Settings(), thread_id="thread")]

    with pytest.raises(ValueError, match="不支持"):
        runtime._model_config(Settings(), "unknown")

    runtime._checkpointer = cast(Any, object())
    with pytest.raises(RuntimeError, match="API Key"):
        runtime._build_model(Settings(text_openai_api_key=None), "openai", "model")

    sentinel = cast(Any, object())
    calls: list[dict[str, object]] = []

    def fake_init_chat_model(**kwargs: object) -> object:
        calls.append(kwargs)
        return sentinel

    monkeypatch.setattr(
        "genesis_api.agent.runtime.init_chat_model",
        fake_init_chat_model,
    )
    direct_settings = Settings(text_openai_api_key=SecretStr("x" * 32))
    assert runtime._build_model(direct_settings, "openai", "model") is sentinel
    assert calls[-1]["base_url"] == direct_settings.text_openai_base_url

    gateway_settings = Settings(
        text_openai_api_key=SecretStr("x" * 32),
        text_openai_base_url="https://www.yyapi.cloud/",
    )
    assert runtime._build_model(gateway_settings, "openai", "model") is sentinel
    assert calls[-1]["base_url"] == "https://www.yyapi.cloud/v1"
    client = cast(httpx.AsyncClient, calls[-1]["http_async_client"])
    await client.aclose()

    assert runtime._model_config(Settings(), "grok")[0] == "xai"
    assert runtime._model_config(Settings(), "gemini")[0] == "google_genai"
    assert runtime._model_config(Settings(), "claude")[0] == "anthropic"


def test_runtime_builds_and_caches_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = EmbeddedAgentRuntime()
    with pytest.raises(RuntimeError, match="尚未初始化"):
        runtime._graph(Settings(), "openai", "model")

    runtime._checkpointer = cast(Any, object())
    sentinel = object()
    monkeypatch.setattr(runtime, "_build_model", lambda *_: cast(Any, object()))
    monkeypatch.setattr("genesis_api.agent.runtime.build_blog_tools", lambda *_: [])
    monkeypatch.setattr("genesis_api.agent.runtime.create_deep_agent", lambda **_: sentinel)
    assert runtime._graph(Settings(), "openai", "model") is sentinel
    assert runtime._graph(Settings(), "openai", "model") is sentinel


@pytest.mark.anyio
async def test_blog_tools_keep_invocation_context_isolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = uuid4()
    second = uuid4()

    async def observe(actor_id: object) -> tuple[object, object]:
        with agent_tools.agent_invocation_context(cast(Any, actor_id), "owner"):
            before = agent_tools._owner_id()
            await asyncio.sleep(0)
            return before, agent_tools._owner_id()

    observed = await asyncio.gather(observe(first), observe(second))
    assert observed[0] == (first, first)
    assert observed[1] == (second, second)
    with pytest.raises(RuntimeError, match="所有者"):
        agent_tools._owner_id()

    post = SimpleNamespace(
        id=uuid4(),
        title="标题",
        excerpt="摘要",
        status=SimpleNamespace(value="draft"),
        updated_at=SimpleNamespace(isoformat=lambda: "2026-09-22T00:00:00+00:00"),
        category=None,
        tags=[],
        content_markdown="# 正文",
        slug="post",
    )
    monkeypatch.setattr(agent_tools, "SessionLocal", FakeSession)
    monkeypatch.setattr(agent_tools, "list_admin_posts", lambda _: [post])
    monkeypatch.setattr(agent_tools, "get_blog_post_by_id", lambda *_: post)
    monkeypatch.setattr(agent_tools, "get_settings", lambda: Settings())

    with agent_tools.agent_invocation_context(first, UserRole.OWNER.value):
        assert "标题" in agent_tools._list_posts()
        assert "正文" in agent_tools._get_post(str(post.id))
        assert agent_tools._search_posts("标题") == "[]"
        with pytest.raises(ValueError, match="post_id"):
            agent_tools._get_post("bad-id")

        proposal = json.loads(
            agent_tools._preview(
                "create_draft",
                {"title": "新文章", "excerpt": "摘要", "content_markdown": "正文", "slug": "new"},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )
        )
        assert proposal["type"] == "pending_action"
        assert proposal["action"] == "create_draft"
        update = json.loads(
            agent_tools._preview(
                "update_post",
                {"post_id": str(post.id), "changes": "{}"},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )
        )
        assert update["action"] == "update_post"
        with pytest.raises(ValueError, match="必要字段"):
            agent_tools._preview(
                "create_draft",
                {"title": "缺少其他字段"},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )

        monkeypatch.setattr(agent_tools, "get_blog_post_by_id", lambda *_: None)
        with pytest.raises(ValueError, match="文章不存在"):
            agent_tools._get_post(str(post.id))
        with pytest.raises(ValueError, match="文章不存在"):
            agent_tools._preview(
                "delete_post",
                {"post_id": str(post.id)},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )
        with pytest.raises(ValueError, match="post_id"):
            agent_tools._preview(
                "delete_post",
                {"post_id": "bad"},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )


@pytest.mark.anyio
async def test_built_tools_delegate_without_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_tools, "_list_posts", lambda: "list")
    monkeypatch.setattr(agent_tools, "_get_post", lambda post_id: f"post:{post_id}")
    monkeypatch.setattr(agent_tools, "_search_posts", lambda query: f"search:{query}")
    monkeypatch.setattr(agent_tools, "_preview", lambda action, payload, settings: action)
    tools = {item.name: item for item in agent_tools.build_blog_tools(Settings())}

    assert await tools["list_posts"].ainvoke({}) == "list"
    assert await tools["get_post"].ainvoke({"post_id": "1"}) == "post:1"
    assert await tools["search_posts"].ainvoke({"query": "q"}) == "search:q"
    assert await tools["analyze_post"].ainvoke({"post_id": "2"}) == "post:2"
    assert await tools["suggest_revision"].ainvoke({"post_id": "3"}) == "post:3"
    assert await tools["create_draft"].ainvoke(
        {"title": "t", "excerpt": "e", "content_markdown": "c", "slug": "s"}
    ) == "create_draft"
    assert await tools["update_post"].ainvoke({"post_id": "1", "changes": "{}"}) == "update_post"
    assert await tools["delete_post"].ainvoke({"post_id": "1"}) == "delete_post"
    assert await tools["publish_post"].ainvoke({"post_id": "1"}) == "publish_post"
