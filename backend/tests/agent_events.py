"""读取验收事件中的当前回复，不把历史消息或工具原文当作正文。"""

from collections.abc import Sequence

from ag_ui.core import CustomEvent, MessagesSnapshotEvent, TextMessageContentEvent


def public_text(events: Sequence[object]) -> str:
    """优先检查官方最终快照，同时保留业务澄清事件。"""
    snapshots = [event for event in events if isinstance(event, MessagesSnapshotEvent)]
    content = "".join(
        message.content or "" for message in snapshots[-1].messages
        if message.role == "assistant" and (message.metadata or {}).get("genesis", {}).get("run_id")
    ) if snapshots else "".join(
        event.delta for event in events if isinstance(event, TextMessageContentEvent)
    )
    return content + "".join(
        str(event.value["content"]) for event in events
        if isinstance(event, CustomEvent) and event.name == "genesis.question"
    )
