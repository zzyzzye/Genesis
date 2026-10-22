"""通过 LangChain 原生回调记录工具调用的安全展示摘要，不保存参数值或原始结果。"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import UTC, datetime
from time import monotonic
from typing import Any, Literal
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import ToolMessage
from pydantic import BaseModel, Field

from genesis_api.agent.tool_inputs import tool_input_error_summary


class AgentToolCall(BaseModel):
    """单次真实工具调用的展示投影；回调 ID 区分并行调用及恢复后的新尝试。"""

    id: UUID
    name: str
    label: str
    status: Literal["running", "succeeded", "failed", "awaiting_confirmation", "interrupted"]
    started_at: datetime
    duration_ms: int | None = None
    input_summary: str = "无参数"
    result_summary: str | None = None
    proposal_id: UUID | None = None
    parameter_names: list[str] = Field(default_factory=list)


_FRAMEWORK_LABELS = {
    "read_file": "读取文件",
    "write_file": "写入文件",
    "edit_file": "编辑文件",
    "ls": "浏览文件",
    "glob": "查找文件",
    "grep": "搜索内容",
    "write_todos": "更新任务清单",
    "task": "执行子任务",
    "ask_user_question": "请求补充信息",
}


class ToolCallHistory(AsyncCallbackHandler):
    """观察工具生命周期，执行与恢复仍由框架负责。

    Args:
        on_change: 每次开始或结束时接收完整单项快照；调用方负责持久化。
            不接收工具原始输入、异常文本或结果，避免把敏感内容复制到展示历史。
    """

    def __init__(
        self,
        on_change: Callable[[AgentToolCall], Awaitable[None]] | None = None,
    ) -> None:
        """为本次生成创建独立观察器，不跨用户或任务共享内存。"""
        self.on_change = on_change
        self._calls: dict[UUID, AgentToolCall] = {}
        self._started: dict[UUID, float] = {}

    async def _publish(self, call: AgentToolCall) -> None:
        """更新本地投影并等待调用方保存，保证开始记录先于结束记录。"""
        self._calls[call.id] = call
        if self.on_change is not None:
            await self.on_change(call)

    async def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """记录真实开始时间，只保留工具定义和合法参数名称。"""
        name = str(serialized.get("name", "tool"))[:128]
        description = str(serialized.get("description") or "").strip().splitlines()
        label = _FRAMEWORK_LABELS.get(name) or (
            description[0].rstrip("。.")[:60] if description else "调用工具"
        )
        names = [key for key in (inputs or {}) if re.fullmatch(r"[A-Za-z_]\w{0,63}", key)]
        self._started[run_id] = monotonic()
        await self._publish(
            AgentToolCall(
                id=run_id,
                name=name,
                label=label,
                status="running",
                started_at=datetime.now(UTC),
                parameter_names=names[:20],
                input_summary=f"{len(names)} 项参数" if names else "无参数",
            )
        )

    async def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        """根据原生 ToolMessage 判断成功、参数错误与等待确认，不展示原始结果。"""
        call = self._calls.get(run_id)
        if call is None:
            return
        failed = isinstance(output, ToolMessage) and output.status == "error"
        content = output.content if isinstance(output, ToolMessage) else output
        data = content
        if isinstance(content, str):
            try:
                data = json.loads(content)
            except (ValueError, TypeError):
                data = None
        status: Literal["succeeded", "failed", "awaiting_confirmation"] = (
            "failed" if failed else "succeeded"
        )
        summary = "工具执行失败，助手可继续处理" if failed else "工具执行完成"
        if failed:
            summary = tool_input_error_summary(data) or summary
        proposal_id = None
        if not failed and isinstance(data, dict) and data.get("type") == "pending_action":
            with suppress(ValueError):
                proposal_id = UUID(str(data.get("proposal_id")))
            if data.get("executed") is True:
                summary = "操作已执行"
            else:
                status, summary = "awaiting_confirmation", "操作提议已生成，等待确认"
        elif not failed and isinstance(data, list):
            summary = f"返回 {len(data)} 项结果"
        elif not failed and isinstance(content, str):
            summary = f"已返回结果（{len(content):,} 字符）"
        await self._finish(run_id, status=status, result_summary=summary, proposal_id=proposal_id)

    async def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        """保留失败或中断状态，异常原文仅由原有执行链路处理。"""
        await self._finish(
            run_id,
            status="interrupted" if not isinstance(error, Exception) else "failed",
            result_summary="调用未完成" if not isinstance(error, Exception) else "工具执行失败",
        )

    async def _finish(self, run_id: UUID, **changes: Any) -> None:
        """结束单项调用；用单调时钟计算真实耗时，不猜测跨进程时长。"""
        call = self._calls.get(run_id)
        if call is None:
            return
        duration = round(max(0, monotonic() - self._started[run_id]) * 1000)
        await self._publish(call.model_copy(update={"duration_ms": duration, **changes}))
