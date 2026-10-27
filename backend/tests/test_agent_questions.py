"""验证澄清工具的输入约束、真实框架结束与同一会话续聊。"""

import json
from typing import Any, cast
from uuid import uuid4

import pytest
from ag_ui.core import EventType, RunFinishedEvent, ToolCallResultEvent, ToolCallStartEvent
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from agent_events import public_text
from genesis_api.agent.questions import QuestionRequest, ask_user_question
from genesis_api.agent.runtime import EmbeddedAgentRuntime
from genesis_api.ai.schemas import AiChatRequest, AiMessage
from genesis_api.core.config import Settings


def test_question_tool_validates_and_returns_persistable_block() -> None:
    """没有选项时仍可自由回答，工具不执行任何业务操作。"""
    result = ask_user_question.invoke({"questions": [{
        "question": "目标是什么？", "recommended": False, "multi_select": False,
    }]})
    payload = json.loads(result.split("```user-question\n")[1].split("```")[0])
    assert payload["id"]
    assert payload["questions"] == [{"question": "目标是什么？", "options": []}]
    assert not ask_user_question.return_direct
    with pytest.raises(ValidationError):
        QuestionRequest.model_validate({"questions": []})
    with pytest.raises(ValidationError):
        QuestionRequest.model_validate({"questions": [{"question": "选哪个？", "options": [
            {"label": "唯一", "description": "不是有效的选择"},
        ]}]})
    with pytest.raises(ValidationError):
        QuestionRequest.model_validate({"questions": [{"question": "选哪个？", "options": [
            {"label": "方向", "description": "一"},
            {"label": "方向", "description": "二"},
        ]}]})
    with pytest.raises(ValidationError):
        QuestionRequest.model_validate({"questions": [{"question": "选哪个？", "options": [
            {"label": "甲", "description": "一", "recommended": True},
            {"label": "乙", "description": "二", "recommended": True},
        ]}]})


@pytest.mark.anyio
async def test_question_error_does_not_leak_raw_tool_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """工具校验失败时只显示中文恢复提示，不把内部调用参数展示给用户。"""
    class ErrorAdapter:
        """仅返回一次失败工具事件。"""

        def __init__(self, **_: object) -> None:
            pass

        async def run(self, _: object) -> Any:
            """模拟框架的工具错误消息。"""
            yield ToolCallStartEvent(
                type=EventType.TOOL_CALL_START, tool_call_id="invalid-question",
                tool_call_name="ask_user_question",
            )
            yield ToolCallResultEvent(
                type=EventType.TOOL_CALL_RESULT, message_id="result",
                content="Error invoking tool with raw-placeholder arguments",
                tool_call_id="invalid-question",
            )
            yield RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id="invalid-question", run_id="invalid-question",
            )

    runtime = EmbeddedAgentRuntime()
    monkeypatch.setattr(runtime, "_graph", lambda *_: object())
    monkeypatch.setattr("genesis_api.agent.runtime.AuthorizedLangGraphAgent", ErrorAdapter)
    request = AiChatRequest(
        surface="media", actor_id=uuid4(), actor_role="owner",
        messages=[AiMessage(role="user", content="帮我做个视频")],
    )
    events = [event async for event in runtime.stream(
        request, Settings(text_openai_model="test"), thread_id="invalid-question",
    )]
    text = public_text(events)
    assert "请在聊天中补充需求" in text
    assert "raw-placeholder" not in text


@pytest.mark.anyio
async def test_native_question_repairs_invalid_options_before_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """复现选项被多包一层数组；原生模型循环可修正后才等待用户。"""
    class QuestionModel(FakeMessagesListChatModel):
        def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
            return self

    options = [
        {"label": "科普", "description": "面向普通读者"},
        {"label": "专业", "description": "面向研究人员"},
    ]
    model = QuestionModel(responses=[
        AIMessage(content="", tool_calls=[{
            "name": "ask_user_question", "id": "invalid", "args": {"questions": [{
                "question": "文章面向谁？", "options": [options[0], [options[1]]],
            }]},
        }]),
        AIMessage(content="", tool_calls=[{
            "name": "ask_user_question", "id": "repaired", "args": {"questions": [{
                "question": "文章面向谁？", "options": options,
            }]},
        }]),
        AIMessage(content="不应在用户回答前继续"),
    ])
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, InMemorySaver())
    monkeypatch.setattr(runtime, "_build_model", lambda *_: model)
    request = AiChatRequest(
        surface="studio", actor_id=uuid4(), actor_role="owner",
        messages=[AiMessage(role="user", content="写一篇文章")],
    )
    settings = Settings(text_openai_model="test")
    events = [event async for event in runtime.stream(request, settings, thread_id="repair")]
    text = public_text(events)
    assert model.i == 2
    assert text.count("```user-question") == 1
    assert "文章面向谁？" in text
    assert "暂时无法显示" not in text and "不应" not in text
    graph = runtime._graph(settings, "openai", "test", "blog")
    snapshot = await graph.aget_state({"configurable": {"thread_id": "repair"}})
    outputs = [m for m in snapshot.values["messages"] if isinstance(m, ToolMessage)]
    assert [m.status for m in outputs] == ["error", "success"]
    assert "questions[0].options[1]" in outputs[0].content
    assert "必须是对象" in outputs[0].content


@pytest.mark.anyio
async def test_native_tool_ends_turn_and_checkpoint_continues_after_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """实际运行 DeepAgents 图，确保提问后不会继续执行或重复询问。"""
    class QuestionModel(FakeMessagesListChatModel):
        """让框架可绑定工具，响应由测试固定，不连接模型服务。"""

        def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
            """保留原模型以执行预置的工具调用序列。"""
            return self

    model = QuestionModel(responses=[
        AIMessage(content="", tool_calls=[{
            "name": "ask_user_question", "id": "question-call", "type": "tool_call",
            "args": {"questions": [{"question": "准备给谁看？", "options": []}]},
        }]),
        AIMessage(content="按你补充的读者方向继续。"),
    ])
    runtime = EmbeddedAgentRuntime()
    runtime._checkpointer = cast(Any, InMemorySaver())
    monkeypatch.setattr(runtime, "_build_model", lambda *_: model)
    request = AiChatRequest(
        surface="media", conversation_id=uuid4(), actor_id=uuid4(), actor_role="owner",
        messages=[AiMessage(role="user", content="帮我做个视频")],
    )
    settings = Settings(text_openai_model="test")
    events = [event async for event in runtime.stream(request, settings, thread_id="questions")]
    text = public_text(events)
    assert "```user-question" in text
    assert "准备给谁看？" in text
    assert "继续" not in text
    assert model.i == 1
    answer = request.model_copy(update={
        "messages": [AiMessage(role="user", content="给第一次接触产品的用户看")],
    })
    resumed = [event async for event in runtime.stream(answer, settings, thread_id="questions")]
    assert public_text(resumed) == (
        "按你补充的读者方向继续。"
    )
