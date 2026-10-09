"""按业务模块装配 Agent 能力，集中分派用户确认后的业务操作。"""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.tools import BaseTool
from sqlalchemy.orm import Session

from genesis_api.blog.agent.capability import BlogAgentCapability
from genesis_api.core.config import Settings
from genesis_api.identity.models import User
from genesis_api.media.agent import MediaAgentCapability
from genesis_api.toolbox.agent.capability import ToolboxAgentCapability


@dataclass(frozen=True)
class ResolvedAgentCapability:
    """运行时消费的业务能力组合，不包含用户身份或对话状态。

    Attributes:
        module: 用于图缓存与能力分派的业务模块标识。
        name: 创建 Agent 图时使用的名称。
        prompt: 当前模块的系统提示词。
        tools: LangChain 工具列表；冻结数据类不阻止列表内容被修改，调用方应只读使用。
    """

    module: str
    name: str
    prompt: str
    tools: list[BaseTool]


class AgentCapabilityRegistry:
    """按业务模块装配提示词和工具，供公共运行时创建 Agent 图。

    实例持有各模块的能力入口，不保存用户身份或对话状态。
    模块级实例 agent_capabilities 可直接导入复用，无需在调用处重复创建。
    """

    def __init__(self) -> None:
        """创建各模块的能力入口，不在此构建模型、工具或执行图。"""
        self._blog = BlogAgentCapability()
        self._media = MediaAgentCapability()
        self._toolbox = ToolboxAgentCapability()

    def resolve(self, module: str, settings: Settings) -> ResolvedAgentCapability:
        """按业务模块装配能力，不回退到其他模块的工具。

        Args:
            module: 业务模块标识，如 blog、media、toolbox。
            settings: 构建业务工具所需的应用配置。

        Returns:
            包含模块标识、Agent 名称、系统提示词和可调用工具的能力组合。

        Raises:
            ValueError: 模块尚未提供 Agent 能力。
        """
        if module == self._blog.module:
            return ResolvedAgentCapability(
                module=self._blog.module,
                name=self._blog.name,
                prompt=self._blog.system_prompt(),
                tools=self._blog.build_tools(settings),
            )
        if module == self._media.module:
            return ResolvedAgentCapability(
                module=self._media.module,
                name=self._media.name,
                prompt=self._media.system_prompt(),
                tools=self._media.build_tools(settings),
            )
        if module == self._toolbox.module:
            return ResolvedAgentCapability(
                module=self._toolbox.module,
                name=self._toolbox.name,
                prompt=self._toolbox.system_prompt(),
                tools=self._toolbox.build_tools(settings),
            )
        raise ValueError(f"模块 {module} 尚未提供 Agent 能力")

    def confirm_action(
        self,
        module: str,
        action: str,
        payload: dict[str, object],
        *,
        current_user: User,
        session: Session,
    ) -> object:
        """将用户确认的写操作分派给对应业务模块。

        调用前由公共 API 完成所有者权限与提议令牌校验；此处仅分派业务操作。

        Args:
            module: 提供该操作的业务模块标识。
            action: 待执行的业务操作名称。
            payload: 操作参数，由业务模块进一步校验。
            current_user: 公共 API 已认证并校验权限的当前用户。
            session: 当前请求的数据库会话。

        Returns:
            业务模块执行操作后返回的结果。

        Raises:
            ValueError: 模块不提供该操作。
            HTTPException: 业务参数无效、目标不存在或业务校验失败。
        """
        # 仅博客提供服务端确认写入；影音画布方案由前端确认，工具箱尚无写工具。
        if module == self._blog.module and self._blog.handles_action(action):
            return self._blog.confirm_action(
                action, payload, current_user=current_user, session=session
            )
        raise ValueError("操作类型无效")


agent_capabilities = AgentCapabilityRegistry()
