from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from jwt import InvalidTokenError, decode, encode

from genesis_api.agent.contracts import AgentContext
from genesis_api.core.config import Settings, get_settings
from genesis_api.identity.models import User, UserRole


def _unauthorized(detail: str = "Agent 内部身份无效") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


SettingsDependency = Annotated[Settings, Depends(get_settings)]

def require_agent_token(
    settings: SettingsDependency,
    token: Annotated[str | None, Header(alias="X-Genesis-Agent-Token")] = None,
) -> None:
    expected = settings.agent_internal_token
    if expected is None or token != expected.get_secret_value():
        raise _unauthorized()


def issue_agent_context(user: User, request_id: str, settings: Settings) -> str:
    now = datetime.now(UTC)
    payload = {
        "actor_id": str(user.id),
        "role": user.role.value,
        "request_id": request_id,
        "iat": now,
        "exp": now + timedelta(seconds=settings.agent_context_expire_seconds),
        "scope": ["agent:read", "agent:propose"],
    }
    return encode(payload, settings.agent_context_secret.get_secret_value(), algorithm="HS256")


def require_agent_scope(scope: str) -> Callable[[AgentContextDependency], AgentContext]:
    def dependency(context: AgentContextDependency) -> AgentContext:
        if scope not in context.scope:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Agent 上下文缺少权限：{scope}",
            )
        return context

    return dependency


def require_agent_context(
    settings: SettingsDependency,
    context_token: Annotated[str | None, Header(alias="X-Genesis-Agent-Context")] = None,
    _: None = Depends(require_agent_token),
) -> AgentContext:
    if not context_token:
        raise _unauthorized("缺少 Agent 上下文")
    try:
        payload = decode(
            context_token,
            settings.agent_context_secret.get_secret_value(),
            algorithms=["HS256"],
        )
        context = AgentContext.model_validate(payload)
    except (InvalidTokenError, ValueError) as exc:
        raise _unauthorized("Agent 上下文无效或已过期") from exc
    if context.role != UserRole.OWNER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要站点管理权限")
    if "agent:read" not in context.scope:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Agent 上下文权限不足")
    return context


AgentContextDependency = Annotated[AgentContext, Depends(require_agent_context)]
