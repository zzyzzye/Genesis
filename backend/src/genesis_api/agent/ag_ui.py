"""官方 LangGraph 适配器的可信输入接入与公开事件过滤。"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    CustomEvent,
    EventType,
    FunctionCall,
    Message,
    MessagesSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCall,
    ToolCallResultEvent,
    ToolCallStartEvent,
    ToolMessage,
    UserMessage,
)
from ag_ui_langgraph import LangGraphAgent  # type: ignore[import-untyped]

from genesis_api.agent.contracts import AgentActionProposal
from genesis_api.agent.questions import QuestionRequest
from genesis_api.agent.tool_history import ToolCallHistory


# 官方包尚未提供 py.typed；不影响事件对象使用官方 Pydantic 类型检查。
class AuthorizedLangGraphAgent(LangGraphAgent):  # type: ignore[misc]
    """仅覆盖官方输入扩展点，保留可信多模态消息与原生 checkpoint 恢复。"""

    def __init__(
        self, *, graph_input: dict[str, object] | None,
        public_events: PublicAgentEvents, **kwargs: Any,
    ) -> None:
        """绑定服务端准备的输入，禁止从浏览器 forwardedProps 覆盖它。"""
        super().__init__(**kwargs, emit_raw_events=False)
        self._graph_input = graph_input
        self._public_events = public_events

    async def prepare_stream(self, **kwargs: Any) -> dict[str, Any]:
        """记录已有消息标识；执行、消息合并和恢复仍委托官方适配器。"""
        self._public_events.previous_messages = {
            message.id for message in kwargs["agent_state"].values.get("messages", [])
            if message.id and message.id not in self._public_events.current_messages
        }
        prepared: dict[str, Any] = await super().prepare_stream(**kwargs)
        return prepared

    def get_stream_kwargs(self, **kwargs: Any) -> dict[str, Any]:
        """通过官方扩展点传入可信消息；None 让 LangGraph 恢复未完成执行。"""
        kwargs["input"] = self._graph_input
        result: dict[str, Any] = super().get_stream_kwargs(**kwargs)
        return {**result, "durability": "sync"}


class PublicAgentEvents:
    """只过滤官方事件中的非公开数据，不生成文本或工具生命周期。"""

    def __init__(self, run_id: str, history: ToolCallHistory) -> None:
        """每次执行独立记录当前输出标识，避免把旧会话正文当成本轮回答。"""
        self.run_id = run_id
        self.history = history
        self.current_messages: set[str] = set()
        self.previous_messages: set[str] = set()
        self.current_calls: set[str] = set()
        self.tool_names: dict[str, str] = {}
        self.question_failed = False
        self._seen_questions: set[str] = set()

    def _metadata(
        self, call_id: str, name: str, *, completed: bool = False,
    ) -> dict[str, object]:
        """沿用原生回调的脱敏展示，不把协议参数和结果原样发给前端。"""
        call = self.history.protocol_calls.get(call_id)
        details = call.model_dump(
            mode="json", exclude={"id", "protocol_id", "name", "result_summary"},
        ) if call else {
            "label": name, "status": "succeeded" if completed else "running",
            "started_at": datetime.now(UTC).isoformat(),
            "duration_ms": None, "input_summary": "参数不公开", "parameter_names": [],
            "proposal_id": None,
        }
        if call_id in self.current_calls:
            details = {**details, "run_id": self.run_id}
        return {"genesis": details}

    def _result(self, call_id: str) -> str:
        """只返回回调已经整理的摘要，历史工具没有摘要时使用中性说明。"""
        call = self.history.protocol_calls.get(call_id)
        return (call.result_summary or call.label) if call else "工具执行完成"

    def _messages(self, messages: list[Message]) -> list[Message]:
        """保留官方消息标识，移除系统消息、原始工具载荷与非公开元数据。"""
        visible: list[Message] = []
        completed = {message.tool_call_id for message in messages if message.role == "tool"}
        for message in messages:
            if message.role == "user":
                # 多模态文件已由附件系统管理，不在事件日志复制文件内容。
                content = message.content if isinstance(message.content, str) else "".join(
                    part.text for part in message.content if part.type == "text"
                )
                visible.append(UserMessage(id=message.id, content=content))
            elif message.role == "assistant":
                if message.id not in self.previous_messages:
                    self.current_messages.add(message.id)
                metadata = {"genesis": {"run_id": self.run_id}} if (
                    message.id in self.current_messages
                ) else None
                calls = []
                for call in message.tool_calls or []:
                    self.tool_names[call.id] = call.function.name
                    if message.id in self.current_messages:
                        self.current_calls.add(call.id)
                    calls.append(ToolCall(
                        id=call.id, function=FunctionCall(name=call.function.name, arguments="{}"),
                        metadata=self._metadata(
                            call.id, call.function.name, completed=call.id in completed,
                        ),
                    ))
                visible.append(AssistantMessage(
                    id=message.id, content=message.content or "", tool_calls=calls,
                    metadata=metadata,
                ))
            elif message.role == "tool":
                visible.append(ToolMessage(
                    id=message.id, tool_call_id=message.tool_call_id,
                    content=self._result(message.tool_call_id),
                    metadata=self._metadata(
                        message.tool_call_id, self.tool_names.get(message.tool_call_id, "调用工具"),
                        completed=True,
                    ),
                ))
        return visible

    def _question(self, call_id: str, content: str) -> CustomEvent | None:
        """校验业务澄清内容；恢复与最终快照不能重复添加同一个问题。"""
        if call_id in self._seen_questions:
            return None
        self._seen_questions.add(call_id)
        try:
            block = content.split("```user-question\n", 1)[1].rsplit("```", 1)[0]
            payload = json.loads(block)
            question = QuestionRequest.model_validate(payload)
            value = {"id": str(UUID(payload["id"])), **question.model_dump(mode="json")}
        except (ValueError, TypeError, KeyError, IndexError):
            self.question_failed = True
            return None
        self.question_failed = False
        return CustomEvent(type=EventType.CUSTOM, name="genesis.question", value={
            "content": "\n```user-question\n" + json.dumps(value, ensure_ascii=False) + "\n```",
        })

    def filter(self, event: BaseEvent) -> Iterator[BaseEvent | AgentActionProposal]:
        """白名单放行官方事件，业务提议与澄清内容单独校验后公开。

        Args:
            event: 官方适配器生成的事件，可能含内部状态与工具原文。

        Yields:
            可持久化的公开事件，或已通过业务契约校验的操作提议。
        """
        kind = event.type
        clean = event.model_copy(update={"raw_event": None, "metadata": None})
        if isinstance(event, TextMessageStartEvent):
            self.current_messages.add(event.message_id)
        if isinstance(event, (TextMessageStartEvent, TextMessageContentEvent, TextMessageEndEvent)):
            yield clean.model_copy(update={"metadata": {"genesis": {"run_id": self.run_id}}})
        elif kind == EventType.MESSAGES_SNAPSHOT:
            assert isinstance(event, MessagesSnapshotEvent)
            messages = self._messages(event.messages)
            for message in event.messages:
                if (
                    message.role == "tool" and message.tool_call_id in self.current_calls
                    and self.tool_names.get(message.tool_call_id) == "ask_user_question"
                ):
                    question = self._question(message.tool_call_id, message.content)
                    if question is not None:
                        yield question
            yield clean.model_copy(update={"messages": messages})
        elif isinstance(event, ToolCallStartEvent):
            self.tool_names[event.tool_call_id] = event.tool_call_name
            self.current_calls.add(event.tool_call_id)
            if event.parent_message_id:
                self.current_messages.add(event.parent_message_id)
            yield clean.model_copy(update={"metadata": self._metadata(
                event.tool_call_id, event.tool_call_name,
            )})
        elif isinstance(event, ToolCallResultEvent):
            name = self.tool_names.get(event.tool_call_id, "调用工具")
            with suppress(ValueError, TypeError):
                yield AgentActionProposal.model_validate_json(event.content)
            if name == "ask_user_question":
                question = self._question(event.tool_call_id, event.content)
                if question is not None:
                    yield question
            yield clean.model_copy(update={
                "content": self._result(event.tool_call_id),
                "metadata": self._metadata(event.tool_call_id, name, completed=True),
            })
        elif kind in (EventType.RUN_STARTED, EventType.RUN_FINISHED, EventType.TOOL_CALL_END):
            if kind == EventType.RUN_FINISHED and self.question_failed:
                yield CustomEvent(type=EventType.CUSTOM, name="genesis.question", value={
                    "content": "澄清问题暂时无法显示，请在聊天中补充需求，或请助手重新提问。",
                })
            if kind == EventType.RUN_STARTED:
                yield clean.model_copy(update={"input": None})
            elif kind == EventType.RUN_FINISHED:
                yield clean.model_copy(update={"result": None})
            else:
                yield clean
        elif kind == EventType.RUN_ERROR:
            yield clean.model_copy(update={"message": "AI 生成失败，请稍后重试。"})
        # 原始状态、推理、工具参数和第三方自定义事件不属于公开展示契约。
