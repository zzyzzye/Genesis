"""验证导入不覆盖、批量事务及定时计划的持久化与取消行为。"""

import json
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import pytest
from httpx import AsyncClient
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from genesis_api.blog.comments import utc
from genesis_api.blog.export import article_markdown, articles_archive
from genesis_api.blog.importing import markdown_entries, split_front_matter
from genesis_api.blog.models import BlogCategory, BlogPost, BlogPostStatus
from genesis_api.blog.publication import publish_due_posts
from genesis_api.identity.models import User, UserRole
from genesis_api.identity.tokens import create_access_token
from test_blog import add_blog_content, authenticate_owner
from test_blog import client as client
from test_blog import database_engine as database_engine
from test_blog import database_session as database_session


def versions(session: Session) -> list[dict[str, str]]:
    """读取测试文章当前版本，不在客户端模拟成功状态。"""
    return [
        {"id": str(post.id), "expected_updated_at": utc(post.updated_at).isoformat()}
        for post in session.scalars(select(BlogPost).order_by(BlogPost.slug))
    ]


@pytest.mark.anyio
async def test_import_preview_commit_and_receipt(
    client: AsyncClient, database_session: Session
) -> None:
    """预览不写入；确认后草稿、分类与标签一起提交，网络重试不重复创建。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    content = (
        "---\ntitle: 导入文章\nslug: imported\nstatus: published\ncategories: [工程实践]\n"
        "tags: [记录]\n---\n\n# 正文\n\n```sh\necho test\n```\n"
    )
    files = [("files", ("new.md", content.encode(), "text/markdown"))]
    response = await client.post(
        "/api/v1/admin/blog/posts/import/preview", files=files, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["issue"] is None
    assert database_session.scalar(select(func.count()).select_from(BlogPost)) == 3
    data = {"operation_id": str(uuid4()), "paths": json.dumps(["new.md"])}
    response = await client.post(
        "/api/v1/admin/blog/posts/import", files=files, data=data, headers=headers
    )
    assert response.status_code == 200
    repeated = await client.post(
        "/api/v1/admin/blog/posts/import", files=files, data=data, headers=headers
    )
    assert repeated.json() == response.json()
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "imported"))
    assert post is not None
    assert post.status == BlogPostStatus.DRAFT
    assert post.scheduled_at is None and post.published_at is None
    assert post.content_markdown == "# 正文\n\n```sh\necho test\n```\n"
    assert [category.name for category in post.categories] == ["工程实践"]
    assert [tag.name for tag in post.tags] == ["记录"]
    assert database_session.scalar(select(func.count()).select_from(BlogPost)) == 4
    changed = [
        ("files", ("new.md", content.replace("导入文章", "其他文章").encode(), "text/markdown"))
    ]
    assert (
        await client.post(
            "/api/v1/admin/blog/posts/import", files=changed, data=data, headers=headers
        )
    ).status_code == 409


@pytest.mark.anyio
async def test_import_conflicts_invalid_metadata_and_genesis_zip(
    client: AsyncClient, database_session: Session
) -> None:
    """同路径（含回收站）不覆盖；导出的 ZIP 可预览且不把 README 当文章。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    posts = list(database_session.scalars(select(BlogPost)))
    posts[0].deleted_at = datetime.now(UTC)
    database_session.commit()
    with articles_archive(posts, trashed=False) as archive:
        content = archive.read()
    files = [("files", ("backup.zip", content, "application/zip"))]
    response = await client.post(
        "/api/v1/admin/blog/posts/import/preview", files=files, headers=headers
    )
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 3 and all("同路径" in item["issue"] for item in items)
    response = await client.post(
        "/api/v1/admin/blog/posts/import",
        files=files,
        headers=headers,
        data={
            "operation_id": str(uuid4()),
            "paths": json.dumps([item["path"] for item in items]),
        },
    )
    assert response.json()["affected_ids"] == []
    assert len(response.json()["skipped"]) == 3
    metadata, body = split_front_matter(article_markdown(posts[1]))
    assert metadata["slug"] == posts[1].slug and body == posts[1].content_markdown
    invalid = [
        ("files", ("broken.md", b"---\ntitle: !!python/object:evil {}\n---\nbody", "text/markdown"))
    ]
    response = await client.post(
        "/api/v1/admin/blog/posts/import/preview", files=invalid, headers=headers
    )
    assert response.json()["items"][0]["issue"]


@pytest.mark.parametrize("path", ["../evil.md", "/evil.md", "a\\evil.md", "C:evil.md"])
def test_import_rejects_unsafe_zip_paths(path: str) -> None:
    """ZIP 从不写盘，读取前同样拒绝不安全路径。"""
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr(path, "# 正文")
    with pytest.raises(ValueError, match="不安全路径"):
        markdown_entries([("unsafe.zip", output.getvalue())])


def test_import_rejects_alias_and_invalid_manifest() -> None:
    """不接受 YAML 别名、过大单篇或清单中的非字符串路径。"""
    with pytest.raises(ValueError, match="别名"):
        split_front_matter("---\ntitle: &a hello\ntags: [*a]\n---\n正文")
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "genesis-articles",
                    "version": 1,
                    "articles": [{"file": {"bad": "path"}}],
                }
            ),
        )
    with pytest.raises(ValueError, match="无效"):
        markdown_entries([("bad.zip", output.getvalue())])


