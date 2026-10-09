"""影音 Agent 的能力装配入口，复用公共运行时创建图。"""

from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings
from genesis_api.media.agent.prompt import MediaAgentPrompt
from genesis_api.media.agent.tools import build_media_tools


class MediaAgentCapability:
    """影音模块的 Agent 能力入口。"""

    module = "media"
    name = "genesis-media-agent"

    @staticmethod
    def system_prompt() -> str:
        """返回包含画布方案格式与执行边界的影音系统提示词。"""
        return MediaAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        """取得影音业务工具，目前不提供服务端写工具。

        Args:
            settings: 公共能力装配传入的配置，当前工具入口尚未使用。

        Returns:
            当前为空列表；画布方案由前端在用户确认后应用。
        """
        # 画布方案由提示词约定、前端确认应用，目前不注册服务端业务写工具。
        return build_media_tools(settings)
