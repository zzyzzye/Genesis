from __future__ import annotations

from langchain_core.tools import BaseTool
from sqlalchemy.orm import Session

from genesis_api.blog.agent.actions import BLOG_ACTIONS, confirm_blog_action
from genesis_api.blog.agent.prompt import BlogAgentPrompt
from genesis_api.blog.agent.tools import build_blog_tools
from genesis_api.core.config import Settings
from genesis_api.identity.models import User


class BlogAgentCapability:
    """向公共运行时提供博客能力；图编排和模型初始化由运行时负责。"""

    module = "blog"
    name = "genesis-blog-agent"

    @staticmethod
    def system_prompt() -> str:
        return BlogAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        return build_blog_tools(settings)

    @staticmethod
    def handles_action(action: str) -> bool:
        return action in BLOG_ACTIONS

    @staticmethod
    def confirm_action(
        action: str, payload: dict[str, object], *, current_user: User, session: Session
    ) -> object:
        # 确认请求由公共 API 校验身份和提议令牌，此处只分派博客业务写入。
        return confirm_blog_action(action, payload, current_user=current_user, session=session)
