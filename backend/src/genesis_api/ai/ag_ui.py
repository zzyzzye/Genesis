"""将已授权的任务展示快照适配为 AG-UI，不改变 Agent 执行与恢复机制。"""

from __future__ import annotations

from ag_ui.core import (
    AssistantMessage,
    BaseEvent,
    EventType,
    MessagesSnapshotEvent,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from ag_ui.encoder import EventEncoder

from genesis_api.ai.models import AiChatRunStatus
from genesis_api.ai.schemas import AiChatRunSnapshot


class AgUiRunStream:
    """为单个订阅投影事件；重连先覆盖快照，后续才追加增量。

    工具参数和原始结果不进入协议，只输出 ToolCallHistory 已脱敏的展示信息。
    每个订阅持有独立游标，连接断开不会改变后台任务。
    """

    def __init__(self, run_id: str) -> None:
        """使用任务 ID 关联消息，避免订阅时额外暴露内部 checkpoint ID。"""
        self.run_id = run_id
        self.message_id = f"{run_id}:assistant"
        self._content: str | None = None
        self._state: dict[str, object] | None = None
        self._tools: set[str] = set()
        self._results: set[str] = set()
        self._encoder = EventEncoder()

    def encode(self, event: BaseEvent) -> str:
        """复用官方编码器，所有输出均为经过模型校验的 AG-UI 事件。"""
        return str(self._encoder.encode(event))

    def project(self, snapshot: AiChatRunSnapshot) -> list[BaseEvent]:
        """从展示快照生成正文、工具与业务状态事件。

        Args:
            snapshot: 已按当前用户筛选且不含内部请求载荷的任务快照。

        Returns:
            有序 AG-UI 事件；终态事件必须位于正文和业务状态之后。
        """
        events: list[BaseEvent] = []
        thread_id = str(snapshot.conversation_id or self.run_id)
        metadata = {"genesis": {"sequence": snapshot.sequence}}
        if self._content is None:
            events.append(RunStartedEvent(
                type=EventType.RUN_STARTED, thread_id=thread_id, run_id=self.run_id,
            ))
        if self._content is None or not snapshot.content.startswith(self._content):
            # 重连或 checkpoint 重算时整段替换，不能在旧回答后重复追加。
            if self._content is not None:
                events.append(TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END, message_id=self.message_id,
                ))
            events.append(MessagesSnapshotEvent(
                type=EventType.MESSAGES_SNAPSHOT,
                messages=[AssistantMessage(
                    id=self.message_id, role="assistant", content=snapshot.content,
                )],
                metadata=metadata,
            ))
            events.append(TextMessageStartEvent(
                type=EventType.TEXT_MESSAGE_START, message_id=self.message_id, role="assistant",
            ))
        elif snapshot.content != self._content:
            events.append(TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT, message_id=self.message_id,
                delta=snapshot.content[len(self._content):], metadata=metadata,
            ))
        self._content = snapshot.content

        state: dict[str, object] = {
            "sequence": snapshot.sequence,
            "status": snapshot.status.value,
            "metrics": snapshot.metrics.model_dump(mode="json") if snapshot.metrics else None,
            "billing": snapshot.billing,
            "proposals": [item.model_dump(mode="json") for item in snapshot.proposals],
            "tool_calls": [item.model_dump(mode="json") for item in snapshot.tool_calls],
        }
        if state != self._state:
            events.append(StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT, snapshot={"genesis": state},
            ))
            self._state = state

        for call in snapshot.tool_calls:
            call_id = str(call.id)
            if call_id not in self._tools:
                events.extend([
                    ToolCallStartEvent(
                        type=EventType.TOOL_CALL_START, tool_call_id=call_id,
                        tool_call_name=call.name, parent_message_id=self.message_id,
                    ),
                    # END 表示参数流结束；工具是否完成以 RESULT 和展示状态为准。
                    ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=call_id),
                ])
                self._tools.add(call_id)
            if call.status != "running" and call_id not in self._results:
                events.append(ToolCallResultEvent(
                    type=EventType.TOOL_CALL_RESULT, tool_call_id=call_id,
                    message_id=f"{self.run_id}:tool:{call_id}", role="tool",
                    content=call.result_summary or call.label,
                ))
                self._results.add(call_id)

        if snapshot.status in (AiChatRunStatus.COMPLETED, AiChatRunStatus.FAILED):
            events.append(TextMessageEndEvent(
                type=EventType.TEXT_MESSAGE_END, message_id=self.message_id,
            ))
            if snapshot.status is AiChatRunStatus.FAILED:
                events.append(RunErrorEvent(
                    type=EventType.RUN_ERROR, message=snapshot.error or "AI 生成失败",
                ))
            else:
                events.append(RunFinishedEvent(
                    type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=self.run_id,
                ))
        return events
