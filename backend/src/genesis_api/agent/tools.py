from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AgentToolMode = Literal["read", "write"]


@dataclass(frozen=True, slots=True)
class AgentTool:
    name: str
    description: str
    mode: AgentToolMode
    requires_confirmation: bool = False


BLOG_AGENT_TOOLS: tuple[AgentTool, ...] = (
    AgentTool("list_posts", "列出博客文章及其状态", "read"),
    AgentTool("get_post", "读取一篇文章的完整内容", "read"),
    AgentTool("search_posts", "按标题、摘要、正文和标签搜索文章", "read"),
    AgentTool("analyze_post", "分析文章结构、表达和内容质量", "read"),
    AgentTool("suggest_revision", "生成文章优化建议或完整修改稿", "read"),
    AgentTool("create_draft", "创建一篇新的文章草稿", "write", True),
    AgentTool("update_post", "修改现有文章内容或元数据", "write", True),
    AgentTool("delete_post", "删除文章", "write", True),
    AgentTool("publish_post", "发布文章", "write", True),
)


def tool_manifest() -> list[dict[str, str | bool]]:
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "mode": tool.mode,
            "requires_confirmation": tool.requires_confirmation,
        }
        for tool in BLOG_AGENT_TOOLS
    ]
