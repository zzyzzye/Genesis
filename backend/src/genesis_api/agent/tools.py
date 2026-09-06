from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from langchain_core.tools import BaseTool, tool
from sqlalchemy.orm import Session

from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts

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
            "name": tool_definition.name,
            "description": tool_definition.description,
            "mode": tool_definition.mode,
            "requires_confirmation": tool_definition.requires_confirmation,
        }
        for tool_definition in BLOG_AGENT_TOOLS
    ]


def build_blog_tools(session: Session) -> list[BaseTool]:
    """构建绑定当前数据库会话的 LangChain 工具。

    写入工具只生成待确认操作，不直接提交数据库事务；真正的写入由后续审批服务执行。
    """

    @tool
    def list_posts() -> str:
        """列出博客文章的标题、ID、状态和更新时间。"""
        posts = list_admin_posts(session)
        return json.dumps(
            [
                {
                    "id": str(post.id),
                    "title": post.title,
                    "status": post.status.value,
                    "updated_at": post.updated_at.isoformat(),
                }
                for post in posts
            ],
            ensure_ascii=False,
        )

    @tool
    def get_post(post_id: str) -> str:
        """读取指定文章的完整内容。"""
        try:
            post = get_blog_post_by_id(session, UUID(post_id))
        except ValueError:
            post = None
        if post is None:
            return json.dumps({"error": "文章不存在"}, ensure_ascii=False)
        return json.dumps(
            {
                "id": str(post.id),
                "title": post.title,
                "excerpt": post.excerpt,
                "content_markdown": post.content_markdown,
                "status": post.status.value,
                "tags": [tag.slug for tag in post.tags],
            },
            ensure_ascii=False,
        )

    @tool
    def create_draft(title: str, excerpt: str, content_markdown: str, slug: str) -> str:
        """提出创建文章草稿的操作，必须等待用户确认。"""
        return _proposal(
            "create_draft",
            {
                "title": title,
                "excerpt": excerpt,
                "content_markdown": content_markdown,
                "slug": slug,
            },
        )

    @tool
    def update_post(post_id: str, changes: str) -> str:
        """提出修改文章的操作，changes 必须是 JSON 字符串，必须等待用户确认。"""
        return _proposal("update_post", {"post_id": post_id, "changes": changes})

    @tool
    def delete_post(post_id: str) -> str:
        """提出删除文章的操作，必须等待用户确认。"""
        return _proposal("delete_post", {"post_id": post_id})

    @tool
    def publish_post(post_id: str) -> str:
        """提出发布文章的操作，必须等待用户确认。"""
        return _proposal("publish_post", {"post_id": post_id})

    return [list_posts, get_post, create_draft, update_post, delete_post, publish_post]


def _proposal(action: str, payload: dict[str, str]) -> str:
    return json.dumps(
        {
            "type": "pending_action",
            "action": action,
            "payload": payload,
            "requires_confirmation": True,
        },
        ensure_ascii=False,
    )
