"""验证文章只读导出的授权、正文保真、范围隔离与归档路径安全。"""

import json
from datetime import UTC, datetime
from io import BytesIO
from tempfile import SpooledTemporaryFile
from uuid import uuid4
from zipfile import ZipFile

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.blog import export as exports
from genesis_api.blog.export import article_markdown, articles_archive, markdown_filename
from genesis_api.blog.models import BlogCategory, BlogPost
from genesis_api.identity.models import User, UserRole
from genesis_api.identity.tokens import create_access_token
from test_blog import add_blog_content, authenticate_owner
from test_blog import client as client
from test_blog import database_engine as database_engine
from test_blog import database_session as database_session


def read_markdown(text: str) -> tuple[dict[str, object], str]:
    """按本项目导出格式读取元数据，独立核对原始正文。"""
    header, content = text.split("\n---\n\n", 1)
    values = dict(line.split(": ", 1) for line in header.splitlines()[1:])
    return {key: json.loads(value) for key, value in values.items()}, content


@pytest.mark.anyio
async def test_markdown_export_preserves_content_and_metadata(
    client: AsyncClient, database_session: Session
) -> None:
    """正文不改写，多分类、标签及含换行的文本可无损读取，导出不改变版本。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    categories = [
        BlogCategory(name='工程："笔记"', slug="engineering"),
        BlogCategory(name="随笔", slug="notes"),
    ]
    post.categories = categories
    post.category = categories[0]
    post.title = '标题："引号"\n---\n第二行\u2028分隔\x85符号'
    post.content_markdown = (
        '# 正文\n\n```sh\nprintf "a\\nb"\n```\n\n![图片](/api/v1/blog/attachments/example/image)\n'
    )
    database_session.commit()
    revision = post.updated_at
    response = await client.get(
        f"/api/v1/admin/blog/posts/{post.id}/export", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"] == 'attachment; filename="published-featured.md"'
    metadata, content = read_markdown(response.text)
    assert content == post.content_markdown
    assert metadata["title"] == post.title
    assert metadata["categories"] == [
        {"id": str(category.id), "name": category.name, "slug": category.slug}
        for category in categories
    ]
    assert metadata["status"] == "published"
    assert metadata["genesis_export_version"] == 1
    assert metadata["tags"] == [{"id": str(post.tags[0].id), "name": "工程", "slug": "engineering"}]
    assert "password" not in str(metadata)
    database_session.refresh(post)
    assert post.updated_at == revision


@pytest.mark.anyio
async def test_archive_separates_active_and_trash_and_handles_empty(
    client: AsyncClient, database_session: Session
) -> None:
    """整库不受前端筛选影响，回收站单独导出；空范围仍有有效清单。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    post.deleted_at = datetime.now(UTC)
    database_session.commit()
    for trashed, expected in [(False, {"private-draft", "published-note"}), (True, {post.slug})]:
        response = await client.get(
            "/api/v1/admin/blog/posts/export",
            headers=headers,
            params={
                "trashed": str(trashed).lower(),
                "q": "不匹配",
                "status": "published",
                "page": 99,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert response.headers["cache-control"] == "no-store"
        with ZipFile(BytesIO(response.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["scope"] == ("trash" if trashed else "active")
            assert manifest["count"] == len(expected)
            assert manifest["includes"] == {"comments": False, "attachments": False, "pages": False}
            assert {item["slug"] for item in manifest["articles"]} == expected
            assert set(archive.namelist()) == {
                "README.md",
                "manifest.json",
                *(item["file"] for item in manifest["articles"]),
            }
            for item in manifest["articles"]:
                metadata, _ = read_markdown(archive.read(item["file"]).decode())
                assert bool(metadata["deleted_at"]) is trashed
    post.deleted_at = None
    database_session.commit()
    response = await client.get("/api/v1/admin/blog/posts/export?trashed=true", headers=headers)
    with ZipFile(BytesIO(response.content)) as archive:
        assert json.loads(archive.read("manifest.json"))["articles"] == []


@pytest.mark.anyio
async def test_exports_require_owner_and_unknown_post_is_not_found(
    client: AsyncClient, database_session: Session
) -> None:
    """访客、成员不能取得草稿或回收站，静态 export 路由不被 UUID 路由截获。"""
    add_blog_content(database_session)
    owner_token = await authenticate_owner(client, database_session)
    member = User(handle="export-reader", display_name="读者", role=UserRole.MEMBER)
    database_session.add(member)
    database_session.commit()
    member_token = create_access_token(member)
    post_id = database_session.scalar(select(BlogPost.id).where(BlogPost.slug == "private-draft"))
    for path in ["/export", "/export?trashed=true", f"/{post_id}/export"]:
        url = f"/api/v1/admin/blog/posts{path}"
        assert (await client.get(url)).status_code == 401
        response = await client.get(url, headers={"Authorization": f"Bearer {member_token}"})
        assert response.status_code == 403
    response = await client.get(
        f"/api/v1/admin/blog/posts/{uuid4()}/export",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert response.status_code == 404


def test_archive_filenames_cannot_escape_or_collide(database_session: Session) -> None:
    """历史异常 slug 不能写出归档目录，相似 slug 不覆盖彼此。"""
    add_blog_content(database_session)
    posts = list(database_session.scalars(select(BlogPost)))
    posts[0].slug = "../../escape\r\nheader"
    posts[1].slug = "../../escape\r\nheader!"
    assert "/" not in markdown_filename(posts[0])
    assert "\n" not in markdown_filename(posts[0])
    with articles_archive(posts, trashed=False) as output, ZipFile(output) as archive:
        files = [name for name in archive.namelist() if name.startswith("articles/")]
        assert len(files) == len(set(files)) == 3
        assert all(name.count("/") == 1 and ".." not in name for name in files)
        assert archive.read(files[0]).decode() == article_markdown(posts[0])


def test_archive_closes_temporary_file_on_failure(
    database_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """序列化失败时不会留下含草稿内容的临时文件。"""
    add_blog_content(database_session)
    post = database_session.scalar(select(BlogPost))
    assert post is not None

    def fail_serialization(_: BlogPost) -> str:
        raise ValueError("模拟序列化失败")

    with SpooledTemporaryFile(mode="w+b") as temporary:
        monkeypatch.setattr(exports, "SpooledTemporaryFile", lambda **_: temporary)
        monkeypatch.setattr(exports, "article_markdown", fail_serialization)
        with pytest.raises(ValueError, match="模拟序列化失败"):
            articles_archive([post], trashed=False)
        assert temporary.closed
