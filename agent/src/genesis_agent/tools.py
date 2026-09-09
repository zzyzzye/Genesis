from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from langchain_core.tools import BaseTool, tool

AgentToolMode = Literal["read", "write"]

@dataclass(frozen=True, slots=True)
class AgentTool:
    name: str
    description: str
    mode: AgentToolMode
    requires_confirmation: bool = False

BLOG_AGENT_TOOLS: tuple[AgentTool, ...] = (
    AgentTool("list_posts", "列出博客文章及其状态", "read"),
    AgentTool("get_post", "读取当前上下文中的文章内容", "read"),
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
        {"name": item.name, "description": item.description, "mode": item.mode,
         "requires_confirmation": item.requires_confirmation}
        for item in BLOG_AGENT_TOOLS
    ]


def build_blog_tools() -> list[BaseTool]:
    """构建无数据库依赖的 Agent 工具。

    数据查询由后端鉴权后注入 context；写操作只返回待确认 proposal。
    Agent 服务因此不需要访问 Genesis 数据库。
    """
    @tool
    def list_posts() -> str:
        """列出当前页面上下文中的博客文章。"""
        return "请使用当前上下文中的 articles 数据。"

    @tool
    def get_post(post_id: str) -> str:
        """读取当前页面上下文中的文章；实际正文由后端注入。"""
        return json.dumps({"type": "context_lookup", "post_id": post_id}, ensure_ascii=False)

    @tool
    def search_posts(query: str) -> str:
        """搜索当前页面上下文中的文章。"""
        return json.dumps({"type": "context_search", "query": query}, ensure_ascii=False)

    @tool
    def analyze_post(post_id: str) -> str:
        """请求模型分析上下文中的文章。"""
        return json.dumps({"type": "analysis_request", "post_id": post_id}, ensure_ascii=False)

    @tool
    def suggest_revision(post_id: str) -> str:
        """请求模型生成文章优化建议。"""
        return json.dumps({"type": "revision_request", "post_id": post_id}, ensure_ascii=False)

    @tool
    def create_draft(title: str, excerpt: str, content_markdown: str, slug: str) -> str:
        """提出创建文章草稿的操作，必须等待用户确认。"""
        return _proposal("create_draft", locals())

    @tool
    def update_post(post_id: str, changes: str) -> str:
        """提出修改文章的操作，必须等待用户确认。"""
        return _proposal("update_post", {"post_id": post_id, "changes": changes})

    @tool
    def delete_post(post_id: str) -> str:
        """提出删除文章的操作，必须等待用户确认。"""
        return _proposal("delete_post", {"post_id": post_id})

    @tool
    def publish_post(post_id: str) -> str:
        """提出发布文章的操作，必须等待用户确认。"""
        return _proposal("publish_post", {"post_id": post_id})

    return [list_posts, get_post, search_posts, analyze_post, suggest_revision,
            create_draft, update_post, delete_post, publish_post]


def _proposal(action: str, payload: dict[str, str]) -> str:
    return json.dumps({"type": "pending_action", "action": action,
                       "payload": payload, "requires_confirmation": True}, ensure_ascii=False)
