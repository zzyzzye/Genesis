"""验证官方图适配、安全事件日志和独立订阅，不调用真实模型。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from ag_ui.core import BaseEvent, EventType, RunFinishedEvent, RunStartedEvent, ToolCallResultEvent
from fastapi import Request
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from agent_events import public_text
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.ai.ag_ui import legacy_snapshot
from genesis_api.ai.models import AiChatRunEvent
from genesis_api.ai.runs import AiChatRunManager, create_ai_chat_run
from genesis_api.ai.schemas import (
    AiChatRequest,
    AiChatRunSnapshot,
    AiConversationMessage,
    AiMessage,
)
from genesis_api.ai.service import AgentService
from genesis_api.api.routes import ai as ai_route
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


def native_runtime(monkeypatch: pytest.MonkeyPatch) -> EmbeddedAgentRuntime:
    """用真实 DeepAgents 图与官方适配器，模型和工具均为合成数据。"""
    from deepagents import create_deep_agent

    class Model(FakeMessagesListChatModel):
        def bind_tools(self, *args: Any, **kwargs: Any) -> Model:
            return self

    @tool
    def synthetic_lookup(query: str) -> str:
        """读取合成资料。"""
        return "private-result-marker"

    model = Model(responses=[
        AIMessage(content="", tool_calls=[{
            "name": "synthetic_lookup", "id": "official-call-id",
            "args": {"query": "private-input-marker"},
        }]),
        AIMessage(content=[
            {"type": "reasoning", "reasoning": "private-reasoning-marker"},
            {"type": "text", "text": "公开正文"},
        ], additional_kwargs={"reasoning_content": "private-provider-reasoning-marker"}),
    ])
    checkpointer = InMemorySaver()
    graph = create_deep_agent(
        model=model, tools=[synthetic_lookup], checkpointer=checkpointer,
        system_prompt="private-system-marker",
    )
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, checkpointer)
    monkeypatch.setattr(runtime, "_graph", lambda *_: graph)
    return runtime


@pytest.mark.anyio
async def test_official_adapter_keeps_native_ids_and_filters_private_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证实际官方适配器，防止只导入包却继续自写转译。"""
    runtime = native_runtime(monkeypatch)
    request = AiChatRequest(
        surface="studio", actor_id=uuid4(), actor_role="owner", billing_source_id=uuid4(),
        messages=[AiMessage(role="user", content="请查询")],
    )
    events = [event async for event in runtime.stream(
        request, Settings(text_openai_model="synthetic"), thread_id="official-native",
    )]
    wire = json.dumps([
        event.model_dump(mode="json", by_alias=True, exclude_none=True) for event in events
    ])
    assert public_text(events) == "公开正文"
    assert "private-system-marker" not in wire
    assert "private-input-marker" not in wire
    assert "private-result-marker" not in wire
    assert "private-reasoning-marker" not in wire
    assert "private-provider-reasoning-marker" not in wire
    kinds = [event.type for event in events if isinstance(event, BaseEvent)]
    assert kinds[0] == EventType.RUN_STARTED and kinds[-1] == EventType.RUN_FINISHED
    assert EventType.TOOL_CALL_ARGS not in kinds
    assert EventType.STATE_SNAPSHOT not in kinds
    result = next(event for event in events if isinstance(event, ToolCallResultEvent))
    assert result.tool_call_id == "official-call-id"
    assert result.metadata is not None
    assert result.metadata["genesis"]["status"] == "succeeded"
    assert result.metadata["genesis"]["duration_ms"] is not None


