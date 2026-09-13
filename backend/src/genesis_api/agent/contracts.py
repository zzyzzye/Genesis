from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

AgentScope = Literal["agent:read", "agent:propose"]
AgentAction = Literal["create_draft", "update_post", "delete_post", "publish_post"]


class AgentContext(BaseModel):
    actor_id: UUID
    role: str
    request_id: str
    issued_at: datetime
    expires_at: datetime
    scope: tuple[AgentScope, ...] = ("agent:read", "agent:propose",)


class AgentPostSummary(BaseModel):
    id: UUID
    title: str
    excerpt: str
    status: str
    updated_at: datetime
    category: str | None = None
    tags: list[str] = Field(default_factory=list)


class AgentPostDetail(AgentPostSummary):
    content_markdown: str
    slug: str


class AgentActionPreviewRequest(BaseModel):
    action: AgentAction
    payload: dict[str, object] = Field(default_factory=dict)


class AgentActionProposal(BaseModel):
    type: Literal["pending_action"] = "pending_action"
    proposal_id: UUID
    action: AgentAction
    payload: dict[str, object]
    summary: str
    requires_confirmation: Literal[True] = True
    expires_at: datetime
    proposal_token: str


class AgentActionConfirmation(BaseModel):
    proposal_token: str = Field(min_length=1)
