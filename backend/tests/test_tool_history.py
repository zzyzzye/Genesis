"""验证工具历史复用原生回调、并行状态及安全摘要。"""

import asyncio
import json
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from pydantic import ValidationError

from genesis_api.agent.questions import QuestionRequest
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.agent.tool_history import AgentToolCall, ToolCallHistory
from genesis_api.agent.tool_inputs import tool_validation_error
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.core.config import Settings


@pytest.mark.anyio
async def test_native_parallel_tools_emit_safe_history(monkeypatch: pytest.MonkeyPatch) -> None:
    """真实 ToolNode 回调能区分并行调用，参数和结果中的标记不会进入历史。"""
    changes: list[AgentToolCall] = []

    async def save(call: AgentToolCall) -> None:
        changes.append(call)

    @tool
    async def lookup(query: str) -> str:
        """检索示例内容。"""
        await asyncio.sleep(0)
        return '["result-private-marker"]'

    history = ToolCallHistory(save)

    def plan(state: MessagesState) -> MessagesState:
        return {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "first",
                            "name": "lookup",
                            "args": {"query": "input-private-marker"},
                        },
                        {
                            "id": "second",
                            "name": "lookup",
                            "args": {"query": "another-private-marker"},
                        },
                    ],
                )
            ]
        }

    builder = StateGraph(MessagesState)
    builder.add_node("plan", plan)
    builder.add_node("tools", ToolNode([lookup]))
    builder.add_edge(START, "plan")
    builder.add_edge("plan", "tools")
    builder.add_edge("tools", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    runtime = EmbeddedAgentRuntime()
    monkeypatch.setattr(runtime, "_graph", lambda *_: graph)
    request = AiChatRequest(
        surface="studio",
        messages=[AiMessage(role="user", content="查询")],
        actor_id=uuid4(),
        actor_role="owner",
    )
    output = [
        item
        async for item in runtime.stream(
            request,
            Settings(text_openai_model="synthetic"),
            thread_id="parallel",
            tool_history=history,
        )
    ]
    from agent_events import public_text

    assert public_text(output) == ""
    wire = json.dumps([item.model_dump(mode="json") for item in output])
    assert "input-private-marker" not in wire and "result-private-marker" not in wire
    assert len(changes) == 4
    starts = [call for call in changes if call.status == "running"]
    ends = [call for call in changes if call.status == "succeeded"]
    assert len(starts) == len(ends) == 2
    assert {call.id for call in starts} == {call.id for call in ends}
    assert all(call.label == "检索示例内容" for call in starts)
    assert all(call.parameter_names == ["query"] for call in starts)
    assert all(call.duration_ms is not None and call.duration_ms >= 0 for call in ends)
    assert all(call.result_summary == "返回 1 项结果" for call in ends)
    assert "private-marker" not in "".join(call.model_dump_json() for call in changes)
    restored = ToolCallHistory()
    restored.restore(changes)
    assert set(restored.protocol_calls) == {"first", "second"}
    assert all(call.status == "succeeded" for call in restored.protocol_calls.values())


@pytest.mark.anyio
async def test_tool_errors_proposals_and_interruption_are_distinct() -> None:
    """工具返回错误、签名提议和取消都有真实状态，不把成功返回提议误报为已写入。"""
    changes: list[AgentToolCall] = []

    async def save(call: AgentToolCall) -> None:
        changes.append(call)

    history = ToolCallHistory(save)
    for executed in (False, True):
        call_id, proposal_id = uuid4(), uuid4()
        await history.on_tool_start({"name": "update_post"}, "private-input", run_id=call_id)
        await history.on_tool_end(
            ToolMessage(
                content='{"type":"pending_action","proposal_id":"'
                + str(proposal_id)
                + '","proposal_token":"private-signature","executed":'
                + str(executed).lower()
                + "}",
                tool_call_id="tool-id",
            ),
            run_id=call_id,
        )
        assert changes[-1].status == ("succeeded" if executed else "awaiting_confirmation")
        assert changes[-1].proposal_id == proposal_id
    call_id = uuid4()
    await history.on_tool_start({"name": "lookup"}, "", run_id=call_id)
    await history.on_tool_end(
        ToolMessage(
            content="private-error",
            status="error",
            tool_call_id="failed",
        ),
        run_id=call_id,
    )
    assert changes[-1].status == "failed"
    call_id = uuid4()
    await history.on_tool_start({"name": "read_file"}, "", run_id=call_id)
    await history.on_tool_error(asyncio.CancelledError(), run_id=call_id)
    assert [call.status for call in changes][-1] == "interrupted"
    assert "private-" not in "".join(call.model_dump_json() for call in changes)


@pytest.mark.anyio
async def test_validation_history_displays_safe_field_reason() -> None:
    """模型与历史收到同一份字段原因，错误输入值不进入持久化历史。"""
    changes: list[AgentToolCall] = []

    async def save(call: AgentToolCall) -> None:
        changes.append(call)

    with pytest.raises(ValidationError) as caught:
        QuestionRequest.model_validate({"questions": "private-marker"})
    history = ToolCallHistory(save)
    call_id = uuid4()
    await history.on_tool_start({"name": "ask_user_question"}, "private-marker", run_id=call_id)
    await history.on_tool_end(ToolMessage(
        content=tool_validation_error(caught.value), status="error", tool_call_id="invalid",
    ), run_id=call_id)
    assert changes[-1].status == "failed"
    assert changes[-1].result_summary == "参数校验失败：questions：必须是数组"
    assert "private-marker" not in "".join(call.model_dump_json() for call in changes)
