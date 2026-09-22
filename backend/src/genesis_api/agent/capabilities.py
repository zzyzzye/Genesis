from __future__ import annotations

from dataclasses import dataclass

from langchain_core.tools import BaseTool
from sqlalchemy.orm import Session

from genesis_api.blog.agent.capability import BlogAgentCapability
from genesis_api.core.config import Settings
from genesis_api.identity.models import User


@dataclass(frozen=True)
class ResolvedAgentCapability:
    module: str
    name: str
    prompt: str
    tools: list[BaseTool]


class AgentCapabilityRegistry:
    """应用组合入口：业务模块拥有能力，运行时只负责按位置装配。"""

    def __init__(self) -> None:
        self._blog = BlogAgentCapability()

    def resolve(self, module: str, settings: Settings) -> ResolvedAgentCapability:
        if module == self._blog.module:
            return ResolvedAgentCapability(
                module=self._blog.module,
                name=self._blog.name,
                prompt=self._blog.system_prompt(),
                tools=self._blog.build_tools(settings),
            )
        raise ValueError(f"模块 {module} 尚未提供 Agent 能力")

    def confirm_action(
        self, module: str, action: str, payload: dict[str, object], *,
        current_user: User, session: Session
    ) -> object:
        if module == self._blog.module and self._blog.handles_action(action):
            return self._blog.confirm_action(
                action, payload, current_user=current_user, session=session
            )
        raise ValueError("操作类型无效")


agent_capabilities = AgentCapabilityRegistry()
