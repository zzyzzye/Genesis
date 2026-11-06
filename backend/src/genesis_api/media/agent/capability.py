"""影音 Agent 的能力装配入口，复用公共运行时创建图。"""

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
        """返回包含画布方案格式与执行边界的影音系统提示词。"""
        return MediaAgentPrompt.system_message()

    @staticmethod
    def build_tools(settings: Settings) -> list[BaseTool]:
        """取得影音画布编辑、素材引用和明确授权的图片/视频任务工具。

        Args:
            settings: 供模型目录、生图与计费复用现有服务配置。

        Returns:
            画布读取/保存、素材查询/关联、目录、参数及图片/视频提交与查询工具。
        """
        return build_media_tools(settings)
