"""验证后台任务持久化、重启恢复、用户取消与 SSE 快照重放。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest
from ag_ui.core import (
    BaseEvent,
    EventType,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.agent.context import agent_invocation_context, require_actor
from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.agent.files import _files, agent_files_context
from genesis_api.agent.metrics import GenerationMetrics
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.agent.tool_history import AgentToolCall, ToolCallHistory
from genesis_api.ai.ag_ui import legacy_snapshot
from genesis_api.ai.conversations import conversation_detail
from genesis_api.ai.models import AiChatRun, AiChatRunStatus, AiConversation
from genesis_api.ai.runs import (
    AiChatRunManager,
    ChatStreamer,
    _configured_model,
    _request_from_payload,
    create_ai_chat_run,
    get_ai_chat_run_snapshot,
)
from genesis_api.ai.schemas import AiChatRequest, AiChatRunSnapshot, AiMessage
from genesis_api.ai.service import AgentService
from genesis_api.api.routes import ai as ai_route
from genesis_api.billing.transport import _execution, execution_context
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


class FakeChatService:
    """用两个文本片段模拟模型流，供测试观察中间与完成快照。"""

    def __init__(self, _: Settings) -> None:
        """保留生产工厂的配置入参，不创建模型客户端。"""
        self.metrics = GenerationMetrics()
        self.metrics.input_tokens = 18000
        self.metrics.input_provider = "openai"
        self.metrics.input_model = "test-model"

    async def stream(self, _: AiChatRequest, *, thread_id: str) -> AsyncGenerator[BaseEvent, None]:
        """分两次产出固定文本，中间让出事件循环以触发异步持久化。"""
        self.metrics.observe(None, "断点")
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT, message_id="synthetic", delta="断点",
        )
        await asyncio.sleep(0.01)
        self.metrics.observe(None, "续传")
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT, message_id="synthetic", delta="续传",
        )


@pytest.mark.anyio
async def test_tool_history_persists_updates_and_closes_unfinished_calls() -> None:
    """工具开始在正文前持久化，同一回调不重复，结束任务保留未完成调用的中断状态。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="读取")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="tool-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        created = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())

    class ToolService:
        tool_history = ToolCallHistory()

        async def stream(self, *_: object, **__: object) -> AsyncGenerator[BaseEvent, None]:
            call_id = uuid4()
            await self.tool_history.on_tool_start({"name": "lookup"}, "", run_id=call_id)
            with factory() as session:
                snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
                assert snapshot is not None and snapshot.tool_calls[0].status == "running"
                assert snapshot.content == ""
                assert get_ai_chat_run_snapshot(
                    session, run_id=created.id, user_id=uuid4(),
                ) is None
            await self.tool_history.on_tool_end("[]", run_id=call_id)
            await self.tool_history.on_tool_end("[]", run_id=call_id)
            await self.tool_history.on_tool_start({"name": "slow_tool"}, "", run_id=uuid4())
            yield TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT, message_id="synthetic", delta="完成",
            )

    manager = AiChatRunManager(factory, lambda _: ToolService())
    manager._semaphore = asyncio.Semaphore(1)
    await manager._generate(created.id, request, Settings())
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
        assert snapshot is not None
        assert [call.status for call in snapshot.tool_calls] == ["succeeded", "interrupted"]
        assert snapshot.tool_calls[1].duration_ms is None
        assert snapshot.content == "完成"
        conversation = AiConversation(user_id=user_id, title="工具历史", title_source="manual")
        session.add(conversation)
        session.flush()
        run = session.get(AiChatRun, created.id)
        assert run is not None
        run.conversation_id = conversation.id
        session.commit()
        history = conversation_detail(session, conversation)
        assert history.messages[-1].tool_calls == snapshot.tool_calls
        assert not snapshot.history
        subscription = get_ai_chat_run_snapshot(
            session, run_id=created.id, user_id=user_id, include_history=True,
        )
        assert subscription is not None and subscription.history == history.messages
        assert "history" not in subscription.model_dump()
        assert get_ai_chat_run_snapshot(
            session, run_id=created.id, user_id=uuid4(), include_history=True,
        ) is None


