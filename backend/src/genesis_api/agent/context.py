"""用 ContextVar 隔离 Agent 调用身份，防止并发工具串用用户与业务模块。"""

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
    """在当前执行上下文中绑定可信身份，退出时恢复外层绑定。

    Args:
        actor_id: 服务端认证的用户 UUID。
        actor_role: 数据库中的用户角色，不接受模型参数授予权限。
        module: 本次执行所属的业务模块。

    Yields:
        不产出业务值；with 块及传播上下文的工作线程可读取该绑定。
    """
    token = _invocation.set(AgentInvocation(actor_id, actor_role, module))
    try:
        yield
    finally:
        # 即使工具异常或执行取消，也恢复外层上下文，避免身份泄漏到后续调用。
        _invocation.reset(token)


def require_owner(*, module: str | None = None) -> UUID:
    """校验运行时注入的所有者身份及可选模块限制。

    Args:
        module: 要求的业务模块；None 表示只检查所有者身份。

    Returns:
        当前所有者的 UUID，供工具绑定操作归属。

    Raises:
        RuntimeError: 未绑定身份、不是所有者或模块不匹配。
    """
    invocation = _invocation.get()
    if invocation is None or invocation.actor_role != UserRole.OWNER.value:
        raise RuntimeError("Agent 工具需要站点所有者权限")
    if module is not None and invocation.module != module:
        raise RuntimeError(f"当前 Agent 不在 {module} 模块")
    return invocation.actor_id
