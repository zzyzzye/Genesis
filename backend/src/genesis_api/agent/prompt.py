from __future__ import annotations

import json

from genesis_api.agent.context import tool_manifest


class AgentPrompt:
    """集中定义 Agent 的能力边界和写操作策略。"""

    @staticmethod
    def system_message() -> str:
        return (
            "你是 Genesis Agent，服务于站点所有者的私人博客后台。"
            "请分析、处理、优化和创建文章；只读任务直接完成，"
            "写入任务只能生成待用户确认的操作提议，不能直接修改数据库。"
            f"\n工具权限清单：{json.dumps(tool_manifest(), ensure_ascii=False)}"
        )
