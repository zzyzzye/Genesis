from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import UUID

from genesis_api.identity.models import UserRole


@dataclass(frozen=True)
class AgentInvocation:
    """单次 Agent 执行的可信身份与页面位置。"""

    actor_id: UUID
    actor_role: str
    module: str


_invocation: contextvars.ContextVar[AgentInvocation | None] = contextvars.ContextVar(
    "genesis_agent_invocation", default=None
)


@contextmanager
def agent_invocation_context(
    actor_id: UUID, actor_role: str, module: str
) -> Iterator[None]:
    """隔离并发调用的用户和模块上下文。"""
    token = _invocation.set(AgentInvocation(actor_id, actor_role, module))
    try:
        yield
    finally:
        _invocation.reset(token)


def require_owner(*, module: str | None = None) -> UUID:
    invocation = _invocation.get()
    if invocation is None or invocation.actor_role != UserRole.OWNER.value:
        raise RuntimeError("Agent 工具需要站点所有者权限")
    if module is not None and invocation.module != module:
        raise RuntimeError(f"当前 Agent 不在 {module} 模块")
    return invocation.actor_id
