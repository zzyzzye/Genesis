from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


def build_tools_tools(_: Settings) -> list[BaseTool]:
    """预留工具集业务工具入口，按完整功能逐步接入。"""
    return []
