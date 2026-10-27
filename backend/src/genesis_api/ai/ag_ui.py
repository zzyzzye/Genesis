"""仅为接入官方事件日志前的历史终态任务构建静态消息快照。"""

from __future__ import annotations

from ag_ui.core import (
    AssistantMessage,
    EventType,
    FunctionCall,
    Message,
    MessagesSnapshotEvent,
    ToolCall,
    ToolMessage,
    UserMessage,
)

from genesis_api.ai.schemas import AiChatRunSnapshot


def legacy_snapshot(snapshot: AiChatRunSnapshot) -> MessagesSnapshotEvent:
    """读取既有安全展示记录，不模拟模型增量或工具生命周期。"""
    messages: list[Message] = []
    current = str(snapshot.id)
    for index, item in enumerate(snapshot.history):
        if item.role == "user":
            messages.append(UserMessage(id=f"{item.run_id}:user:{index}", content=item.content))
        elif str(item.run_id) != current:
            messages.append(AssistantMessage(id=f"{item.run_id}:assistant", content=item.content))
    calls = snapshot.tool_calls
    messages.append(AssistantMessage(
        id=f"{current}:assistant", content=snapshot.content,
        metadata={"genesis": {"run_id": current}},
        tool_calls=[ToolCall(
            id=str(call.id), function=FunctionCall(name=call.name, arguments="{}"),
            metadata={"genesis": call.model_dump(
                mode="json", exclude={"id", "protocol_id", "name", "result_summary"},
            )},
        ) for call in calls],
    ))
    messages.extend(ToolMessage(
        id=f"{current}:tool:{call.id}", tool_call_id=str(call.id),
        content=call.result_summary or call.label,
    ) for call in calls if call.status != "running")
    return MessagesSnapshotEvent(type=EventType.MESSAGES_SNAPSHOT, messages=messages)
