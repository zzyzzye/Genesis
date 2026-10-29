"""Agent 写操作的提议与确认契约，签名载荷是执行依据。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AgentResourceReference(BaseModel):
    """工具创建资源的最小关联；仅允许标识，不携带原始业务载荷。"""

    model_config = ConfigDict(extra="forbid")

    module: str = Field(min_length=1, max_length=32)
    kind: str = Field(min_length=1, max_length=64)
    id: UUID
    scope_id: UUID
    parent_id: UUID | None = None


class AgentActionProposal(BaseModel):
    """待确认操作的展示协议；确认执行时以签名令牌内的载荷为准。"""

    type: Literal["pending_action"] = "pending_action"
    proposal_id: UUID
    module: str
    action: str
    payload: dict[str, object]
    summary: str
    requires_confirmation: Literal[True] = True
    expires_at: datetime
    proposal_token: str
    executed: bool = False
    execution_result: dict[str, object] | None = None


class AgentActionConfirmation(BaseModel):
    """只接收提议令牌，避免客户端另行提交可替换原提议的操作载荷。"""

    proposal_token: str = Field(min_length=1)
