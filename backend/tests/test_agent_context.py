from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from genesis_api.agent import context as agent_context
from genesis_api.blog.models import BlogPostStatus


def make_post(*, title: str, status: BlogPostStatus, content: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        title=title,
        excerpt=f"{title} 的摘要",
        content_markdown=content,
        status=status,
        updated_at=datetime(2026, 9, 7, tzinfo=UTC),
        category=SimpleNamespace(name="未分类"),
        tags=[SimpleNamespace(slug="notes")],
    )


def test_posts_list_context_uses_database_metadata_without_article_bodies(monkeypatch) -> None:
    published = make_post(
        title="已发布文章",
        status=BlogPostStatus.PUBLISHED,
        content="# 已发布文章\n完整正文",
    )
    draft = make_post(
        title="草稿文章",
        status=BlogPostStatus.DRAFT,
        content="# 草稿文章\n完整正文",
    )
    monkeypatch.setattr(agent_context, "list_admin_posts", lambda _: [published, draft])

    result = agent_context.build_studio_agent_context(
        object(),
        route="/blog/studio/posts",
        section="posts",
        page_type="posts_list",
    )

    assert result["page"] == {
        "route": "/blog/studio/posts",
        "section": "posts",
        "type": "posts_list",
    }
    assert result["article_summary"] == {"total": 2, "published": 1, "draft": 1}
    assert result["current_post"] is None
    assert result["articles"] == [
        {
            "id": str(published.id),
            "title": "已发布文章",
            "excerpt": "已发布文章 的摘要",
            "status": "published",
            "updated_at": "2026-09-07T00:00:00+00:00",
            "category": "未分类",
            "tags": ["notes"],
        },
        {
            "id": str(draft.id),
            "title": "草稿文章",
            "excerpt": "草稿文章 的摘要",
            "status": "draft",
            "updated_at": "2026-09-07T00:00:00+00:00",
            "category": "未分类",
            "tags": ["notes"],
        },
    ]
    assert "content_markdown" not in result["articles"][0]


def test_post_editor_context_distinguishes_persisted_status_from_unsaved_draft(monkeypatch) -> None:
    post = make_post(title="数据库标题", status=BlogPostStatus.PUBLISHED, content="# 数据库正文")
    monkeypatch.setattr(agent_context, "get_blog_post_by_id", lambda _, __: post)

    result = agent_context.build_studio_agent_context(
        object(),
        route=f"/blog/studio/posts/{post.id}/edit",
        section="posts",
        page_type="post_editor",
        post_id=str(post.id),
        title="编辑器标题",
        excerpt="编辑器摘要",
        content_markdown="# 编辑器正文",
        editor_status="draft",
    )

    current_post = result["current_post"]
    assert isinstance(current_post, dict)
    assert current_post["database_status"] == "published"
    assert current_post["content_markdown"] == "# 数据库正文"
    assert current_post["editor_draft"] == {
        "title": "编辑器标题",
        "excerpt": "编辑器摘要",
        "content_markdown": "# 编辑器正文",
        "editor_status": "draft",
        "has_unsaved_changes": True,
    }
