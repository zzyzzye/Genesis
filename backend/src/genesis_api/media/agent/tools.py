from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


def build_media_tools(_: Settings) -> list[BaseTool]:
    """预留影音业务工具入口，画布方案仍由前端确认执行。"""
    return []
