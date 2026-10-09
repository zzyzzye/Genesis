"""构建博客页面参考数据，明确区分已保存记录与客户端编辑草稿。"""

from __future__ import annotations

from contextlib import suppress
from uuid import UUID

from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts


def tool_manifest() -> list[dict[str, str | bool]]:
    """生成提示词与页面上下文使用的工具能力清单。

    清单仅说明能力，不注册工具，也不授予执行权限；真实工具见 tools.py。

    Returns:
        工具名称、用途、读写模式和是否需要确认的说明列表。
    """
    return [
        {"name": name, "description": description, "mode": mode, "requires_confirmation": requires}
        for name, description, mode, requires in (
            ("list_posts", "列出博客文章及其状态", "read", False),
            ("get_post", "读取当前上下文中的文章内容", "read", False),
            ("search_posts", "按标题、摘要、正文和标签搜索文章", "read", False),
            ("analyze_post", "分析文章结构、表达和内容质量", "read", False),
            ("suggest_revision", "生成文章优化建议或完整修改稿", "read", False),
            ("create_draft", "创建一篇新的文章草稿", "write", True),
            ("update_post", "修改现有文章内容或元数据", "write", True),
            ("delete_post", "删除文章", "write", True),
            ("publish_post", "发布文章", "write", True),
        )
    ]


def _post_list_item(post: BlogPost) -> dict[str, object]:
    """将文章转为列表上下文摘要，不携带正文。

    Args:
        post: 已加载分类与标签的文章实体。

    Returns:
        可 JSON 序列化的摘要，UUID 与更新时间转换为字符串。
    """
    return {
        "id": str(post.id), "title": post.title, "excerpt": post.excerpt,
        "status": post.status.value, "updated_at": post.updated_at.isoformat(),
        "category": post.category.name if post.category else None,
        "tags": [tag.slug for tag in post.tags],
    }


def _persisted_post(post: BlogPost) -> dict[str, object]:
    """提取数据库中已保存的文章内容，作为编辑草稿的比较基线。

    Args:
        post: 已加载标签的文章实体。

    Returns:
        包含正文与 database_status 的已保存快照，不含客户端草稿。
    """
    return {
        "id": str(post.id), "title": post.title, "excerpt": post.excerpt,
        "content_markdown": post.content_markdown,
        "database_status": post.status.value,
        "updated_at": post.updated_at.isoformat(),
        "tags": [tag.slug for tag in post.tags],
    }


def build_blog_agent_context(
    session: Session, *, route: str | None = None, section: str | None = None,
    page_type: str | None = None, post_id: str | None = None,
    title: str | None = None, excerpt: str | None = None,
    content_markdown: str | None = None, editor_status: str | None = None,
) -> dict[str, object]:
    """组装博客页面上下文，分开表示数据库记录和客户端未保存的编辑内容。

    调用方负责身份校验；数据库记录用于说明已保存状态，编辑内容仅供模型参考。
    返回的上下文不保存草稿，也不授予工具写入权限。

    Args:
        session: 调用方已完成身份校验的数据库会话。
        route: 当前页面路径；未提供时使用博客文章管理地址。
        section: 工作台栏目；未提供时使用 posts。
        page_type: 页面类型；未提供时根据文章 ID 与编辑字段推断。
        post_id: 可选文章 UUID 字符串；格式无效或文章不存在时不读取记录。
        title: 客户端当前标题；None 表示未提供，空字符串仍是编辑值。
        excerpt: 客户端当前摘要。
        content_markdown: 客户端当前 Markdown 正文。
        editor_status: 客户端当前编辑状态，仅作参考，不替代数据库状态。

    Returns:
        页面、工具清单和写入策略；列表页附带文章统计与摘要，
        其他页面按可用数据附带数据库快照及 editor_draft。
    """
    resolved_page_type = page_type or (
        "post_editor"
        if post_id
        or any(value is not None for value in (title, excerpt, content_markdown, editor_status))
        else "posts_list"
    )
    page = {
        "module": "blog", "route": route or "/blog/studio/posts",
        "section": section or "posts", "type": resolved_page_type,
    }
    context: dict[str, object] = {
        "module": "blog", "page": page, "available_tools": tool_manifest(),
        "write_policy": "写入、覆盖、删除和发布必须先返回待确认操作，不能直接执行。",
    }
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
        # 无效或已不存在的文章 ID 不阻断对话，但不能据此认定文章已保存。
        with suppress(ValueError):
            database_post = get_blog_post_by_id(session, UUID(post_id))
    has_editor_context = any(
        value is not None for value in (title, excerpt, content_markdown, editor_status)
    )
    if database_post is not None:
        current_post = _persisted_post(database_post)
        if has_editor_context:
            # 草稿单独挂在 editor_draft 下，避免覆盖数据库正文与发布状态。
            editor_draft: dict[str, object] = {
                "title": title, "excerpt": excerpt,
                "content_markdown": content_markdown, "editor_status": editor_status,
            }
            editor_draft["has_unsaved_changes"] = any((
                title is not None and title != database_post.title,
                excerpt is not None and excerpt != database_post.excerpt,
                content_markdown is not None and content_markdown != database_post.content_markdown,
                editor_status is not None and editor_status != database_post.status.value,
            ))
            current_post["editor_draft"] = editor_draft
        context["current_post"] = current_post
    elif has_editor_context:
        context["current_post"] = {
            "id": None, "database_status": None,
            "editor_draft": {
                "title": title, "excerpt": excerpt,
                "content_markdown": content_markdown, "editor_status": editor_status,
                "has_unsaved_changes": True,
            },
        }
    else:
        context["current_post"] = None
    return context
