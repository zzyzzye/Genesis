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
        return MediaAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        # 画布方案由提示词约定、前端确认应用，目前不注册服务端业务写工具。
        return build_media_tools(settings)
