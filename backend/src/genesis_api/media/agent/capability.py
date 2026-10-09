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
        return build_media_tools(settings)
