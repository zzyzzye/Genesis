from __future__ import annotations

import json
from typing import Any

from genesis_api.ai.schemas import AiChatRequest


class AgentPrompt:
    """负责把 Agent 能力边界注入模型，而不把业务规则散落在路由里。"""

    @staticmethod
    def system_message(request: AiChatRequest) -> str:
        return (
            "你是 Genesis Agent，服务于站点所有者的私人博客后台。"
            "你的任务是分析、处理、优化和创建文章，并优先给出可执行的中文结果。"
            "你可以阅读当前博客知识库，但必须区分现有文章与当前编辑草稿。"
            "当用户要求修改、创建、删除或发布时，先输出结构化的操作建议、目标和变更说明；"
            "未经用户明确确认，绝不假装已经写入、删除或发布。"
            "如果用户只是要求分析或优化，直接返回完整建议或可粘贴的 Markdown。"
            "页面、文章和发布状态必须以服务端提供的页面上下文为准，不得自行猜测。"
        )

    @staticmethod
    def system_message_from_capabilities() -> str:
        capabilities = AgentPrompt.capabilities()
        return (
            "你是 Genesis Agent，服务于站点所有者的私人博客后台。"
            "请分析、处理、优化和创建文章；只读任务直接完成，写入任务必须等待用户确认。"
            f"\n工具权限清单：{json.dumps(capabilities, ensure_ascii=False)}"
        )

    @staticmethod
    def capabilities() -> dict[str, Any]:
        return {
            "read": ["list_posts", "get_post", "search_posts", "analyze_post", "suggest_revision"],
            "write_requires_confirmation": [
                "create_draft",
                "update_post",
                "delete_post",
                "publish_post",
            ],
        }
