"""影音服务端工具入口，当前能力仅为模型文字建议和前端画布方案。"""

from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


def build_media_tools(_: Settings) -> list[BaseTool]:
    """返回影音服务端工具集合，目前尚未注册业务工具。

    Args:
        _: 公共装配接口传入的配置，当前不使用。

    Returns:
        空列表；这不表示模型可以直接访问数据库或文件。
    """
    return []