@pytest.mark.anyio
@pytest.mark.parametrize("recover", [False, True])
async def test_cancel_or_restart_preserves_history_without_stale_running(recover: bool) -> None:
    """取消与重启都保留历史，未结束调用不伪造成功或持续运行状态。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="查询")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="recover-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        created = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())
    manager = AiChatRunManager(factory)
    call = AgentToolCall(
        id=uuid4(), name="lookup", label="读取", status="running",
        started_at="2026-10-22T00:00:00Z",
    )
    later = call.model_copy(update={"id": uuid4(), "started_at": call.started_at.replace(second=1)})
    manager._persist_tool_call_sync(created.id, later)
    manager._persist_tool_call_sync(created.id, call)
    if recover:
        restored = manager._recover_interrupted_runs_sync()
        assert len(restored) == 1 and restored[0][1].resume_from_checkpoint
    else:
        await manager.cancel(created.id)
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)
        assert snapshot is not None
        assert snapshot.tool_calls[0].status == "interrupted"
        assert snapshot.tool_calls[0].duration_ms is None
        assert [item.id for item in snapshot.tool_calls] == [call.id, later.id]
        assert all(item.status == "interrupted" for item in snapshot.tool_calls)


def build_session_factory() -> sessionmaker[Session]:
    """创建跨工作线程共享的内存数据库会话工厂。

    StaticPool 让多个会话访问同一个内存库；关闭线程检查是为了覆盖
    asyncio.to_thread 中的持久化路径，不代表生产数据库采用相同连接策略。

    Returns:
        已建表且提交后不使实体失效的 SQLite 会话工厂。
    """
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker[Session](bind=engine, expire_on_commit=False)


@pytest.mark.anyio
@pytest.mark.parametrize("outcome", ["complete", "run_error", "persist_error", "cancel"])
async def test_stream_closes_in_own_context_before_next_run(
    monkeypatch: pytest.MonkeyPatch, outcome: str,
) -> None:
    """正常、错误及消费期间取消都逐层关闭流，并恢复身份、附件和计费上下文。"""
    runtime = EmbeddedAgentRuntime()
    monkeypatch.setattr(runtime, "_graph", lambda *_: object())
    settings = Settings(text_openai_model="synthetic")
    closed: list[object] = []
    active_actor = uuid4()
    active_source = uuid4()
    active_outcome = outcome

    class Adapter:
        def __init__(self, **_: object) -> None:
            pass

        async def run(self, _: object) -> AsyncGenerator[BaseEvent, None]:
            try:
                assert require_actor(module="blog") == active_actor
                assert _files.get() == []
                execution = _execution.get()
                assert execution is not None and execution.source_id == active_source
                yield TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT, message_id="answer", delta="片段",
                )
                if active_outcome == "run_error":
                    yield RunErrorEvent(type=EventType.RUN_ERROR, message="合成模型错误")
                else:
                    yield RunFinishedEvent(
                        type=EventType.RUN_FINISHED, thread_id="thread", run_id="run",
                    )
            finally:
                assert require_actor(module="blog") == active_actor
                assert _files.get() == []
                closed.append(asyncio.current_task())

    monkeypatch.setattr("genesis_api.agent.runtime.AuthorizedLangGraphAgent", Adapter)
    manager = AiChatRunManager(
        build_session_factory(), lambda _: AgentService(settings, runtime), flush_size=1,
    )
    manager._semaphore = asyncio.Semaphore(1)
    interrupted = False
    states: list[object] = []

    async def persist(_: object, **values: object) -> None:
        nonlocal interrupted
        states.append(values.get("status"))
        if values.get("append_content") and not interrupted:
            interrupted = True
            if active_outcome == "persist_error":
                raise RuntimeError("合成保存错误")
            if active_outcome == "cancel":
                task = asyncio.current_task()
                assert task is not None
                task.cancel()
                await asyncio.sleep(0)

    monkeypatch.setattr(manager, "_persist", persist)

    async def execute(request: AiChatRequest, expected_closed: int) -> None:
        outer_actor = uuid4()
        with (
            agent_invocation_context(outer_actor, "owner", "media"),
            agent_files_context([("outer.txt", b"synthetic")]),
            execution_context(uuid4(), settings),
        ):
            outer_execution = _execution.get()
            try:
                assert request.billing_source_id is not None
                await manager._generate(request.billing_source_id, request, settings)
            finally:
                assert len(closed) == expected_closed
                assert closed[-1] == asyncio.current_task()
                assert require_actor(module="media") == outer_actor
                assert _files.get() == [("outer.txt", b"synthetic")]
                assert _execution.get() is outer_execution

    # 每个任务绑定不同用户；第一次提前退出后，第二次仍必须干净地开始和结束。
    for index in range(2):
        active_actor, active_source = uuid4(), uuid4()
        active_outcome = outcome if index == 0 else "complete"
        interrupted = False
        request = AiChatRequest(
            surface="studio", messages=[AiMessage(role="user", content="合成输入")],
            actor_id=active_actor, actor_role="owner", billing_source_id=active_source,
        )

        task = asyncio.create_task(execute(request, index + 1))
        if active_outcome == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            await task
            assert states[-1] == (
                AiChatRunStatus.COMPLETED
                if active_outcome == "complete" else AiChatRunStatus.FAILED
            )
        assert len(closed) == index + 1


@pytest.mark.anyio
async def test_proposals_persist_separately_and_deduplicate() -> None:
    """无正文的工具提议也能保存并去重，令牌不进入正文。"""
    factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(surface="studio", messages=[AiMessage(role="user", content="创建草稿")])
    with factory() as session:
        session.add(User(
            id=user_id, handle="proposal-owner", display_name="Owner", role=UserRole.OWNER,
        ))
        session.commit()
        run = create_ai_chat_run(session, user_id=user_id, request=request, settings=Settings())
    proposal = AgentActionProposal(
        proposal_id=uuid4(), module="blog", action="create_draft", payload={"title": "草稿"},
        summary="创建草稿", expires_at="2099-01-01T00:00:00Z", proposal_token="test-proposal",
    )

    class ProposalService:
        async def stream(
            self, *_: object, **__: object,
        ) -> AsyncGenerator[AgentActionProposal, None]:
            yield proposal
            yield proposal

    manager = AiChatRunManager(factory, lambda _: ProposalService())
    manager._semaphore = asyncio.Semaphore(1)
    await manager._generate(run.id, request, Settings())
    with factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=run.id, user_id=user_id)
        assert snapshot is not None
        assert snapshot.content == ""
        assert snapshot.proposals == [proposal]
        assert snapshot.sequence == 1
        assert snapshot.status is AiChatRunStatus.COMPLETED


@pytest.mark.anyio
async def test_background_run_persists_output_without_stream_subscriber() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=user_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=user_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="继续输出")],
            ),
            settings=Settings(text_openai_model="test-model"),
        )

    manager = AiChatRunManager(
        session_factory,
        cast(type[ChatStreamer], FakeChatService),
        flush_interval=0,
        flush_size=1,
    )
    manager.start(
        created.id,
        AiChatRequest(
            surface="studio",
            messages=[AiMessage(role="user", content="继续输出")],
        ),
        Settings(text_openai_model="test-model"),
    )

    # StaticPool 共用一条 SQLite 连接；先等待后台提交，避免读会话回滚工作线程的事务。
    await asyncio.wait_for(manager._tasks[created.id], timeout=10)
    with session_factory() as session:
        snapshot = get_ai_chat_run_snapshot(session, run_id=created.id, user_id=user_id)

    assert snapshot is not None
    assert snapshot.status is AiChatRunStatus.COMPLETED
    assert snapshot.content == "断点续传"
    assert snapshot.sequence == 2
    assert snapshot.metrics is not None
    assert snapshot.metrics.token_source == "estimated"
    assert snapshot.metrics.output_tokens == 4
    assert snapshot.metrics.input_tokens == 18000
    assert snapshot.metrics.input_provider == "openai"
    assert snapshot.metrics.input_model == "test-model"
    await manager.shutdown()


def test_run_snapshot_is_scoped_to_owner() -> None:
    session_factory = build_session_factory()
    owner_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=owner_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=owner_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="测试权限")],
            ),
            settings=Settings(text_openai_model="test-model"),
        )
        snapshot = get_ai_chat_run_snapshot(
            session,
            run_id=created.id,
            user_id=uuid4(),
        )

    assert snapshot is None


def test_provider_model_selection_and_request_persistence() -> None:
    settings = Settings(
        text_grok_model="grok-model",
        text_gemini_model="gemini-model",
        text_claude_model="claude-model",
    )
    assert _configured_model(settings, "openai") == settings.text_openai_model
    assert _configured_model(settings, "grok") == "grok-model"
    assert _configured_model(settings, "gemini") == "gemini-model"
    assert _configured_model(settings, "claude") == "claude-model"

    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
        created = create_ai_chat_run(
            session,
            user_id=user_id,
            request=AiChatRequest(
                surface="studio",
                messages=[AiMessage(role="user", content="保存")],
                reasoning_effort="high",
                actor_id=user_id,
                actor_role="owner",
            ),
            settings=settings,
        )
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.request_payload["actor_id"] == str(user_id)
        assert run.request_payload["messages"] == [{"role": "user", "content": "保存"}]
        assert run.request_payload["reasoning_effort"] == "high"
        assert _request_from_payload(run.request_payload).reasoning_effort == "high"


@pytest.mark.anyio
async def test_startup_recovers_interrupted_runs(tmp_path: Path) -> None:
    # 恢复会并行读取标题与写入任务；独立连接避免 StaticPool 的读会话回滚其他事务。
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'recovery.db'}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker[Session](bind=engine, expire_on_commit=False)
    user_id = uuid4()
    run_id = uuid4()
    with session_factory() as session:
        session.add(
            User(
                id=user_id,
                handle="owner",
                display_name="Owner",
                role=UserRole.OWNER,
            )
        )
        session.add(
            AiChatRun(
                id=run_id,
                user_id=user_id,
                surface="studio",
                provider="openai",
                model="test-model",
                status=AiChatRunStatus.RUNNING,
                content="已有内容",
                request_payload={
                    "surface": "studio",
                    "messages": [{"role": "user", "content": "恢复任务"}],
                    "execution_mode": "approval_required",
                    "actor_id": str(user_id),
                    "actor_role": "owner",
                },
            )
        )
        session.commit()

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], FakeChatService))
    await manager.recover_interrupted_runs(Settings(text_openai_model="test-model"))

    await asyncio.wait_for(manager._tasks[run_id], timeout=10)

    with session_factory() as session:
        run = session.get(AiChatRun, run_id)
        assert run is not None
        assert run.status is AiChatRunStatus.COMPLETED
        assert run.content == "断点续传"
        assert run.error is None
        assert run.sequence == 2
    await manager.shutdown()
    engine.dispose()


@pytest.mark.anyio
async def test_unrecoverable_legacy_run_is_failed() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    run_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.add(
            AiChatRun(
                id=run_id,
                user_id=user_id,
                surface="studio",
                provider="openai",
                status=AiChatRunStatus.RUNNING,
                request_payload={},
            )
        )
        session.commit()
    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], FakeChatService))
    await manager.recover_interrupted_runs(Settings())
    with session_factory() as session:
        run = session.get(AiChatRun, run_id)
        assert run is not None
        assert run.status is AiChatRunStatus.FAILED
        assert "缺少可恢复" in (run.error or "")


@pytest.mark.anyio
async def test_run_manager_persists_runtime_and_provider_errors() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()

    class RuntimeFailure:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(
            self, _: AiChatRequest, *, thread_id: str,
        ) -> AsyncGenerator[BaseEvent, None]:
            if False:
                yield RunStartedEvent(
                    type=EventType.RUN_STARTED, thread_id=thread_id, run_id="test",
                )
            raise RuntimeError("配置错误")

    class PermissionDeniedError(Exception):
        pass

    class ProviderFailure:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(
            self, _: AiChatRequest, *, thread_id: str,
        ) -> AsyncGenerator[BaseEvent, None]:
            if False:
                yield RunStartedEvent(
                    type=EventType.RUN_STARTED, thread_id=thread_id, run_id="test",
                )
            raise PermissionDeniedError("blocked")

    async def execute(factory: object) -> AiChatRun:
        request = AiChatRequest(
            surface="studio", messages=[AiMessage(role="user", content="失败")]
        )
        with session_factory() as session:
            created = create_ai_chat_run(
                session, user_id=user_id, request=request, settings=Settings()
            )
        manager = AiChatRunManager(
            session_factory,
            cast(type[ChatStreamer], factory),
            flush_interval=0,
        )
        manager.start(created.id, request, Settings())
        await asyncio.wait_for(manager._tasks[created.id], timeout=10)
        with session_factory() as session:
            run = session.get(AiChatRun, created.id)
            assert run is not None and run.status is AiChatRunStatus.FAILED
            await manager.shutdown()
            return run

    runtime_run = await execute(RuntimeFailure)
    assert runtime_run.error == "配置错误"
    provider_run = await execute(ProviderFailure)
    assert "模型服务拒绝" in (provider_run.error or "")


@pytest.mark.anyio
async def test_shutdown_leaves_cancelled_run_recoverable() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
        request = AiChatRequest(
            surface="studio", messages=[AiMessage(role="user", content="等待")]
        )
        created = create_ai_chat_run(
            session, user_id=user_id, request=request, settings=Settings()
        )

    class SlowService:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(
            self, _: AiChatRequest, *, thread_id: str,
        ) -> AsyncGenerator[BaseEvent, None]:
            await asyncio.sleep(10)
            yield RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id="test")

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], SlowService))
    manager.start(created.id, request, Settings())
    await asyncio.sleep(0.01)
    await manager.shutdown()
    with session_factory() as session:
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.status is AiChatRunStatus.RUNNING


@pytest.mark.anyio
async def test_user_cancel_marks_run_failed_instead_of_recoverable() -> None:
    session_factory = build_session_factory()
    user_id = uuid4()
    request = AiChatRequest(
        surface="studio", messages=[AiMessage(role="user", content="停止")]
    )
    with session_factory() as session:
        session.add(User(id=user_id, handle="owner", display_name="Owner", role=UserRole.OWNER))
        session.commit()
        created = create_ai_chat_run(
            session, user_id=user_id, request=request, settings=Settings()
        )

    class SlowService:
        def __init__(self, _: Settings) -> None:
            pass

        async def stream(
            self, _: AiChatRequest, *, thread_id: str,
        ) -> AsyncGenerator[BaseEvent, None]:
            await asyncio.sleep(10)
            yield RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id="test")

    manager = AiChatRunManager(session_factory, cast(type[ChatStreamer], SlowService))
    manager.start(created.id, request, Settings())
    await asyncio.sleep(0.01)
    await manager.cancel(created.id)
    with session_factory() as session:
        run = session.get(AiChatRun, created.id)
        assert run is not None
        assert run.status is AiChatRunStatus.FAILED
        assert run.error == "生成已由用户停止。"

@pytest.mark.anyio
async def test_stream_response_replays_snapshot_before_live_delta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_id = uuid4()
    user_id = uuid4()
    proposal = AgentActionProposal(
        proposal_id=uuid4(), module="blog", action="create_draft", payload={},
        summary="创建草稿", expires_at="2099-01-01T00:00:00Z", proposal_token="test-proposal",
    )
    tool_call = AgentToolCall(
        id=uuid4(), name="lookup", label="读取文章", status="succeeded",
        started_at="2026-10-22T00:00:00Z", duration_ms=120,
    )
    snapshots = iter(
        [
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.RUNNING,
                content="刷新前已生成",
                sequence=1,
                proposals=[proposal],
                tool_calls=[tool_call],
            ),
            AiChatRunSnapshot(
                id=run_id,
                status=AiChatRunStatus.COMPLETED,
                content="刷新前已生成，刷新后继续",
                sequence=2,
                proposals=[proposal],
                tool_calls=[tool_call],
            ),
        ]
    )
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: next(snapshots))
    records = iter([
        [
            (1, RunStartedEvent(
                type=EventType.RUN_STARTED, thread_id=str(run_id), run_id=str(run_id),
            )),
            (2, legacy_snapshot(AiChatRunSnapshot(
                id=run_id, status="running", content="刷新前已生成", sequence=1,
                tool_calls=[tool_call],
            ))),
            (3, TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START, message_id=f"{run_id}:assistant",
            )),
        ],
        [
            (4, TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT, message_id=f"{run_id}:assistant",
                delta="，刷新后继续",
            )),
            (5, TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END, message_id=f"{run_id}:assistant",
            )),
            (6, RunFinishedEvent(
                type=EventType.RUN_FINISHED, thread_id=str(run_id), run_id=str(run_id),
            )),
        ],
    ])
    monkeypatch.setattr(ai_route, "_load_events", lambda *_: next(records))

    class ConnectedRequest:
        async def is_disconnected(self) -> bool:
            return False

    response = ai_route._stream_response(
        run_id,
        user_id,
        cast(Request, ConnectedRequest()),
    )
    body_parts: list[str] = []
    async for chunk in response.body_iterator:
        body_parts.append(chunk if isinstance(chunk, str) else bytes(chunk).decode())
    body = "".join(body_parts)

    events = [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
    assert events[0]["type"] == "RUN_STARTED"
    assert events[1]["type"] == "MESSAGES_SNAPSHOT"
    assert events[1]["messages"][0]["content"] == "刷新前已生成"
    assert next(e for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")["delta"] == "，刷新后继续"
    assert events[-1]["type"] == "RUN_FINISHED"
    states = [e["snapshot"]["genesis"] for e in events if e["type"] == "STATE_SNAPSHOT"]
    assert len(states) == 2
    assert states[0]["proposals"][0]["proposal_id"] == str(proposal.proposal_id)
    assert [e["type"] for e in events].count("TOOL_CALL_START") == 0
    assert [e["type"] for e in events].count("TOOL_CALL_RESULT") == 0
    assert events[1]["messages"][0]["toolCalls"][0]["id"] == str(tool_call.id)
    assert events[1]["messages"][1]["toolCallId"] == str(tool_call.id)
    assert all("tool_calls" not in state for state in states)
    assert str(tool_call.id) in body
    assert states[-1]["proposals"][0]["proposal_token"] == "test-proposal"
