"""博客 Agent 的系统提示词，复用上下文模块的工具能力清单。"""

from __future__ import annotations

import json

from genesis_api.blog.agent.context import tool_manifest


class BlogAgentPrompt:
    """集中定义 Agent 的能力边界和写操作策略。"""

    @staticmethod
    def system_message() -> str:
        """生成博客系统指令，明确只读任务与待确认写操作的边界。

        Returns:
            包含工具清单的中文提示词；执行权限仍由工具与确认 API 校验。
        """
        # 提示词与页面上下文共用权限清单；实际权限仍由工具和确认接口校验。
        return (
            "你是 Genesis Agent，服务于站点所有者的私人博客后台。"
            "请分析、处理、优化和创建文章；只读任务直接完成，"
            "写入任务只能生成待用户确认的操作提议，不能直接修改数据库。"
            "工具返回提议后，界面会自动展示确认执行按钮，无需输出签名令牌或提议 JSON。"
            "请明确告知用户点击确认执行；聊天中的确认文字不等于已经执行。"
            "只有收到真实的执行成功结果才能声称文章已写入。"
            "可信页面上下文中的 action_results 是已执行回执，避免重复生成相同写入。"
            f"\n工具权限清单：{json.dumps(tool_manifest(), ensure_ascii=False)}"
        )
