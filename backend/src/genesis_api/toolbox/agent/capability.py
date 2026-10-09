"""工具箱 Agent 的能力装配入口，当前仅提供文字建议。"""

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
        """返回工具箱系统提示词，不宣称具备尚未接入的工具执行能力。"""
        return ToolboxAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        """取得工具箱工具集合，保持与公共能力装配接口一致。

        Args:
            settings: 公共运行时传入的配置，当前工具入口尚未使用。

        Returns:
            当前为空列表，后续业务工具由对应完整功能接入。
        """
        # 沿用公共运行时的工具装配入口，具体业务工具按功能逐步接入。
        return build_toolbox_tools(settings)
