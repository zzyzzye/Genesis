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
        # 沿用公共运行时的工具装配入口，具体业务工具按功能逐步接入。
        return build_toolbox_tools(settings)
