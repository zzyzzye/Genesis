"""验证公开元数据、历史版本隔离及回复审核通知的完整路径。"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogComment, BlogNotification, BlogPost, BlogPostRevision
from genesis_api.identity.models import User, UserRole
from genesis_api.identity.tokens import create_access_token
from test_blog import add_blog_content, authenticate_owner
from test_blog import client as client
from test_blog import database_engine as database_engine
from test_blog import database_session as database_session


@pytest.mark.anyio
async def test_seo_publication_and_escaping(client: AsyncClient, database_session: Session) -> None:
    """元数据不含草稿，脚本边界与 XML 均转义，撤回后不继续收录。"""
    add_blog_content(database_session)
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    post.title = '</script><script>alert("x")</script>'
    post.cover_image_url = "javascript:alert(1)"
    database_session.commit()
    headers = {"X-Forwarded-Host": "journal.example", "X-Forwarded-Proto": "https"}
    response = await client.get(
        "/api/v1/blog/seo/head", params={"path": "/articles/published-featured"}, headers=headers
    )
    assert response.status_code == 200
    assert "<script>alert(" not in response.text
    assert "javascript:" not in response.text
    assert "https://journal.example/articles/published-featured" in response.text
    assert "BlogPosting" in response.text and "datePublished" in response.text
    assert response.headers["cache-control"] == "no-store"
    for path in ("/articles/private-draft", "/articles/missing", "/account"):
        hidden = await client.get("/api/v1/blog/seo/head", params={"path": path})
        assert "noindex" in hidden.text and "尚未发布的草稿" not in hidden.text
        assert 'rel="canonical"' not in hidden.text
    index = await client.get("/api/v1/blog/seo/sitemap.xml", headers=headers)
    assert "sitemap.xml?page=1" in index.text
    sitemap = await client.get("/api/v1/blog/seo/sitemap.xml?page=1", headers=headers)
    assert "published-featured" in sitemap.text and "private-draft" not in sitemap.text
    post.deleted_at = datetime.now(UTC)
    database_session.commit()
    assert (
        "published-featured" not in (await client.get("/api/v1/blog/seo/sitemap.xml?page=1")).text
    )
    assert (
        "noindex"
        in (await client.get("/api/v1/blog/seo/head?path=/articles/published-featured")).text
    )
    assert (
        "Sitemap: https://journal.example/sitemap.xml"
        in (await client.get("/api/v1/blog/seo/robots.txt", headers=headers)).text
    )


@pytest.mark.anyio
async def test_history_atomic_snapshots_and_permissions(
    client: AsyncClient, database_session: Session
) -> None:
    """旧文章首次修改保存前后快照，冲突不写历史，成员不能查看。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    base = f"/api/v1/admin/blog/posts/{post.id}"
    initial = (await client.get(base, headers=headers)).json()
    payload = {
        key: initial[key] for key in ("slug", "title", "excerpt", "content_markdown", "status")
    }
    payload.update(title="更新的文章", expected_updated_at=initial["updated_at"])
    assert (await client.put(base, headers=headers, json=payload)).status_code == 200
    history = (await client.get(base + "/revisions", headers=headers)).json()
    assert history["total"] == 2
    old = (
        await client.get(base + "/revisions/" + history["items"][1]["id"], headers=headers)
    ).json()
    assert old["payload"]["title"] == initial["title"]
    assert "status" not in old["payload"] and "scheduled_at" not in old["payload"]
    assert (await client.put(base, headers=headers, json=payload)).status_code == 409
    assert database_session.scalar(select(func.count()).select_from(BlogPostRevision)) == 2
    assert (await client.get(base + "/revisions")).status_code == 401
    member = User(handle="history-reader", display_name="读者", role=UserRole.MEMBER)
    database_session.add(member)
    database_session.commit()
    assert (
        await client.get(
            base + "/revisions", headers={"Authorization": f"Bearer {create_access_token(member)}"}
        )
    ).status_code == 403
    other = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-note"))
    assert other is not None
    assert (
        await client.get(
            f"/api/v1/admin/blog/posts/{other.id}/revisions/{old['id']}", headers=headers
        )
    ).status_code == 404


@pytest.mark.anyio
async def test_reply_moderation_notification_and_visibility(
    client: AsyncClient, database_session: Session
) -> None:
    """回复公开才通知，幂等审核不重复，隐藏父评论后通知与引用均不泄露。"""
    add_blog_content(database_session)
    owner = {"Authorization": f"Bearer {await authenticate_owner(client, database_session)}"}
    reader = User(handle="reply-reader", display_name="回复读者", role=UserRole.MEMBER)
    database_session.add(reader)
    database_session.commit()
    member = {"Authorization": f"Bearer {create_access_token(reader)}"}
    base = "/api/v1/blog/posts/published-featured/comments"
    admin = "/api/v1/admin/blog/comments"
    parent = (
        await client.post(
            base, headers=member, json={"content": "原评论", "submission_id": str(uuid4())}
        )
    ).json()

    async def moderate(id: str, state: str) -> None:
        row = database_session.get(BlogComment, UUID(id))
        assert row is not None
        expected = row.updated_at.replace(tzinfo=UTC).isoformat()
        response = await client.put(
            f"{admin}/{id}", headers=owner, json={"state": state, "expected_updated_at": expected}
        )
        assert response.status_code == 200

    await moderate(parent["id"], "public")
    data = {"content": "作者回复", "parent_id": parent["id"], "submission_id": str(uuid4())}
    reply = await client.post(base, headers=owner, json=data)
    assert reply.status_code == 201
    assert (await client.post(base, headers=owner, json=data)).json() == reply.json()
    assert (await client.get("/api/v1/blog/notifications", headers=member)).json()["total"] == 0
    await moderate(reply.json()["id"], "public")
    await moderate(reply.json()["id"], "public")
    notifications = (await client.get("/api/v1/blog/notifications", headers=member)).json()
    assert notifications["total"] == notifications["unread"] == 1
    note = notifications["items"][0]
    assert note["comment"]["reply_to"]["author_name"] == "回复读者"
    assert (await client.get("/api/v1/blog/notifications", headers=owner)).json()["total"] == 0
    read = f"/api/v1/blog/notifications/{note['id']}/read"
    assert (await client.put(read, headers=owner)).status_code == 404
    assert (await client.put(read, headers=member)).status_code == 204
    assert (await client.put(read, headers=member)).status_code == 204
    assert (await client.get("/api/v1/blog/notifications", headers=member)).json()["unread"] == 0
    assert (await client.get(base + "/" + reply.json()["id"])).status_code == 200
    assert (
        await client.post(
            "/api/v1/blog/posts/published-note/comments",
            headers=member,
            json={**data, "submission_id": str(uuid4())},
        )
    ).status_code == 404
    await moderate(parent["id"], "hidden")
    assert (await client.get("/api/v1/blog/notifications", headers=member)).json()["total"] == 0
    assert (await client.get(base + "/" + reply.json()["id"])).json()["reply_to"] is None
    assert database_session.scalar(select(func.count()).select_from(BlogNotification)) == 1
