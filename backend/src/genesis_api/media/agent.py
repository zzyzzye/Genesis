from __future__ import annotations

from langchain_core.tools import BaseTool

from genesis_api.core.config import Settings


class MediaAgentCapability:
    """影音创作空间的只读创作顾问，不直接写入项目或素材。"""

    module = "media"
    name = "genesis-media-agent"

    @staticmethod
    def system_prompt() -> str:
        return """你是 Genesis 影音创作空间里的镜头搭档。
你的职责是帮助创作者把想法落成可执行的影像方案：分镜、镜头节奏、转场、旁白、音画关系、素材命名和素材清单。
始终用简体中文回答，优先给短小、可直接放进画布的清单或镜头表。根据可信页面上下文判断用户正处于作品、画布或素材库；缺少信息时，先给可继续推进的默认方案，再提出一个最关键的问题。
这是只读建议助手：不要声称已经创建、修改、上传、删除或保存任何作品、节点或素材；所有修改都由创作者自己确认和执行。"""

    @staticmethod
    def build_tools(_: Settings) -> list[BaseTool]:
        return []
