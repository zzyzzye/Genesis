from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings
from genesis_api.toolbox.agent.prompt import ToolboxAgentPrompt
from genesis_api.toolbox.agent.tools import build_toolbox_tools


class ToolboxAgentCapability:
    """工具箱模块的 Agent 能力入口。"""

    module = "toolbox"
    name = "genesis-toolbox-agent"

    @staticmethod
    def system_prompt() -> str:
        return ToolboxAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        return build_toolbox_tools(settings)
