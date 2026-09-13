from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from langchain_core.tools import BaseTool, tool

from genesis_agent.backend_client import BackendApiClient

AgentToolMode = Literal["read", "write"]

@dataclass(frozen=True, slots=True)
class AgentTool:
    name: str
    description: str
    mode: AgentToolMode
    requires_confirmation: bool = False

BLOG_AGENT_TOOLS: tuple[AgentTool, ...] = (
    AgentTool("list_posts", "列出博客文章及其状态", "read"),
    AgentTool("get_post", "读取文章的完整内容", "read"),
    AgentTool("search_posts", "按标题、摘要、正文和标签搜索文章", "read"),
    AgentTool("analyze_post", "获取文章分析上下文", "read"),
    AgentTool("suggest_revision", "获取文章改写上下文", "read"),
    AgentTool("create_draft", "创建一篇新的文章草稿", "write", True),
    AgentTool("update_post", "修改现有文章内容或元数据", "write", True),
    AgentTool("delete_post", "删除文章", "write", True),
    AgentTool("publish_post", "发布文章", "write", True),
)


def tool_manifest() -> list[dict[str, str | bool]]:
    return [
        {
            "name": item.name,
            "description": item.description,
            "mode": item.mode,
            "requires_confirmation": item.requires_confirmation,
        }
        for item in BLOG_AGENT_TOOLS
    ]


def build_blog_tools() -> list[BaseTool]:
    client = BackendApiClient()

    @tool
    async def list_posts() -> str:
        """通过 Genesis Backend API 列出博客文章。"""
        return await client.get("/api/v1/internal/agent/posts")

    @tool
    async def get_post(post_id: str) -> str:
        """通过 Genesis Backend API 读取指定文章。"""
        return await client.get(f"/api/v1/internal/agent/posts/{post_id}")

    @tool
    async def search_posts(query: str) -> str:
        """通过 Genesis Backend API 搜索文章。"""
        return await client.get("/api/v1/internal/agent/posts/search", params={"query": query})

    @tool
    async def analyze_post(post_id: str) -> str:
        """通过 Genesis Backend API 获取文章分析上下文。"""
        return await client.get(f"/api/v1/internal/agent/posts/{post_id}/context")

    @tool
    async def suggest_revision(post_id: str) -> str:
        """通过 Genesis Backend API 获取文章改写上下文。"""
        return await client.get(f"/api/v1/internal/agent/posts/{post_id}/context")

    @tool
    async def create_draft(title: str, excerpt: str, content_markdown: str, slug: str) -> str:
        """提出创建草稿的操作，必须等待用户确认。"""
        return await client.preview(
            "create_draft",
            {"title": title, "excerpt": excerpt, "content_markdown": content_markdown, "slug": slug},
        )

    @tool
    async def update_post(post_id: str, changes: str) -> str:
        """提出修改文章的操作，必须等待用户确认。"""
        return await client.preview("update_post", {"post_id": post_id, "changes": changes})

    @tool
    async def delete_post(post_id: str) -> str:
        """提出删除文章的操作，必须等待用户确认。"""
        return await client.preview("delete_post", {"post_id": post_id})

    @tool
    async def publish_post(post_id: str) -> str:
        """提出发布文章的操作，必须等待用户确认。"""
        return await client.preview("publish_post", {"post_id": post_id})

    return [
        list_posts,
        get_post,
        search_posts,
        analyze_post,
        suggest_revision,
        create_draft,
        update_post,
        delete_post,
        publish_post,
    ]
