from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from genesis_api.agent.tools import tool_manifest
from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts


def build_studio_agent_context(
    session: Session,
    *,
    post_id: str | None = None,
    title: str | None = None,
    excerpt: str | None = None,
    content_markdown: str | None = None,
) -> dict[str, object]:
    """构建只供 Owner Agent 使用的博客工作区上下文。"""
    articles = [
        {
            "id": str(post.id),
            "title": post.title,
            "excerpt": post.excerpt,
            "content_markdown": post.content_markdown,
            "status": post.status.value,
            "tags": [tag.slug for tag in post.tags],
        }
        for post in list_admin_posts(session)
    ]
    current_post: dict[str, object] | None = None
    if post_id:
        try:
            post = get_blog_post_by_id(session, UUID(post_id))
        except ValueError:
            post = None
        if post:
            current_post = {
                "id": str(post.id),
                "title": post.title,
                "excerpt": post.excerpt,
                "content_markdown": post.content_markdown,
                "status": post.status.value,
            }

    has_editor_context = any(value is not None for value in (title, excerpt, content_markdown))
    if current_post is None and has_editor_context:
        current_post = {
            "id": post_id,
            "title": title,
            "excerpt": excerpt,
            "content_markdown": content_markdown,
        }

    return {
        "articles": articles,
        "current_post": current_post,
        "available_tools": tool_manifest(),
        "write_policy": "写入、覆盖、删除和发布必须先返回待确认操作，不能直接执行。",
    }
