from __future__ import annotations

import contextvars
import json
from typing import Any

import httpx

from genesis_agent.config import get_settings

_actor_context: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "genesis_agent_actor_context", default=None
)
_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "genesis_agent_request_id", default=None
)


def set_invocation_context(actor_context: str | None) -> None:
    _actor_context.set(actor_context)
    _request_id.set(None)


class BackendApiError(RuntimeError):
    """Backend Agent API 调用失败。"""


class BackendApiClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any] | list[Any]:
        headers = {
            "X-Genesis-Agent-Token": self.settings.agent_internal_token,
            "X-Genesis-Agent-Context": _actor_context.get() or "",
        }
        request_id = _request_id.get()
        if request_id:
            headers["X-Genesis-Request-ID"] = request_id
        try:
            async with httpx.AsyncClient(
                base_url=self.settings.backend_internal_url,
                timeout=self.settings.agent_http_timeout,
            ) as client:
                response = await client.request(method, path, headers=headers, **kwargs)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise BackendApiError("后端 Agent API 暂时不可用") from exc
        try:
            return response.json()
        except ValueError as exc:
            raise BackendApiError("后端 Agent API 返回格式无效") from exc

    async def get(self, path: str, **kwargs: Any) -> str:
        return json.dumps(await self.request("GET", path, **kwargs), ensure_ascii=False)

    async def preview(self, action: str, payload: dict[str, object]) -> str:
        result = await self.request(
            "POST", "/api/v1/internal/agent/actions/preview",
            json={"action": action, "payload": payload},
        )
        return json.dumps(result, ensure_ascii=False)