@pytest.mark.anyio
@pytest.mark.parametrize("fail_final_commit", [False, True])
async def test_event_journal_replays_official_events_and_keeps_owner_boundary(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, fail_final_commit: bool,
) -> None:
    """后台执行后不依赖连接；重订阅重放同一日志，最终业务状态先于终态。"""
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'events.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker[Session](bind=engine, expire_on_commit=False)
    actor = uuid4()
    request = AiChatRequest(
        surface="studio", actor_id=actor, actor_role="owner",
        messages=[AiMessage(role="user", content="查询")],
    )
    settings = Settings(text_openai_model="synthetic")
    with factory() as session:
        session.add(User(
            id=actor, handle="event-owner", display_name="合成账户", role=UserRole.OWNER,
        ))
        session.commit()
        run = create_ai_chat_run(session, user_id=actor, request=request, settings=settings)
    request.billing_source_id = run.id
    runtime = native_runtime(monkeypatch)
    manager = AiChatRunManager(factory, lambda config: AgentService(config, runtime))
    manager._semaphore = asyncio.Semaphore(1)
    if fail_final_commit:
        persist = manager._persist_sync

        def fail_completion(*args: Any, **kwargs: Any) -> None:
            if args[2] == "completed":
                raise RuntimeError("模拟最终提交失败")
            persist(*args, **kwargs)

        monkeypatch.setattr(manager, "_persist_sync", fail_completion)
    await manager._generate(run.id, request, settings)
    monkeypatch.setattr(ai_route, "SessionLocal", factory)

    with factory() as session:
        journal = session.scalars(select(AiChatRunEvent).order_by(AiChatRunEvent.id)).all()
        assert journal and journal[0].payload["type"] == "RUN_STARTED"
        if not fail_final_commit:
            assert journal[-1].payload["type"] == "RUN_FINISHED"
    assert ai_route._load_events(run.id, uuid4(), 0) == []
    assert ai_route._load_snapshot(run.id, uuid4()) is None
    snapshot = ai_route._load_snapshot(run.id, actor)
    assert snapshot is not None and snapshot.content == "公开正文"
    if fail_final_commit:
        assert snapshot.status == "failed"
        assert not any(row.payload["type"] == "RUN_FINISHED" for row in journal)
        response = ai_route._stream_response(run.id, actor, cast(Request, object()))
        body = "".join([str(part) async for part in response.body_iterator])
        assert '"type":"RUN_FINISHED"' not in body
        assert body.index('"status":"failed"') < body.index('"type":"RUN_ERROR"')
        engine.dispose()
        return
    assert snapshot.status == "completed"
    replayed = []
    for _ in range(2):
        response = ai_route._stream_response(run.id, actor, cast(Request, object()))
        body = "".join([str(part) async for part in response.body_iterator])
        events = [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
        official = [item for item in events if item["type"] != "STATE_SNAPSHOT"]
        assert official == [row.payload for row in journal]
        assert events[-2]["type"] == "STATE_SNAPSHOT"
        assert events[-2]["snapshot"]["genesis"]["status"] == "completed"
        replayed.append(events)
    assert replayed[0] == replayed[1]
    engine.dispose()


@pytest.mark.anyio
async def test_official_adapter_resumes_native_checkpoint_without_resubmitting_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """用真实暂停图验证 None 输入恢复，不重复提交用户消息或再次运行已完成节点。"""
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langchain_core.messages import HumanMessage
    from langgraph.graph import END, START, MessagesState, StateGraph

    model = FakeListChatModel(responses=["恢复后的回答"])
    calls = []

    async def respond(state: MessagesState) -> dict[str, object]:
        calls.append("respond")
        return {"messages": [await model.ainvoke(state["messages"])]}

    builder = StateGraph(MessagesState)
    builder.add_node("respond", respond)
    builder.add_edge(START, "respond")
    builder.add_edge("respond", END)
    checkpointer = InMemorySaver()
    graph = builder.compile(checkpointer=checkpointer, interrupt_before=["respond"])
    config: RunnableConfig = {"configurable": {"thread_id": "native-recovery"}}
    await graph.ainvoke({"messages": [HumanMessage(content="原始问题")]}, config)
    assert calls == []
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, checkpointer)
    monkeypatch.setattr(runtime, "_graph", lambda *_: graph)
    request = AiChatRequest(
        surface="studio", actor_id=uuid4(), actor_role="owner", resume_from_checkpoint=True,
        messages=[AiMessage(role="user", content="不应重复提交的输入")],
    )
    events = [item async for item in runtime.stream(
        request, Settings(text_openai_model="synthetic"), thread_id="native-recovery",
    )]
    assert public_text(events) == "恢复后的回答"
    assert calls == ["respond"]
    saved = await graph.aget_state(config)
    assert [m.content for m in saved.values["messages"] if m.type == "human"] == ["原始问题"]


@pytest.mark.anyio
@pytest.mark.parametrize("missing,disconnected", [(True, False), (False, True), (False, False)])
async def test_subscription_missing_disconnect_and_heartbeat(
    monkeypatch: pytest.MonkeyPatch, missing: bool, disconnected: bool,
) -> None:
    """订阅失效、空闲心跳与离开页面均不触发重新执行。"""
    run_id, actor = uuid4(), uuid4()
    snapshot = AiChatRunSnapshot(id=run_id, status="running", content="", sequence=0)
    snapshots = iter([None if missing else snapshot, None])
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: next(snapshots))
    monkeypatch.setattr(ai_route, "_load_events", lambda *_: [])
    moments = iter([0, 11])
    monkeypatch.setattr(ai_route, "monotonic", lambda: next(moments))

    class BrowserRequest:
        async def is_disconnected(self) -> bool:
            return disconnected

    response = ai_route._stream_response(run_id, actor, cast(Request, BrowserRequest()))
    body = "".join([str(part) async for part in response.body_iterator])
    assert '"type":"TEXT_MESSAGE_CONTENT"' not in body
    if missing:
        assert '"type":"RUN_ERROR"' in body
    elif disconnected:
        assert "RUN_ERROR" not in body and "RUN_FINISHED" not in body
    else:
        assert ": keep-alive\n\n" in body


@pytest.mark.anyio
async def test_terminal_waits_for_final_business_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """官方终态已入日志但任务仍收尾时，等账务状态落库再发送终态。"""
    run_id = uuid4()
    running = AiChatRunSnapshot(id=run_id, status="running", content="", sequence=0)
    finished = running.model_copy(update={"status": type(running.status).COMPLETED})
    snapshots = iter([running, finished])
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: next(snapshots))
    records = [
        (1, RunStartedEvent(type=EventType.RUN_STARTED, thread_id="thread", run_id=str(run_id))),
        (2, RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id="thread", run_id=str(run_id))),
    ]
    monkeypatch.setattr(
        ai_route, "_load_events", lambda _r, _u, after: records if not after else [],
    )

    class BrowserRequest:
        async def is_disconnected(self) -> bool:
            return False

    response = ai_route._stream_response(run_id, uuid4(), cast(Request, BrowserRequest()))
    body = "".join([str(part) async for part in response.body_iterator])
    assert body.count('"type":"RUN_FINISHED"') == 1
    assert body.index('"status":"completed"') < body.index('"type":"RUN_FINISHED"')


def test_legacy_snapshot_preserves_existing_public_history() -> None:
    """旧任务只读静态安全历史，不为它补造工具执行过程。"""
    previous, current = uuid4(), uuid4()
    snapshot = AiChatRunSnapshot(
        id=current, status="completed", content="当前回答", sequence=1,
        history=[
            AiConversationMessage(
                role="user", content="以前的问题", run_id=previous, status="completed",
            ),
            AiConversationMessage(
                role="assistant", content="以前的回答", run_id=previous, status="completed",
            ),
        ],
    )
    messages = legacy_snapshot(snapshot).messages
    assert [message.content for message in messages] == ["以前的问题", "以前的回答", "当前回答"]
