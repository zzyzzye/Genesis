from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


def build_toolbox_tools(_: Settings) -> list[BaseTool]:
    """预留工具箱业务工具入口，按完整功能逐步接入。"""
    return []
