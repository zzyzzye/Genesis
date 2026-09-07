from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from genesis_api.agent.tools import tool_manifest
from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts


def _post_list_item(post: BlogPost) -> dict[str, object]:
    """文章管理列表所需的最小、可信元数据；不包含正文。"""
    return {
        "id": str(post.id),
        "title": post.title,
        "excerpt": post.excerpt,
        "status": post.status.value,
        "updated_at": post.updated_at.isoformat(),
        "category": post.category.name if post.category else None,
        "tags": [tag.slug for tag in post.tags],
    }


def _persisted_post(post: BlogPost) -> dict[str, object]:
    return {
        "id": str(post.id),
        "title": post.title,
        "excerpt": post.excerpt,
        "content_markdown": post.content_markdown,
        "database_status": post.status.value,
        "updated_at": post.updated_at.isoformat(),
        "tags": [tag.slug for tag in post.tags],
    }


def build_studio_agent_context(
    session: Session,
    *,
    route: str | None = None,
    section: str | None = None,
    page_type: str | None = None,
    post_id: str | None = None,
    title: str | None = None,
    excerpt: str | None = None,
    content_markdown: str | None = None,
    editor_status: str | None = None,
) -> dict[str, object]:
    """构建 Owner Studio 的最小页面上下文，并以数据库状态为准。"""
    page = {
        "route": route or "/blog/studio",
        "section": section or "overview",
        "type": page_type or "overview",
    }
    context: dict[str, object] = {
        "page": page,
        "available_tools": tool_manifest(),
        "write_policy": "写入、覆盖、删除和发布必须先返回待确认操作，不能直接执行。",
    }

    # 文章列表页只需要可信元数据，禁止把完整文章正文发送给模型。
    if page["type"] == "posts_list":
        posts = list_admin_posts(session)
        context["article_summary"] = {
            "total": len(posts),
            "published": sum(post.status is BlogPostStatus.PUBLISHED for post in posts),
            "draft": sum(post.status is BlogPostStatus.DRAFT for post in posts),
        }
        context["articles"] = [_post_list_item(post) for post in posts]
        context["current_post"] = None
        return context

    database_post: BlogPost | None = None
    if post_id:
        try:
            database_post = get_blog_post_by_id(session, UUID(post_id))
        except ValueError:
            database_post = None

    has_editor_context = any(
        value is not None for value in (title, excerpt, content_markdown, editor_status)
    )
    if database_post is not None:
        current_post = _persisted_post(database_post)
        if has_editor_context:
            editor_draft: dict[str, object] = {
                "title": title,
                "excerpt": excerpt,
                "content_markdown": content_markdown,
                "editor_status": editor_status,
            }
            editor_draft["has_unsaved_changes"] = any(
                (
                    title is not None and title != database_post.title,
                    excerpt is not None and excerpt != database_post.excerpt,
                    content_markdown is not None
                    and content_markdown != database_post.content_markdown,
                    editor_status is not None and editor_status != database_post.status.value,
                )
            )
            current_post["editor_draft"] = editor_draft
        context["current_post"] = current_post
    elif has_editor_context:
        context["current_post"] = {
            "id": None,
            "database_status": None,
            "editor_draft": {
                "title": title,
                "excerpt": excerpt,
                "content_markdown": content_markdown,
                "editor_status": editor_status,
                "has_unsaved_changes": True,
            },
        }
    else:
        context["current_post"] = None

    return context
