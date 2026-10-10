"""验证 Agent 生命周期、模型适配、图缓存与工具身份隔离，不请求真实模型。"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import httpx
import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from pydantic import SecretStr

from genesis_api.agent.context import agent_invocation_context
from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.agent.runtime import (
    EmbeddedAgentRuntime,
    YyapiAsyncTransport,
    _message_text,
)
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.ai.service import AgentService
from genesis_api.blog.agent import tools as agent_tools
from genesis_api.blog.agent.prompt import BlogAgentPrompt
from genesis_api.core.config import Settings
from genesis_api.identity.models import UserRole


class FakeSession:
    """提供工具构建所需的最小会话接口，不连接数据库。"""

    def __enter__(self) -> FakeSession:
        """进入测试会话，返回同一个替身。"""
        return self

    def __exit__(self, *_: object) -> None:
        """保持上下文管理器约定，不吞掉测试过程中发生的异常。"""
        return None

    def scalars(self, _: object) -> list[SimpleNamespace]:
        """模拟无博客记录的查询结果，使测试不依赖预置文章。"""
        return []


def test_prompt_and_message_text() -> None:
    assert "写入任务" in BlogAgentPrompt.system_message()
    assert _message_text(AIMessage(content="回答")) == ["回答"]
    assert _message_text(AIMessageChunk(content="流式回答")) == ["流式回答"]
    assert _message_text(AIMessage(content=[{"type": "text", "text": "分块"}])) == ["分块"]
    assert _message_text(HumanMessage(content="问题")) == []
    assert _message_text(object()) == []


@pytest.mark.anyio
async def test_conversation_checkpoint_keeps_turns_and_replaces_page_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, MessagesState, StateGraph

    from genesis_api.ai.schemas import AiContext

    model = FakeListChatModel(responses=["第一轮回答", "第二轮回答"])

    async def respond(state: MessagesState) -> dict[str, object]:
        return {"messages": [await model.ainvoke(state["messages"])]}

    builder = StateGraph(MessagesState)
    builder.add_node("respond", respond)
    builder.add_edge(START, "respond")
    builder.add_edge("respond", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    runtime = EmbeddedAgentRuntime()
    monkeypatch.setattr(runtime, "_graph", lambda *_: graph)
    request = AiChatRequest(
        surface="studio", conversation_id=uuid4(), actor_id=uuid4(), actor_role="owner",
        messages=[AiMessage(role="user", content="第一轮问题")],
        context=AiContext(title="文章甲"),
    )
    settings = Settings(text_openai_model="test")
    assert "".join([text async for text in runtime.stream(
        request, settings, thread_id="conversation",
    ) if isinstance(text, str)]) == "第一轮回答"
    await_input = request.model_copy(update={
        "messages": [AiMessage(role="user", content="第二轮问题")],
        "context": AiContext(title="文章乙"),
    })
    assert "".join([text async for text in runtime.stream(
        await_input, settings, thread_id="conversation",
    ) if isinstance(text, str)]) == "第二轮回答"
    snapshot = await graph.aget_state({"configurable": {"thread_id": "conversation"}})
    messages = snapshot.values["messages"]
    assert [message.content for message in messages if message.type == "human"] == [
        "第一轮问题", "第二轮问题",
    ]
    contexts = [message for message in messages if message.type == "system"]
    assert len(contexts) == 1
    assert "文章乙" in contexts[0].content
    assert "文章甲" not in contexts[0].content


@pytest.mark.anyio
async def test_title_uses_model_without_agent_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    runtime = EmbeddedAgentRuntime()
    model = FakeListChatModel(responses=['“规划博客选题”', '  '])
    monkeypatch.setattr(runtime, "_build_model", lambda *_: model)
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="规划博客")])
    service = AgentService(Settings(text_openai_model="test"), runtime)
    assert await service.generate_title(request) == "规划博客选题"
    with pytest.raises(RuntimeError, match="未返回"):
        await service.generate_title(request)
    with pytest.raises(RuntimeError, match="未配置"):
        await runtime.generate_title(request, Settings(text_openai_model=""))


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
            yield "messages", (HumanMessage(content="忽略"), {})
            yield "messages", (AIMessage(content="保留"), {})

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
async def test_tool_proposal_is_forwarded_without_model_repeating_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """只转发通过提议契约校验的工具结果，普通工具输出不混入正文。"""
    proposal = AgentActionProposal(
        proposal_id=uuid4(), module="blog", action="create_draft", payload={"title": "草稿"},
        summary="创建草稿", expires_at="2099-01-01T00:00:00Z", proposal_token="test",
    )

    class FakeGraph:
        async def astream(self, *_: object, **kwargs: object) -> Any:
            assert kwargs["stream_mode"] == ["messages", "updates"]
            yield "updates", {"tools": {"messages": [
                ToolMessage(content="普通搜索结果", tool_call_id="search"),
                ToolMessage(content=proposal.model_dump_json(), tool_call_id="draft"),
            ]}}
            yield "messages", (AIMessage(content="请点击确认执行"), {})

    runtime = EmbeddedAgentRuntime()
    monkeypatch.setattr(runtime, "_graph", lambda *_: FakeGraph())
    request = AiChatRequest(
        surface="studio", messages=[AiMessage(role="user", content="写文章")],
        actor_id=uuid4(), actor_role="owner",
    )
    assert [item async for item in runtime.stream(
        request, Settings(text_openai_model="test"), thread_id="proposal-thread",
    )] == [proposal, "请点击确认执行"]


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
        runtime._graph(Settings(), "openai", "model", "blog")

    runtime._checkpointer = cast(Any, object())
    sentinel = object()
    monkeypatch.setattr(runtime, "_build_model", lambda *_: cast(Any, object()))
    monkeypatch.setattr("genesis_api.agent.runtime.create_deep_agent", lambda **_: sentinel)
    assert runtime._graph(Settings(), "openai", "model", "blog") is sentinel
    assert runtime._graph(Settings(), "openai", "model", "blog") is sentinel


def test_runtime_passes_supported_effort_and_rejects_unknown_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    def build(**kwargs: object) -> Any:
        calls.append(kwargs)
        return object()

    monkeypatch.setattr("genesis_api.agent.runtime.init_chat_model", build)
    runtime = EmbeddedAgentRuntime()
    settings = Settings(text_openai_api_key=SecretStr("test"))
    runtime._build_model(settings, "openai", "gpt-5", "high")
    assert calls[-1]["reasoning_effort"] == "high"
    assert "temperature" not in calls[-1]
    runtime._build_model(settings, "openai", "gpt-5")
    assert "reasoning_effort" not in calls[-1]
    with pytest.raises(RuntimeError, match="不支持所选思考强度"):
        runtime._build_model(settings, "openai", "custom-unknown", "high")
    with pytest.raises(RuntimeError, match="不支持所选思考强度"):
        runtime._build_model(settings, "openai", "gpt-5", "max")


@pytest.mark.anyio
async def test_gateway_runtime_uses_native_profile_with_openai_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """原生 profile 校验通过后，经兼容客户端传递参数并保留模型能力。"""
    from genesis_api.llm.profiles import model_profile_for

    calls: list[dict[str, Any]] = []

    def build(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return object()

    monkeypatch.setattr("genesis_api.agent.runtime.init_chat_model", build)
    runtime = EmbeddedAgentRuntime()
    settings = Settings(
        text_gemini_api_key=SecretStr("test"),
        text_gemini_base_url="https://www.yyapi.cloud",
    )
    model = "gemini-3.1-pro-preview"
    profile = model_profile_for("google_genai", model)
    runtime._build_model(settings, "gemini", model, "high")
    assert calls[-1]["model"] == f"openai:{model}"
    assert calls[-1]["profile"] == profile
    assert calls[-1]["reasoning_effort"] == "high"
    await calls[-1]["http_async_client"].aclose()
    with pytest.raises(RuntimeError, match="不支持所选思考强度"):
        runtime._build_model(settings, "gemini", model, "max")
    with pytest.raises(RuntimeError, match="不支持所选思考强度"):
        runtime._build_model(settings, "gemini", "gemini-2.5-flash", "high")


def test_graph_cache_separates_reasoning_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, object())
    monkeypatch.setattr(runtime, "_build_model", lambda *_: cast(Any, object()))
    monkeypatch.setattr("genesis_api.agent.runtime.create_deep_agent", lambda **_: object())
    high = runtime._graph(Settings(), "openai", "gpt-5", "blog", "high")
    assert runtime._graph(Settings(), "openai", "gpt-5", "blog", "high") is high
    assert runtime._graph(Settings(), "openai", "gpt-5", "blog", "low") is not high
    assert runtime._graph(Settings(), "openai", "gpt-5", "blog") is not high


@pytest.mark.anyio
async def test_blog_tools_keep_invocation_context_isolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = uuid4()
    second = uuid4()

    async def observe(actor_id: object) -> tuple[object, object]:
        with agent_invocation_context(cast(Any, actor_id), "owner", "blog"):
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
    monkeypatch.setattr(agent_tools, "get_blog_post_by_slug", lambda *_: None)
    monkeypatch.setattr(agent_tools, "get_settings", lambda: Settings())

    with agent_invocation_context(first, UserRole.OWNER.value, "blog"):
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
        monkeypatch.setattr(agent_tools, "get_blog_post_by_slug", lambda *_: post)
        with pytest.raises(ValueError, match="文章路径已被使用"):
            agent_tools._preview(
                "create_draft",
                {"title": "新文章", "excerpt": "摘要", "content_markdown": "正文", "slug": "post"},
                Settings(agent_action_secret=SecretStr("x" * 32)),
            )
        monkeypatch.setattr(agent_tools, "get_blog_post_by_slug", lambda *_: None)
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
