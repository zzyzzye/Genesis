from __future__ import annotations

import json
from typing import Any


class AgentPrompt:
    """负责把 Agent 能力边界注入模型，而不把业务规则散落在路由里。"""

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
