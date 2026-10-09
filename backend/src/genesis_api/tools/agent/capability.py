from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings
from genesis_api.tools.agent.prompt import ToolsAgentPrompt
from genesis_api.tools.agent.tools import build_tools_tools


class ToolsAgentCapability:
    """工具集模块的 Agent 能力入口。"""

    module = "tools"
    name = "genesis-tools-agent"

    @staticmethod
    def system_prompt() -> str:
        return ToolsAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        return build_tools_tools(settings)
