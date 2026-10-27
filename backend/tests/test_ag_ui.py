"""验证 AG-UI 协议投影和可恢复订阅，不发起真实模型调用。"""

from __future__ import annotations

import json
from typing import Any, cast
from uuid import uuid4

import pytest
from ag_ui.core import EventType
from fastapi import Request

from genesis_api.agent.tool_history import AgentToolCall
from genesis_api.ai.ag_ui import AgUiRunStream
from genesis_api.ai.models import AiChatRunStatus
from genesis_api.ai.schemas import AiChatRunSnapshot, AiGenerationMetrics
from genesis_api.api.routes import ai as ai_route


def test_projection_restores_resets_and_updates_state_without_new_text() -> None:
    """同序号的计费变更也要传递，正文重算必须替换，重连不得重复追加。"""
    run_id, conversation_id = uuid4(), uuid4()
    snapshot = AiChatRunSnapshot(
        id=run_id, conversation_id=conversation_id, status="running",
        content="已有正文", sequence=3,
    )
    stream = AgUiRunStream(str(run_id))
    initial = stream.project(snapshot)
    assert initial[0].model_dump(by_alias=True)["threadId"] == str(conversation_id)
    assert [e.type for e in initial] == [
        EventType.RUN_STARTED, EventType.MESSAGES_SNAPSHOT,
        EventType.TEXT_MESSAGE_START, EventType.STATE_SNAPSHOT,
    ]
    assert stream.project(snapshot) == []
    billed = snapshot.model_copy(update={"billing": {"status": "settled"}})
    events = stream.project(billed)
    assert len(events) == 1 and events[0].type == EventType.STATE_SNAPSHOT
    reset = billed.model_copy(update={"content": "重算", "sequence": 4})
    events = stream.project(reset)
    assert [e.type for e in events[:3]] == [
        EventType.TEXT_MESSAGE_END, EventType.MESSAGES_SNAPSHOT, EventType.TEXT_MESSAGE_START,
    ]
    restarted = AgUiRunStream(str(run_id)).project(reset)
    assert restarted[1].model_dump()["messages"][0]["content"] == "重算"
    terminal = reset.model_copy(update={
        "status": AiChatRunStatus.FAILED, "error": "生成已由用户停止。",
        "metrics": AiGenerationMetrics(total_seconds=2),
    })
    events = stream.project(terminal)
    assert [e.type for e in events] == [
        EventType.STATE_SNAPSHOT, EventType.TEXT_MESSAGE_END, EventType.RUN_ERROR,
    ]
    payload = json.loads(stream.encode(events[-1]).removeprefix("data: "))
    assert payload["message"] == "生成已由用户停止。"


def test_projection_emits_only_safe_tool_events_once() -> None:
    """工具生命周期复用安全投影，重放与重复轮询不制造重复调用。"""
    run_id = uuid4()
    call = AgentToolCall(
        id=uuid4(), name="read_file", label="读取文件", status="running",
        started_at="2026-10-27T00:00:00Z", parameter_names=["path"], input_summary="1 项参数",
    )
    snapshot = AiChatRunSnapshot(
        id=run_id, status="running", content="", sequence=0, tool_calls=[call],
    )
    stream = AgUiRunStream(str(run_id))
    events = stream.project(snapshot)
    assert [e.type for e in events[-2:]] == [EventType.TOOL_CALL_START, EventType.TOOL_CALL_END]
    assert not any(e.type == EventType.TOOL_CALL_ARGS for e in events)
    finished_call = call.model_copy(update={
        "status": "awaiting_confirmation", "result_summary": None,
    })
    updated = snapshot.model_copy(update={"tool_calls": [finished_call]})
    events = stream.project(updated)
    assert events[-1].type == EventType.TOOL_CALL_RESULT
    assert events[-1].model_dump()["content"] == "读取文件"
    assert stream.project(updated) == []


@pytest.mark.anyio
@pytest.mark.parametrize("missing,disconnected", [(True, False), (False, True), (False, False)])
async def test_subscription_missing_disconnect_and_heartbeat(
    monkeypatch: pytest.MonkeyPatch, missing: bool, disconnected: bool,
) -> None:
    """订阅失效发送标准错误，离开页面停止轮询，空闲发送 SSE 注释。"""
    run_id, user_id = uuid4(), uuid4()
    snapshot = AiChatRunSnapshot(id=run_id, status="running", content="", sequence=0)
    snapshots = iter([None if missing else snapshot, None])
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: next(snapshots))
    moments = iter([0, 11])
    monkeypatch.setattr(ai_route, "monotonic", lambda: next(moments))

    class BrowserRequest:
        async def is_disconnected(self) -> bool:
            return disconnected

    response = ai_route._stream_response(run_id, user_id, cast(Request, BrowserRequest()))
    parts = [str(chunk) async for chunk in response.body_iterator]
    body = "".join(parts)
    if missing:
        assert '"type":"RUN_ERROR"' in body
        assert '"type":"TEXT_MESSAGE_CONTENT"' not in body
    elif disconnected:
        assert '"type":"RUN_STARTED"' in body
        assert '"type":"RUN_FINISHED"' not in body
        assert '"type":"RUN_ERROR"' not in body
    else:
        assert ": keep-alive\n\n" in body


@pytest.mark.anyio
async def test_completed_subscription_has_a_single_terminal_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """订阅已经完成的任务也必须先还原快照再正常结束。"""
    run_id = uuid4()
    snapshot = AiChatRunSnapshot(id=run_id, status="completed", content="", sequence=0)
    monkeypatch.setattr(ai_route, "_load_snapshot", lambda *_: snapshot)
    response = ai_route._stream_response(run_id, uuid4(), cast(Request, cast(Any, object())))
    body = "".join([str(chunk) async for chunk in response.body_iterator])
    assert body.count('"type":"RUN_FINISHED"') == 1
    assert body.index('"type":"MESSAGES_SNAPSHOT"') < body.index('"type":"RUN_FINISHED"')
