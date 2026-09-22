from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AgentActionProposal(BaseModel):
    type: Literal["pending_action"] = "pending_action"
    proposal_id: UUID
    module: str
    action: str
    payload: dict[str, object]
    summary: str
    requires_confirmation: Literal[True] = True
    expires_at: datetime
    proposal_token: str


class AgentActionConfirmation(BaseModel):
    proposal_token: str = Field(min_length=1)
