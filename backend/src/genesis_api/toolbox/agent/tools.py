"""工具箱服务端工具入口，不用占位工具模拟未实现的业务能力。"""

from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


def build_toolbox_tools(_: Settings) -> list[BaseTool]:
    """返回工具箱工具集合，当前没有可执行的业务工具。

    Args:
        _: 公共装配接口传入的配置，当前不使用。

    Returns:
        空列表，模型只能提供提示词允许的文字建议。
    """
    return []