@pytest.mark.anyio
async def test_batch_atomic_versions_idempotency_and_taxonomy(
    client: AsyncClient, database_session: Session
) -> None:
    """冲突不产生部分撤回，同一回执可重试，分类调整不改共享名称。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    items = versions(database_session)
    items[0]["expected_updated_at"] = "2000-01-01T00:00:00Z"
    data: dict[str, object] = {"operation_id": str(uuid4()), "action": "unpublish", "items": items}
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", json=data, headers=headers)
    ).status_code == 409
    database_session.expire_all()
    assert (
        sum(
            post.status == BlogPostStatus.PUBLISHED
            for post in database_session.scalars(select(BlogPost))
        )
        == 2
    )
    data["items"] = versions(database_session)
    response = await client.post("/api/v1/admin/blog/posts/bulk", json=data, headers=headers)
    assert response.status_code == 200
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", json=data, headers=headers)
    ).json() == response.json()
    database_session.expire_all()
    assert all(
        post.status == BlogPostStatus.DRAFT for post in database_session.scalars(select(BlogPost))
    )
    categories = [BlogCategory(name="分类甲", slug="one"), BlogCategory(name="分类乙", slug="two")]
    database_session.add_all(categories)
    database_session.commit()
    data = {
        "operation_id": str(uuid4()),
        "action": "categories",
        "items": versions(database_session),
        "category_ids": [str(item.id) for item in categories],
    }
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", json=data, headers=headers)
    ).status_code == 200
    data = {"operation_id": str(uuid4()), "action": "publish", "items": versions(database_session)}
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", json=data, headers=headers)
    ).status_code == 200
    database_session.expire_all()
    assert all(len(post.categories) == 2 for post in database_session.scalars(select(BlogPost)))


@pytest.mark.anyio
async def test_scheduled_publication_catches_up_once_and_respects_cancel_trash(
    client: AsyncClient, database_session: Session, database_engine: Engine
) -> None:
    """定时存数据库；新会话模拟重启补发，取消/回收站不会公开。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}

    async def batch(action: str, extra: dict[str, object] | None = None) -> None:
        response = await client.post(
            "/api/v1/admin/blog/posts/bulk",
            headers=headers,
            json={
                "operation_id": str(uuid4()),
                "action": action,
                "items": versions(database_session),
                **(extra or {}),
            },
        )
        assert response.status_code == 200, response.text
        database_session.expire_all()

    await batch("unpublish")
    deadline = datetime.now(UTC) + timedelta(hours=2)
    await batch("schedule", {"scheduled_at": deadline.isoformat()})
    factory = sessionmaker(database_engine, expire_on_commit=False)
    assert publish_due_posts(factory, deadline - timedelta(seconds=1)) == 0
    assert publish_due_posts(factory, deadline + timedelta(minutes=5)) == 3
    assert publish_due_posts(factory, deadline + timedelta(minutes=6)) == 0
    database_session.expire_all()
    assert all(post.scheduled_at is None for post in database_session.scalars(select(BlogPost)))
    await batch("unpublish")
    await batch("schedule", {"scheduled_at": deadline.isoformat()})
    await batch("cancel_schedule")
    assert publish_due_posts(factory, deadline + timedelta(minutes=5)) == 0
    await batch("schedule", {"scheduled_at": deadline.isoformat()})
    await batch("trash")
    assert publish_due_posts(factory, deadline + timedelta(minutes=5)) == 0
    await batch("restore")
    assert all(
        post.scheduled_at is None and post.status == BlogPostStatus.DRAFT
        for post in database_session.scalars(select(BlogPost))
    )


@pytest.mark.anyio
async def test_operations_require_owner_and_schedule_validates_content(
    client: AsyncClient, database_session: Session
) -> None:
    """新入口沿用所有者权限，拒绝过去时间、不完整草稿及重复目标。"""
    add_blog_content(database_session)
    owner_token = await authenticate_owner(client, database_session)
    member = User(handle="import-reader", display_name="读者", role=UserRole.MEMBER)
    database_session.add(member)
    database_session.commit()
    for token, expected in [(None, 401), (create_access_token(member), 403)]:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        assert (
            await client.post(
                "/api/v1/admin/blog/posts/import/preview",
                headers=headers,
                files={"files": ("a.md", b"# A")},
            )
        ).status_code == expected
        assert (
            await client.post(
                "/api/v1/admin/blog/posts/bulk",
                headers=headers,
                json={
                    "operation_id": str(uuid4()),
                    "action": "trash",
                    "items": versions(database_session),
                },
            )
        ).status_code == expected
    headers = {"Authorization": f"Bearer {owner_token}"}
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert post is not None
    post.content_markdown = ""
    database_session.commit()
    data = {
        "operation_id": str(uuid4()),
        "action": "schedule",
        "items": [{"id": str(post.id), "expected_updated_at": utc(post.updated_at).isoformat()}],
        "scheduled_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
    }
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", headers=headers, json=data)
    ).status_code == 400
    data["scheduled_at"] = "2000-01-01T00:00:00Z"
    assert (
        await client.post("/api/v1/admin/blog/posts/bulk", headers=headers, json=data)
    ).status_code == 400
