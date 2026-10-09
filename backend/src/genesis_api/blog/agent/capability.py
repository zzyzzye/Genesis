"""博客能力入口：向公共注册表提供提示词、工具与确认操作的分派。"""

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
        """返回博客系统提示词，供公共运行时创建 Agent 图。"""
        return BlogAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        """构建博客工具，执行循环与并发编排交给公共运行时。

        Args:
            settings: 提议签名与有效期等工具配置。

        Returns:
            LangChain 工具列表；写工具仅生成待确认提议。
        """
        return build_blog_tools(settings)

    @staticmethod
    def handles_action(action: str) -> bool:
        """判断操作名是否属于博客可确认的写操作集合。"""
        return action in BLOG_ACTIONS

    @staticmethod
    def confirm_action(
        action: str, payload: dict[str, object], *, current_user: User, session: Session
    ) -> object:
        """转交已确认的博客写操作，不重复实现业务写入规则。

        Args:
            action: 待执行的博客操作名称。
            payload: 已验签的操作载荷。
            current_user: 公共 API 已完成认证与权限校验的用户。
            session: 业务写入使用的数据库会话。

        Returns:
            confirm_blog_action 返回的操作结果。

        Raises:
            HTTPException: 操作载荷无效或目标文章不存在。
            ValidationError: 完整文章数据不符合写入契约。
        """
        # 确认请求由公共 API 校验身份和提议令牌，此处只分派博客业务写入。
        return confirm_blog_action(action, payload, current_user=current_user, session=session)
