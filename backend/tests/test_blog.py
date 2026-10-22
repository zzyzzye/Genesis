"""验证博客公开查询、后台写入、分类标签与共享账号权限。"""

import json
from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.agent.context import agent_invocation_context
from genesis_api.api.routes.blog import router
from genesis_api.blog.agent import actions as blog_actions
from genesis_api.blog.agent import tools as blog_agent_tools
from genesis_api.blog.agent.actions import confirm_blog_action
from genesis_api.blog.models import (
    BlogCategory,
    BlogComment,
    BlogPage,
    BlogPost,
    BlogPostStatus,
    BlogTag,
)
from genesis_api.blog.operations import touch_post
from genesis_api.blog.publication import publish_due_posts
from genesis_api.core.config import Settings
from genesis_api.database import seed
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserCredential, UserRole
from genesis_api.identity.passwords import hash_password
from genesis_api.identity.tokens import get_user_id_from_token
from genesis_api.main import app


@pytest.fixture
def database_engine() -> Generator[Engine, None, None]:
    """创建并在测试后销毁内存数据库，连接池保证不同会话共享同一组表。

    Yields:
        已注册所有实体并建表的测试引擎。
    """
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def database_session(database_engine: Engine) -> Generator[Session, None, None]:
    """提供提交后仍可读取实体字段的测试会话。

    Args:
        database_engine: 当前测试独立的内存数据库引擎。

    Yields:
        由上下文管理器在测试结束后关闭的会话。
    """
    with Session(database_engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
async def client(database_session: Session) -> AsyncGenerator[AsyncClient, None]:
    """用 ASGI 客户端请求应用，并将数据库依赖替换为当前测试会话。

    Args:
        database_session: fixture 创建的测试会话。

    Yields:
        不监听网络端口的 HTTP 客户端；正常结束时清理应用依赖覆盖。
    """

    def override_get_session() -> Generator[Session, None, None]:
        """复用 fixture 会话，关闭动作由外层 fixture 负责。"""
        yield database_session

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def add_blog_content(session: Session) -> None:
    """提交两篇已发布文章与一篇草稿，用于验证公开边界和标签筛选。

    Args:
        session: 测试会话，调用后数据已提交。
    """
    author = User(
        handle="genesis",
        display_name="Genesis",
        role=UserRole.OWNER,
    )
    engineering = BlogTag(name="工程", slug="engineering")
    notes = BlogTag(name="随笔", slug="notes")
    session.add_all([author, engineering, notes])
    session.flush()
    session.add_all(
        [
            BlogPost(
                author=author,
                slug="published-featured",
                title="已发布的精选文章",
                excerpt="用于验证公开文章列表。",
                content_markdown="# 已发布的精选文章",
                status=BlogPostStatus.PUBLISHED,
                is_featured=True,
                read_time_minutes=4,
                published_at=datetime(2026, 9, 2, tzinfo=UTC),
                tags=[engineering],
            ),
            BlogPost(
                author=author,
                slug="published-note",
                title="已发布的随笔",
                excerpt="用于验证标签筛选。",
                content_markdown="# 已发布的随笔",
                status=BlogPostStatus.PUBLISHED,
                read_time_minutes=2,
                published_at=datetime(2026, 9, 1, tzinfo=UTC),
                tags=[notes],
            ),
            BlogPost(
                author=author,
                slug="private-draft",
                title="尚未发布的草稿",
                excerpt="不应出现在公开接口。",
                content_markdown="# 草稿",
                status=BlogPostStatus.DRAFT,
                read_time_minutes=1,
            ),
        ]
    )
    session.commit()


async def authenticate_owner(client: AsyncClient, session: Session) -> str:
    """准备所有者测试账号并通过真实登录接口取得访问令牌。

    Args:
        client: 指向测试应用的 ASGI 客户端。
        session: 准备账号和凭据使用的测试会话。

    Returns:
        测试登录返回的访问令牌，仅供当前测试构造认证请求。
    """
    owner = session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    owner.credential = UserCredential(password_hash=hash_password("correct-horse-battery-staple"))
    session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "genesis", "password": "correct-horse-battery-staple"},
    )

    assert response.status_code == 200
    token = response.json()["access_token"]
    assert isinstance(token, str)
    return token


@pytest.mark.anyio
async def test_list_published_posts_and_filter_by_tag(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)

    response = await client.get("/api/v1/blog/posts")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["slug"] for item in body["items"]] == [
        "published-featured",
        "published-note",
    ]
    assert body["items"][0]["author"] == {
        "id": body["items"][0]["author"]["id"],
        "handle": "genesis",
        "display_name": "Genesis",
        "avatar_url": None,
    }

    filtered_response = await client.get("/api/v1/blog/posts?tag=notes")

    assert filtered_response.status_code == 200
    assert filtered_response.json()["total"] == 1
    assert filtered_response.json()["items"][0]["slug"] == "published-note"


@pytest.mark.anyio
async def test_public_search_is_literal_combines_tags_and_excludes_drafts(
    client: AsyncClient, database_session: Session
) -> None:
    """搜索公开标题和摘要，通配符按普通字符处理，分页总数保持一致。"""
    add_blog_content(database_session)
    for query, expected in [("精选", 1), ("标签筛选", 1), ("草稿", 0), ("%", 0), ("_", 0)]:
        response = await client.get("/api/v1/blog/posts", params={"q": query})
        assert response.status_code == 200
        assert response.json()["total"] == expected

    response = await client.get("/api/v1/blog/posts", params={"q": "随笔", "tag": "engineering"})
    assert response.json() == {"items": [], "total": 0}
    response = await client.get(
        "/api/v1/blog/posts", params={"q": "已发布", "limit": 1, "offset": 1}
    )
    assert response.json()["total"] == 2
    assert response.json()["items"][0]["slug"] == "published-note"


@pytest.mark.anyio
async def test_public_tags_count_only_published_articles(
    client: AsyncClient, database_session: Session
) -> None:
    """目录标签不受分页影响，不泄露仅用于草稿的标签。"""
    add_blog_content(database_session)
    draft = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert draft is not None
    draft.tags.append(BlogTag(name="内部草稿", slug="draft-only"))
    database_session.commit()
    response = await client.get("/api/v1/blog/tags")
    assert response.status_code == 200
    assert {item["slug"]: item["post_count"] for item in response.json()} == {
        "engineering": 1,
        "notes": 1,
    }


@pytest.mark.anyio
async def test_get_published_post_hides_drafts(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)

    response = await client.get("/api/v1/blog/posts/published-featured")

    assert response.status_code == 200
    assert response.json()["content_markdown"] == "# 已发布的精选文章"
    assert response.json()["tags"] == [
        {
            "id": response.json()["tags"][0]["id"],
            "name": "工程",
            "slug": "engineering",
        }
    ]

    hidden_draft_response = await client.get("/api/v1/blog/posts/private-draft")
    missing_response = await client.get("/api/v1/blog/posts/not-found")

    assert hidden_draft_response.status_code == 404
    assert missing_response.status_code == 404


def test_development_seed_is_idempotent(
    database_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    factory = sessionmaker[Session](bind=database_engine, expire_on_commit=False)
    with Session(database_engine) as session:
        session.add(BlogTag(name="产品", slug="product"))
        session.commit()
    monkeypatch.setattr(seed, "SessionLocal", factory)

    seed.seed_database()
    seed.seed_database()

    with Session(database_engine) as session:
        owner = session.scalar(select(User).where(User.handle == "genesis"))
        assert owner is not None
        assert owner.credential is not None
        assert owner.credential.password_hash != "genesis-local-only"
        assert session.scalars(select(BlogPost)).all()
        assert len(session.scalars(select(BlogTag)).all()) == 3


def test_get_session_creates_a_session() -> None:
    session_generator = get_session()
    session = next(session_generator)
    assert isinstance(session, Session)
    session_generator.close()


def test_blog_router_has_a_stable_prefix() -> None:
    assert router.prefix == "/blog"


@pytest.mark.anyio
async def test_owner_can_log_in_and_read_own_profile(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)

    token = await authenticate_owner(client, database_session)
    invalid_login = await client.post(
        "/api/v1/auth/login",
        data={"username": "genesis", "password": "incorrect-password"},
    )
    profile = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert invalid_login.status_code == 401
    assert profile.status_code == 200
    assert profile.json()["handle"] == "genesis"
    assert profile.json()["role"] == "owner"
    assert get_user_id_from_token(token) is not None
    assert get_user_id_from_token("not-a-token") is None


@pytest.mark.anyio
async def test_member_can_register_and_manage_own_profile(client: AsyncClient) -> None:
    registration_data = {
        "handle": "reader_one",
        "display_name": "  新读者  ",
        "password": "member-password",
    }
    registration_response = await client.post("/api/v1/auth/register", json=registration_data)
    duplicate_response = await client.post("/api/v1/auth/register", json=registration_data)
    invalid_handle_response = await client.post(
        "/api/v1/auth/register",
        json={**registration_data, "handle": "不合法账号"},
    )

    assert registration_response.status_code == 201
    assert registration_response.json() == {
        "id": registration_response.json()["id"],
        "handle": "reader_one",
        "display_name": "新读者",
        "bio": "",
        "avatar_url": None,
        "role": "member",
    }
    assert duplicate_response.status_code == 409
    assert invalid_handle_response.status_code == 422

    login_response = await client.post(
        "/api/v1/auth/login",
        data={"username": "reader_one", "password": "member-password"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    update_response = await client.put(
        "/api/v1/auth/me",
        headers=headers,
        json={
            "display_name": "读者一号",
            "bio": "喜欢阅读和记录。",
            "avatar_url": "https://example.com/avatar.png",
        },
    )
    profile_response = await client.get("/api/v1/auth/me", headers=headers)

    assert login_response.status_code == 200
    assert update_response.status_code == 200
    assert update_response.json()["display_name"] == "读者一号"
    assert update_response.json()["avatar_url"] == "https://example.com/avatar.png"
    assert profile_response.json()["bio"] == "喜欢阅读和记录。"


@pytest.mark.anyio
async def test_owner_can_manage_drafts_and_publish_articles(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    draft_data = {
        "slug": "managed-draft",
        "title": "从管理端写一篇文章",
        "excerpt": "先保存草稿，再确认公开发布。",
        "content_markdown": "# 草稿\n\n这是管理端创建的文章。",
        "status": "draft",
        "is_featured": False,
        "read_time_minutes": 5,
        "tags": [{"name": "工程实践", "slug": "engineering"}],
    }

    unauthorized_response = await client.get("/api/v1/admin/blog/posts")
    create_response = await client.post(
        "/api/v1/admin/blog/posts", headers=headers, json=draft_data
    )

    assert unauthorized_response.status_code == 401
    assert create_response.status_code == 201
    created_post = create_response.json()
    assert created_post["status"] == "draft"
    assert (await client.get("/api/v1/blog/posts/managed-draft")).status_code == 404

    publish_data = {**draft_data, "status": "published", "is_featured": True}
    update_response = await client.put(
        f"/api/v1/admin/blog/posts/{created_post['id']}",
        headers=headers,
        json=publish_data,
    )
    public_response = await client.get("/api/v1/blog/posts/managed-draft")
    duplicate_response = await client.post(
        "/api/v1/admin/blog/posts", headers=headers, json=publish_data
    )

    assert update_response.status_code == 200
    assert update_response.json()["published_at"] is not None
    assert public_response.status_code == 200
    assert public_response.json()["tags"][0]["name"] == "工程实践"

    draft_again_response = await client.put(
        f"/api/v1/admin/blog/posts/{created_post['id']}",
        headers=headers,
        json={**publish_data, "status": "draft"},
    )
    assert draft_again_response.status_code == 200
    assert draft_again_response.json()["published_at"] is None
    assert (await client.get("/api/v1/blog/posts/managed-draft")).status_code == 404

    assert duplicate_response.status_code == 409

    delete_response = await client.delete(
        f"/api/v1/admin/blog/posts/{created_post['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 204
    assert (
        await client.get("/api/v1/admin/blog/posts/not-a-uuid", headers=headers)
    ).status_code == 422


@pytest.mark.anyio
async def test_member_cannot_access_blog_management(
    client: AsyncClient, database_session: Session
) -> None:
    member = User(
        handle="reader",
        display_name="Reader",
        role=UserRole.MEMBER,
        credential=UserCredential(password_hash=hash_password("a-different-password")),
    )
    database_session.add(member)
    database_session.commit()

    login_response = await client.post(
        "/api/v1/auth/login",
        data={"username": "reader", "password": "a-different-password"},
    )
    token = login_response.json()["access_token"]
    response = await client.get(
        "/api/v1/admin/blog/posts", headers={"Authorization": f"Bearer {token}"}
    )

    assert login_response.status_code == 200
    assert response.status_code == 403
    member_headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get(
        "/api/v1/admin/blog/posts?trashed=true", headers=member_headers
    )).status_code == 403
    trash_path = "/api/v1/admin/blog/posts/00000000-0000-0000-0000-000000000000"
    version = {"expected_updated_at": "2026-10-21T00:00:00Z"}
    assert (await client.post(
        f"{trash_path}/restore", headers=member_headers, params=version
    )).status_code == 403
    assert (await client.delete(
        f"{trash_path}/permanent", headers=member_headers, params=version
    )).status_code == 403
    assert (await client.get("/api/v1/admin/blog/links", headers=member_headers)).status_code == 403
    assert (
        await client.post(
            "/api/v1/admin/blog/links",
            headers=member_headers,
            json={"name": "越权", "url": "https://example.com"},
        )
    ).status_code == 403
    for kind in ("tags", "categories", "links"):
        path = f"/api/v1/admin/blog/{kind}/00000000-0000-0000-0000-000000000000"
        headers = {"Authorization": f"Bearer {token}"}
        assert (
            await client.put(path, headers=headers, json={"name": "无权修改", "slug": "denied"})
        ).status_code == 403
        assert (await client.delete(path, headers=headers)).status_code == 403


@pytest.mark.anyio
async def test_post_trash_restore_and_permanent_delete(
    client: AsyncClient, database_session: Session
) -> None:
    """回收站隐藏所有公开入口，恢复为草稿，彻底删除需匹配版本。"""
    add_blog_content(database_session)
    headers = {"Authorization": f"Bearer {await authenticate_owner(client, database_session)}"}
    data = {
        "slug": "trash-lifecycle", "title": "回收站验收", "excerpt": "保留这段摘要",
        "content_markdown": "# 保留正文", "status": "published",
        "tags": [{"name": "回收站专属", "slug": "trash-only"}],
    }
    created = await client.post("/api/v1/admin/blog/posts", headers=headers, json=data)
    assert created.status_code == 201
    post_id = created.json()["id"]
    path = f"/api/v1/admin/blog/posts/{post_id}"
    public = "/api/v1/blog/posts/trash-lifecycle"
    assert (await client.get(public)).status_code == 200
    assert (await client.delete(
        path, headers=headers, params={"expected_updated_at": "2020-01-01T00:00:00Z"}
    )).status_code == 409
    assert (await client.post(f"{path}/restore", headers=headers)).status_code == 422
    assert (await client.delete(
        f"{path}/permanent", headers=headers,
        params={"expected_updated_at": created.json()["updated_at"]},
    )).status_code == 409
    assert (await client.delete(path, headers=headers)).status_code == 204
    trash = (await client.get("/api/v1/admin/blog/posts?trashed=true", headers=headers)).json()
    assert len(trash) == 1 and trash[0]["id"] == post_id
    version = trash[0]["updated_at"]
    assert trash[0]["content_markdown"] == data["content_markdown"]
    assert trash[0]["deleted_at"] is not None
    assert (await client.delete(path, headers=headers)).status_code == 204
    repeated = (await client.get("/api/v1/admin/blog/posts?trashed=true", headers=headers)).json()
    assert repeated[0]["updated_at"] == version
    assert (await client.get(public)).status_code == 404
    assert (await client.get(f"{public}/comments")).status_code == 404
    assert (await client.get(f"{public}/guide")).status_code == 404
    assert (await client.get(path, headers=headers)).status_code == 404
    assert (await client.put(path, headers=headers, json=data)).status_code == 404
    assert (await client.get("/api/v1/blog/posts?q=回收站验收")).json()["total"] == 0
    tags = (await client.get("/api/v1/blog/tags")).json()
    assert not any(tag["slug"] == "trash-only" for tag in tags)
    params = {"expected_updated_at": version}
    assert (await client.get("/api/v1/admin/blog/posts?trashed=true")).status_code == 401
    assert (await client.post(f"{path}/restore", params=params)).status_code == 401
    assert (await client.delete(f"{path}/permanent", params=params)).status_code == 401
    stale = {"expected_updated_at": created.json()["updated_at"]}
    assert (await client.post(f"{path}/restore", headers=headers, params=stale)).status_code == 409
    restored = await client.post(f"{path}/restore", headers=headers, params=params)
    assert restored.status_code == 200
    assert restored.json()["status"] == "draft"
    assert restored.json()["deleted_at"] is None
    assert restored.json()["published_at"] is None
    assert restored.json()["tags"][0]["slug"] == "trash-only"
    assert (await client.get(public)).status_code == 404
    assert (await client.delete(
        f"{path}/permanent", headers=headers, params=params
    )).status_code == 409
    assert (await client.delete(path, headers=headers)).status_code == 204
    current = (await client.get("/api/v1/admin/blog/posts?trashed=true", headers=headers)).json()[0]
    assert (await client.delete(
        f"{path}/permanent", headers=headers,
        params={"expected_updated_at": current["updated_at"]},
    )).status_code == 204
    assert (await client.delete(
        f"{path}/permanent", headers=headers, params=params
    )).status_code == 404
    assert (await client.get("/api/v1/admin/blog/posts?trashed=true", headers=headers)).json() == []


@pytest.mark.anyio
async def test_post_multiple_categories_round_trip(
    client: AsyncClient, database_session: Session
) -> None:
    """验证多分类保存、单项移除、清空和旧客户端兼容。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    category_ids = []
    for name, slug in (("工程", "engineering"), ("产品", "product")):
        response = await client.post(
            "/api/v1/admin/blog/categories", headers=headers, json={"name": name, "slug": slug}
        )
        assert response.status_code == 201
        category_ids.append(response.json()["id"])
    payload = {
        "title": "多分类文章", "slug": "multiple-categories",
        "content_markdown": "正文", "excerpt": "摘要", "category_ids": category_ids,
    }
    created = await client.post("/api/v1/admin/blog/posts", headers=headers, json=payload)
    assert created.status_code == 201
    path = f"/api/v1/admin/blog/posts/{created.json()['id']}"
    saved = await client.get(path, headers=headers)
    assert {item["id"] for item in saved.json()["categories"]} == set(category_ids)
    for category_id in category_ids:
        assert (await client.delete(
            f"/api/v1/admin/blog/categories/{category_id}", headers=headers
        )).status_code == 409
    payload["category_ids"] = category_ids[1:]
    updated = await client.put(path, headers=headers, json=payload)
    assert updated.status_code == 200
    assert [item["id"] for item in updated.json()["categories"]] == category_ids[1:]
    payload["category_ids"] = []
    cleared = await client.put(path, headers=headers, json=payload)
    assert cleared.json()["categories"] == []
    assert cleared.json()["category"] is None
    del payload["category_ids"]
    payload["category_id"] = category_ids[0]
    legacy = await client.put(path, headers=headers, json=payload)
    assert [item["id"] for item in legacy.json()["categories"]] == category_ids[:1]


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["tags", "categories"])
async def test_owner_taxonomy_crud_preserves_articles(
    client: AsyncClient, database_session: Session, kind: str
) -> None:
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    base = f"/api/v1/admin/blog/{kind}"
    created = await client.post(
        base, headers=headers, json={"name": "  分类验收  ", "slug": "qa-taxonomy"}
    )
    assert created.status_code == 201
    assert created.json()["name"] == "分类验收"
    item_id = created.json()["id"]
    path = f"{base}/{item_id}"
    updated = await client.put(
        path, headers=headers, json={"name": "修改后的名称", "slug": "qa-renamed"}
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == item_id
    assert (await client.put(path, json={"name": "越权", "slug": "no-access"})).status_code == 401
    assert (await client.delete(path)).status_code == 401
    assert (
        await client.put(path, headers=headers, json={"name": "   ", "slug": "blank"})
    ).status_code == 422
    duplicate = await client.post(
        base, headers=headers, json={"name": "重复项", "slug": "duplicate-other"}
    )
    assert duplicate.status_code == 201
    assert (
        await client.put(path, headers=headers, json={"name": "重复项", "slug": "duplicate-other"})
    ).status_code == 409
    post_data = {
        "title": "关联验收",
        "slug": "qa-reference",
        "excerpt": "测试引用关系",
        "content_markdown": "测试正文",
        "category_id": item_id if kind == "categories" else None,
        "tags": [{"name": "修改后的名称", "slug": "qa-renamed"}] if kind == "tags" else [],
    }
    post = await client.post("/api/v1/admin/blog/posts", headers=headers, json=post_data)
    assert post.status_code == 201
    assert (
        await client.put(
            path, headers=headers, json={"name": "关联后改名", "slug": "linked-renamed"}
        )
    ).status_code == 200
    assert (await client.delete(path, headers=headers)).status_code == 409
    post_path = f"/api/v1/admin/blog/posts/{post.json()['id']}"
    linked_post = await client.get(post_path, headers=headers)
    assert linked_post.status_code == 200
    linked_item = (
        linked_post.json()["category"] if kind == "categories" else linked_post.json()["tags"][0]
    )
    assert linked_item["id"] == item_id
    assert linked_item["slug"] == "linked-renamed"
    assert (await client.delete(post_path, headers=headers)).status_code == 204
    assert (await client.delete(path, headers=headers)).status_code == 409
    trashed = (await client.get(
        "/api/v1/admin/blog/posts?trashed=true", headers=headers
    )).json()[0]
    assert (await client.delete(
        f"{post_path}/permanent", headers=headers,
        params={"expected_updated_at": trashed["updated_at"]},
    )).status_code == 204
    assert (await client.delete(path, headers=headers)).status_code == 204
    assert (await client.delete(path, headers=headers)).status_code == 404
    assert (
        await client.put(path, headers=headers, json={"name": "已删除", "slug": "deleted"})
    ).status_code == 404


def test_production_settings_require_a_non_default_jwt_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production")

    settings = Settings(
        environment="production",
        jwt_secret=SecretStr("a-different-production-secret"),
        agent_action_secret=SecretStr("a-different-agent-action-secret"),
    )
    assert settings.jwt_secret.get_secret_value() == "a-different-production-secret"

    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            jwt_secret=SecretStr("a-different-production-secret"),
        )
    with pytest.raises(ValidationError):
        Settings(agent_max_concurrent_runs=0)


@pytest.mark.anyio
async def test_incomplete_draft_can_be_saved_but_not_published(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    data = {"slug": "empty-writing-draft", "title": "", "excerpt": "", "content_markdown": ""}
    created = await client.post("/api/v1/admin/blog/posts", headers=headers, json=data)
    assert created.status_code == 201
    path = f"/api/v1/admin/blog/posts/{created.json()['id']}"
    for field in ("title", "excerpt", "content_markdown"):
        publish = {
            **data,
            "title": "标题",
            "excerpt": "摘要",
            "content_markdown": "正文",
            "status": "published",
            field: "  ",
        }
        assert (await client.put(path, headers=headers, json=publish)).status_code == 422
    assert (await client.get("/api/v1/blog/posts/empty-writing-draft")).status_code == 404


@pytest.mark.anyio
async def test_stale_editor_cannot_overwrite_a_newer_article(
    client: AsyncClient, database_session: Session
) -> None:
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    data = {
        "slug": "versioned-writing",
        "title": "初稿",
        "excerpt": "摘要",
        "content_markdown": "正文",
    }
    created = await client.post("/api/v1/admin/blog/posts", headers=headers, json=data)
    assert created.status_code == 201
    path = f"/api/v1/admin/blog/posts/{created.json()['id']}"
    updated = await client.put(
        path,
        headers=headers,
        json={**data, "title": "最新版本", "expected_updated_at": created.json()["updated_at"]},
    )
    assert updated.status_code == 200
    stale = await client.put(
        path,
        headers=headers,
        json={
            **data,
            "title": "过期修改",
            "status": "published",
            "expected_updated_at": created.json()["updated_at"],
        },
    )
    assert stale.status_code == 409
    latest = await client.get(path, headers=headers)
    assert latest.json()["title"] == "最新版本"
    assert latest.json()["status"] == "draft"
    assert (await client.get("/api/v1/blog/posts/versioned-writing")).status_code == 404


@pytest.mark.parametrize("automatic", [False, True])
def test_agent_create_and_publish_is_one_operation(
    database_session: Session, monkeypatch: pytest.MonkeyPatch, automatic: bool
) -> None:
    """审阅只需确认一次，自动模式直接发布，重复请求不能创建第二篇。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    owner_id = owner.id
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessionmaker(
        bind=database_session.get_bind(), expire_on_commit=False,
    ))
    payload: dict[str, object] = {
        "title": "直接发布", "excerpt": "摘要",
        "content_markdown": "完整正文", "slug": "direct-publish",
    }
    with agent_invocation_context(
        owner_id, "owner", "blog",
        execution_mode="automatic" if automatic else "approval_required",
    ):
        proposal = json.loads(blog_agent_tools._preview("create_and_publish", payload, Settings(
            agent_action_secret=SecretStr("x" * 32),
        )))
    assert proposal["executed"] is automatic
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "direct-publish"))
    if not automatic:
        assert post is None
        result = confirm_blog_action(
            "create_and_publish", payload, current_user=owner, session=database_session
        )
    else:
        result = proposal["execution_result"]
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "direct-publish"))
    assert post is not None and post.status is BlogPostStatus.PUBLISHED
    assert isinstance(result, dict)
    assert post.published_at is not None and result["status"] == "published"
    with pytest.raises(HTTPException):
        confirm_blog_action(
            "create_and_publish", payload, current_user=owner, session=database_session
        )
    assert len(list(database_session.scalars(
        select(BlogPost).where(BlogPost.slug == "direct-publish")
    ))) == 1


def test_agent_create_and_publish_rejects_invalid_content_without_draft(
    database_session: Session,
) -> None:
    """发布校验失败不产生草稿，也不留下待提交记录。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    with pytest.raises(ValidationError):
        confirm_blog_action(
            "create_and_publish",
            {"title": " ", "excerpt": "摘要", "content_markdown": "正文", "slug": "invalid-direct"},
            current_user=owner, session=database_session,
        )
    assert database_session.scalar(
        select(BlogPost).where(BlogPost.slug == "invalid-direct")
    ) is None


def test_agent_publication_checks_content_and_sets_publish_time(database_session: Session) -> None:
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    post = BlogPost(
        author=owner,
        slug="agent-incomplete",
        title="",
        excerpt="",
        content_markdown="",
        status=BlogPostStatus.DRAFT,
    )
    database_session.add(post)
    database_session.commit()
    with pytest.raises(ValidationError):
        confirm_blog_action(
            "publish_post", {"post_id": str(post.id)}, current_user=owner, session=database_session
        )
    assert post.status is BlogPostStatus.DRAFT
    assert post.published_at is None
    post.title, post.excerpt, post.content_markdown = "标题", "摘要", "正文"
    database_session.commit()
    previous_version = post.updated_at
    result = confirm_blog_action(
        "publish_post", {"post_id": str(post.id)}, current_user=owner, session=database_session
    )
    assert result == {"action": "publish_post", "post_id": str(post.id), "status": "published"}
    published_post = database_session.get(BlogPost, post.id)
    assert published_post is not None
    assert published_post.status is BlogPostStatus.PUBLISHED
    assert published_post.published_at is not None
    assert published_post.updated_at != previous_version


@pytest.mark.parametrize("action", ["create_draft", "create_and_publish", "update_post"])
@pytest.mark.parametrize("concurrent_conflict", [False, True])
def test_agent_slug_conflicts_rollback_without_changing_articles(
    database_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    concurrent_conflict: bool,
) -> None:
    """覆盖已有路径与检查后并发冲突，确认失败不得覆盖原文或污染会话。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    target = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-note"))
    occupied = database_session.scalar(
        select(BlogPost).where(BlogPost.slug == "published-featured")
    )
    assert owner is not None and target is not None and occupied is not None
    original_title = target.title
    original_content = occupied.content_markdown
    if concurrent_conflict:
        # 模拟查询时路径尚未被占用，提交时由真实数据库唯一约束拒绝。
        monkeypatch.setattr(blog_actions, "get_blog_post_by_slug", lambda *_: None)
    changes: dict[str, object] = {
        "slug": occupied.slug,
        "title": "不应被保存的标题",
        "excerpt": "摘要",
        "content_markdown": "不应被保存的正文",
    }
    payload: dict[str, object] = (
        changes if action in {"create_draft", "create_and_publish"}
        else {"post_id": str(target.id), "changes": changes}
    )
    with pytest.raises(HTTPException) as raised:
        confirm_blog_action(action, payload, current_user=owner, session=database_session)
    assert raised.value.status_code == 409
    assert "文章路径已被使用" in raised.value.detail
    assert target.title == original_title
    assert target.slug == "published-note"
    assert occupied.content_markdown == original_content
    assert len(list(database_session.scalars(select(BlogPost)))) == 3
    # 同一个会话仍可更新原文章，保持自己的路径不构成冲突。
    result = confirm_blog_action(
        "update_post",
        {"post_id": str(target.id), "changes": {"excerpt": "成功更新摘要"}},
        current_user=owner,
        session=database_session,
    )
    assert isinstance(result, dict) and result["status"] == "updated"
    assert target.excerpt == "成功更新摘要"


@pytest.mark.anyio
@pytest.mark.parametrize("automatic", [False, True])
async def test_agent_creates_scheduled_post_with_taxonomy_in_one_operation(
    database_session: Session, monkeypatch: pytest.MonkeyPatch, automatic: bool,
) -> None:
    """同一次操作保存分类、标签和计划；审阅不提前写入，自动模式直接执行。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    categories = [BlogCategory(name="工程实践", slug="practice"),
                  BlogCategory(name="写作", slug="writing")]
    database_session.add_all(categories)
    database_session.commit()
    category_ids = [str(item.id) for item in categories]
    sessions = sessionmaker(bind=database_session.get_bind(), expire_on_commit=False)
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessions)
    tools = {item.name: item for item in blog_agent_tools.build_blog_tools(Settings())}
    scheduled = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    with agent_invocation_context(owner.id, "owner", "blog", execution_mode=(
        "automatic" if automatic else "approval_required"
    )):
        taxonomy = json.loads(await tools["list_taxonomies"].ainvoke({}))
        assert {item["id"] for item in taxonomy["categories"]} == set(category_ids)
        assert {item["name"] for item in taxonomy["tags"]} == {"工程", "随笔"}
        proposal = json.loads(await tools["create_scheduled_post"].ainvoke({
            "title": "计划文章", "excerpt": "摘要", "content_markdown": "完整正文",
            "slug": "agent-scheduled", "category_ids": category_ids,
            "tags": [{"name": "工程", "slug": "engineering"}, {"name": "新标签", "slug": "new"}],
            "scheduled_at": scheduled, "cover_image_url": "https://example.com/cover.png",
        }))
    assert proposal["executed"] is automatic
    assert proposal["payload"]["category_names"] == ["工程实践", "写作"]
    if not automatic:
        assert database_session.scalar(select(BlogPost).where(
            BlogPost.slug == "agent-scheduled",
        )) is None
        confirm_blog_action("create_draft", proposal["payload"], current_user=owner,
                            session=database_session)
    database_session.expire_all()
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "agent-scheduled"))
    assert post is not None and post.status is BlogPostStatus.DRAFT
    assert post.scheduled_at is not None and post.published_at is None
    assert {str(item.id) for item in post.categories} == set(category_ids)
    assert {tag.name for tag in post.tags} == {"工程", "新标签"}
    assert post.cover_image_url == "https://example.com/cover.png"
    due = datetime.fromisoformat(scheduled) + timedelta(minutes=1)
    assert publish_due_posts(sessions, now=due) == 1
    assert publish_due_posts(sessions, now=due) == 0
    database_session.expire_all()
    published = database_session.get(BlogPost, post.id)
    assert published is not None and published.status is BlogPostStatus.PUBLISHED
    assert published.scheduled_at is None


@pytest.mark.anyio
@pytest.mark.parametrize("automatic", [False, True])
async def test_agent_schedule_edit_cancel_and_publish_preserve_article(
    database_session: Session, monkeypatch: pytest.MonkeyPatch, automatic: bool,
) -> None:
    """定时、普通修改、取消、立即发布沿用人工流程，省略字段不会清除计划。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert owner is not None and post is not None
    owner_id, post_id = owner.id, post.id
    category = BlogCategory(name="保留分类", slug="preserved")
    post.category = category
    post.categories = [category]
    database_session.commit()
    category_id = category.id
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessionmaker(
        bind=database_session.get_bind(), expire_on_commit=False,
    ))
    tools = {item.name: item for item in blog_agent_tools.build_blog_tools(Settings())}

    async def update(changes: dict[str, object], tool_name: str = "update_post") -> None:
        with agent_invocation_context(owner_id, "owner", "blog", execution_mode=(
            "automatic" if automatic else "approval_required"
        )):
            detail = json.loads(await tools["get_post"].ainvoke({"post_id": str(post_id)}))
            arguments: dict[str, object] = {
                "post_id": str(post_id),
                "expected_updated_at": detail["updated_at"],
            }
            if tool_name == "update_post":
                arguments["changes"] = json.dumps(changes)
            elif tool_name == "schedule_post":
                arguments["scheduled_at"] = changes["scheduled_at"]
            proposal = json.loads(await tools[tool_name].ainvoke(arguments))
        assert proposal["payload"]["expected_updated_at"] == detail["updated_at"]
        if not automatic:
            confirm_blog_action("update_post", proposal["payload"], current_user=owner,
                                session=database_session)
        database_session.expire_all()

    scheduled = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    await update({"status": "draft", "scheduled_at": scheduled}, "schedule_post")
    assert post.scheduled_at is not None and post.status is BlogPostStatus.DRAFT
    planned_time = post.scheduled_at
    await update({"excerpt": "保留计划的新摘要"})
    assert post.scheduled_at == planned_time
    assert post.category_id == category_id
    await update({"category_ids": None})
    assert post.category_id == category_id
    await update({"category_ids": [], "tags": []})
    assert post.category_id is None and post.categories == []
    await update({"scheduled_at": None}, "cancel_post_schedule")
    assert post.scheduled_at is None and post.status is BlogPostStatus.DRAFT
    await update({"scheduled_at": scheduled})
    await update({"status": "published"})
    assert post.status is BlogPostStatus.PUBLISHED and post.scheduled_at is None
    assert post.content_markdown == "# 草稿" and post.excerpt == "保留计划的新摘要"
    await update({"status": "draft", "scheduled_at": None})
    assert post.status is BlogPostStatus.DRAFT and post.published_at is None
    with agent_invocation_context(owner_id, "owner", "blog"):
        latest = json.loads(await tools["get_post"].ainvoke({"post_id": str(post_id)}))
        feedback = await tools["cancel_post_schedule"].ainvoke({
            "post_id": str(post_id), "expected_updated_at": latest["updated_at"],
        })
        assert "无需取消" in feedback


@pytest.mark.anyio
@pytest.mark.parametrize("action", ["update_post", "publish_post", "delete_post"])
async def test_agent_checks_versions_before_proposal_and_confirmation(
    database_session: Session, monkeypatch: pytest.MonkeyPatch, action: str,
) -> None:
    """读取后或确认前出现新版本，都不能覆盖、公开或删除较新的文章。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert owner is not None and post is not None
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessionmaker(
        bind=database_session.get_bind(), expire_on_commit=False,
    ))
    tools = {item.name: item for item in blog_agent_tools.build_blog_tools(Settings())}
    with agent_invocation_context(owner.id, "owner", "blog"):
        detail = json.loads(await tools["get_post"].ainvoke({"post_id": str(post.id)}))
        arguments = {"post_id": str(post.id), "expected_updated_at": detail["updated_at"]}
        if action == "update_post":
            arguments["changes"] = '{"title":"旧版本改写"}'
        proposal = json.loads(await tools[action].ainvoke(arguments))
        post.title = "其他页面的新标题"
        touch_post(post)
        database_session.commit()
        feedback = await tools[action].ainvoke({
            "type": "tool_call", "name": action, "args": arguments, "id": "stale-version",
        })
        assert feedback.status == "error" and "文章已变更" in feedback.content
    with pytest.raises(HTTPException) as raised:
        confirm_blog_action(
            action, proposal["payload"], current_user=owner, session=database_session,
        )
    assert raised.value.status_code == 409
    assert post.title == "其他页面的新标题" and post.deleted_at is None
    assert post.status is BlogPostStatus.DRAFT


@pytest.mark.anyio
@pytest.mark.parametrize("changes, reason", [
    ({"scheduled_at": "2020-01-01T09:00:00+08:00"}, "晚于当前时间"),
    ({"scheduled_at": "2099-01-01T09:00:00"}, "时区偏移"),
    ({"category_ids": [str(uuid4())]}, "分类不存在"),
    ({"tags": [{"name": "误改共享名称", "slug": "engineering"}]}, "沿用其名称"),
    ({"schedule_at": "2099-01-01T09:00:00+08:00"}, "不支持的修改字段"),
])
async def test_agent_invalid_arguments_return_correctable_native_tool_errors(
    database_session: Session, monkeypatch: pytest.MonkeyPatch,
    changes: dict[str, object], reason: str,
) -> None:
    """无效参数不生成确认卡或写入，修正后同一个工具可继续处理。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert owner is not None and post is not None
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessionmaker(
        bind=database_session.get_bind(), expire_on_commit=False,
    ))
    tool = next(item for item in blog_agent_tools.build_blog_tools(Settings())
                if item.name == "update_post")
    with agent_invocation_context(owner.id, "owner", "blog"):
        result = await tool.ainvoke({
            "type": "tool_call", "name": "update_post", "id": "bad", "args": {
                "post_id": str(post.id), "changes": json.dumps(changes),
                "expected_updated_at": post.updated_at.replace(tzinfo=UTC).isoformat(),
            },
        })
        assert result.status == "error" and reason in result.content
        assert post.title == "尚未发布的草稿" and post.scheduled_at is None
        valid = json.loads(await tool.ainvoke({
            "post_id": str(post.id), "changes": '{"excerpt":"修正后的摘要"}',
            "expected_updated_at": post.updated_at.replace(tzinfo=UTC).isoformat(),
        }))
        assert valid["type"] == "pending_action" and not valid["executed"]


@pytest.mark.anyio
async def test_agent_search_uses_taxonomies_and_literal_text(
    database_session: Session, monkeypatch: pytest.MonkeyPatch,
) -> None:
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "private-draft"))
    assert owner is not None and post is not None
    post.title = "100% 完成"
    category = BlogCategory(name="分类关键词", slug="topic")
    post.categories = [category]
    database_session.commit()
    monkeypatch.setattr(blog_agent_tools, "SessionLocal", sessionmaker(
        bind=database_session.get_bind(), expire_on_commit=False,
    ))
    with agent_invocation_context(owner.id, "owner", "blog"):
        assert [item["slug"] for item in json.loads(blog_agent_tools._search_posts("工程"))] == [
            "published-featured",
        ]
        matches = json.loads(blog_agent_tools._search_posts("分类关键词"))
        assert [item["slug"] for item in matches] == ["private-draft"]
        assert len(json.loads(blog_agent_tools._search_posts("100%"))) == 1
        assert json.loads(blog_agent_tools._search_posts("%"))[0]["title"] == "100% 完成"
        post.deleted_at = datetime.now(UTC)
        database_session.commit()
        assert json.loads(blog_agent_tools._search_posts("100%")) == []


@pytest.mark.anyio
async def test_links_crud_public_boundary_and_versions(
    client: AsyncClient, database_session: Session
) -> None:
    """验证隐藏默认值、公开字段、稳定排序、筛选和版本冲突。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    base = "/api/v1/admin/blog/links"
    assert (await client.get(base)).status_code == 401
    first = await client.post(
        base, headers=headers, json={"name": "  隐藏链接  ", "url": "https://example.com/private"}
    )
    assert first.status_code == 201
    hidden = first.json()
    assert hidden["name"] == "隐藏链接"
    assert hidden["is_visible"] is False
    assert (await client.get("/api/v1/blog/links")).json() == {"items": [], "total": 0}
    data = {"name": "公开 % 链接", "url": "https://example.com", "is_visible": True}
    created = await client.post(base, headers=headers, json={**data, "sort_order": 20})
    assert created.status_code == 201
    public = created.json()
    path = f"{base}/{public['id']}"
    updated = await client.put(
        path, headers=headers, json={**data, "expected_updated_at": public["updated_at"]}
    )
    assert updated.status_code == 200
    current = updated.json()
    assert current["updated_at"] != public["updated_at"]
    stale = {**data, "expected_updated_at": public["updated_at"]}
    assert (await client.put(path, headers=headers, json=stale)).status_code == 409
    assert (
        await client.delete(
            path, headers=headers, params={"expected_updated_at": public["updated_at"]}
        )
    ).status_code == 409
    visible = (await client.get("/api/v1/blog/links")).json()
    assert visible["total"] == 1
    assert set(visible["items"][0]) == {"id", "name", "url", "description"}
    assert visible["items"][0]["id"] == current["id"]
    listing = (await client.get(base, headers=headers, params={"visible": "false"})).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == hidden["id"]
    assert (await client.get(base, headers=headers, params={"q": "%"})).json()["total"] == 1
    assert (await client.get(base, headers=headers, params={"q": "_"})).json()["total"] == 0
    second = await client.post(
        base, headers=headers, json={**data, "name": "先显示", "sort_order": 0}
    )
    assert second.status_code == 201
    all_public = (await client.get("/api/v1/blog/links")).json()
    assert [item["name"] for item in all_public["items"]] == ["先显示", "公开 % 链接"]
    page = (await client.get("/api/v1/blog/links", params={"limit": 1, "offset": 1})).json()
    assert page["total"] == 2 and page["items"][0]["id"] == current["id"]
    assert (
        await client.delete(
            path, headers=headers, params={"expected_updated_at": current["updated_at"]}
        )
    ).status_code == 204
    assert (await client.put(path, headers=headers, json=stale)).status_code == 404
    assert (await client.get("/api/v1/blog/links")).json()["total"] == 1


@pytest.mark.anyio
@pytest.mark.parametrize(
    "changes",
    [
        {"url": "javascript:alert(1)"},
        {"url": "ftp://example.com"},
        {"url": "https://user:password@example.com"},
        {"name": "   "},
        {"name": "字" * 81},
        {"description": "字" * 241},
        {"sort_order": -1},
        {"sort_order": 10000},
        {"sort_order": 1.5},
    ],
)
async def test_links_reject_invalid_fields(
    client: AsyncClient, database_session: Session, changes: dict[str, object]
) -> None:
    """无效输入不会写入；URL 仅接受不含凭据的 HTTP(S) 地址。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    response = await client.post(
        "/api/v1/admin/blog/links",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "测试链接", "url": "https://example.com", **changes},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_comment_avatar_preview(
    client: AsyncClient, database_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """预览须登录并校验 QQ，不写评论，响应不缓存；上游失败可重试。"""
    add_blog_content(database_session)
    calls: list[str] = []

    def avatar(number: str) -> tuple[bytes, str]:
        calls.append(number)
        return b"image", "image/png"

    monkeypatch.setattr("genesis_api.api.routes.blog_comments.qq_avatar", avatar)
    url = "/api/v1/blog/comments/avatar-preview"
    assert (await client.post(url, json={"qq": "12345@qq.com"})).status_code == 401
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    for value in ("", " ", "alias@qq.com", "1234", "12345@example.com"):
        assert (await client.post(url, headers=headers, json={"qq": value})).status_code == 422
    assert calls == []
    response = await client.post(url, headers=headers, json={"qq": " 12345@QQ.com "})
    assert response.status_code == 200 and response.content == b"image"
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert calls == ["12345"]
    assert list(database_session.scalars(select(BlogComment))) == []
    monkeypatch.setattr("genesis_api.api.routes.blog_comments.qq_avatar", lambda number: None)
    assert (await client.post(url, headers=headers, json={"qq": "12345"})).status_code == 502


@pytest.mark.anyio
async def test_comment_submission_moderation_and_public_boundary(
    client: AsyncClient, database_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """读者提交先待审核；只有作者可审核，公开数据不暴露账号或审核元数据。"""
    add_blog_content(database_session)
    owner_token = await authenticate_owner(client, database_session)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "handle": "comment-reader",
            "display_name": "评论读者",
            "password": "test-comment-password",
        },
    )
    assert registered.status_code == 201
    logged_in = await client.post(
        "/api/v1/auth/login",
        data={"username": "comment-reader", "password": "test-comment-password"},
    )
    assert logged_in.status_code == 200
    reader_headers = {
        "Authorization": f"Bearer {logged_in.json()['access_token']}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/132.0.0.0 Safari/537.36",
    }
    url = "/api/v1/blog/posts/published-featured/comments"
    monkeypatch.setattr("genesis_api.api.routes.blog_comments.lookup_region", lambda host: "浙江省")
    monkeypatch.setattr(
        "genesis_api.api.routes.blog_comments.qq_avatar", lambda number: (b"image", "image/png")
    )
    data = {
        "content": "  纯文本 <script>自检</script> %  ",
        "submission_id": str(uuid4()),
        "qq": "12345@qq.com",
        "show_region": True,
        "device_hints": {
            "platform": "Windows",
            "platform_version": "15.0.0",
            "full_version_list": [{"brand": "Google Chrome", "version": "132.0.6834.110"}],
        },
    }
    assert (await client.post(url, json=data)).status_code == 401
    first = await client.post(url, headers=reader_headers, json=data)
    assert first.status_code == 201 and first.json()["state"] == "pending"
    receipt = first.json()
    avatar_url = f"/api/v1/blog/comments/{receipt['id']}/avatar"
    assert (await client.get(avatar_url)).status_code == 404
    assert set(receipt) == {"id", "state"}
    assert (await client.post(url, headers=reader_headers, json=data)).json() == receipt
    assert len(list(database_session.scalars(select(BlogComment)))) == 1
    assert (await client.get(url)).json() == {"items": [], "total": 0}
    assert (
        await client.post(
            url,
            headers=reader_headers,
            json={
                **data,
                "content": "修改后复用标识",
            },
        )
    ).status_code == 409
    for content in ("   ", "字" * 2001):
        assert (
            await client.post(
                url,
                headers=reader_headers,
                json={
                    "content": content,
                    "submission_id": str(uuid4()),
                },
            )
        ).status_code == 422
    assert (
        await client.post(
            url,
            headers=reader_headers,
            json={
                **data,
                "state": "public",
            },
        )
    ).status_code == 422
    base = "/api/v1/admin/blog/comments"
    assert (await client.get(base, headers=reader_headers)).status_code == 403
    row = (await client.get(base, headers=owner_headers, params={"q": "%"})).json()["items"][0]
    path = f"{base}/{row['id']}"
    mutation = {"state": "public", "expected_updated_at": row["updated_at"]}
    assert (await client.put(path, headers=reader_headers, json=mutation)).status_code == 403
    assert (
        await client.delete(
            path,
            headers=reader_headers,
            params={
                "expected_updated_at": row["updated_at"],
            },
        )
    ).status_code == 403
    approved = await client.put(path, headers=owner_headers, json=mutation)
    assert approved.status_code == 200
    public = (await client.get(url)).json()
    assert public["total"] == 1
    assert set(public["items"][0]) == {
        "id",
        "content",
        "author_name",
        "created_at",
        "avatar_url",
        "region",
        "browser",
        "operating_system",
    }
    assert public["items"][0]["content"] == str(data["content"]).strip()
    assert public["items"][0]["region"] == "浙江省"
    assert public["items"][0]["operating_system"] == "Windows 11"
    assert public["items"][0]["browser"] == "Chrome 132.0.6834.110"
    assert public["items"][0]["avatar_url"] == avatar_url
    assert "12345" not in str(public)
    avatar = await client.get(avatar_url)
    assert avatar.status_code == 200 and avatar.content == b"image"
    assert avatar.headers["X-Content-Type-Options"] == "nosniff"
    monkeypatch.setattr("genesis_api.api.routes.blog_comments.qq_avatar", lambda number: None)
    assert (await client.get(avatar_url)).status_code == 502
    assert (await client.put(path, headers=owner_headers, json=mutation)).status_code == 409
    assert (
        await client.delete(
            path,
            headers=owner_headers,
            params={
                "expected_updated_at": row["updated_at"],
            },
        )
    ).status_code == 409
    hidden = await client.put(
        path,
        headers=owner_headers,
        json={
            "state": "hidden",
            "expected_updated_at": approved.json()["updated_at"],
        },
    )
    assert hidden.status_code == 200
    assert (await client.get(avatar_url)).status_code == 404
    assert (await client.get(url)).json()["total"] == 0
    listing = (
        await client.get(
            base,
            headers=owner_headers,
            params={
                "state": "hidden",
                "limit": 1,
                "offset": 1,
            },
        )
    ).json()
    assert listing == {"items": [], "total": 1}
    assert (
        await client.delete(
            path,
            headers=owner_headers,
            params={
                "expected_updated_at": hidden.json()["updated_at"],
            },
        )
    ).status_code == 204
    assert (await client.put(path, headers=owner_headers, json=mutation)).status_code == 404
    assert (await client.get(url)).json()["total"] == 0


@pytest.mark.anyio
async def test_comment_drafts_rate_limits_and_unpublishing(
    client: AsyncClient, database_session: Session
) -> None:
    """草稿不可读写评论，限频不影响幂等重试，文章撤回后评论也不可读取。"""
    add_blog_content(database_session)
    token = await authenticate_owner(client, database_session)
    headers = {"Authorization": f"Bearer {token}"}
    draft = database_session.scalar(select(BlogPost).where(BlogPost.status == BlogPostStatus.DRAFT))
    assert draft is not None
    draft_url = f"/api/v1/blog/posts/{draft.slug}/comments"
    data = {"content": "测试评论", "submission_id": str(uuid4())}
    assert (await client.get(draft_url)).status_code == 404
    assert (await client.post(draft_url, headers=headers, json=data)).status_code == 404
    url = "/api/v1/blog/posts/published-featured/comments"
    for _ in range(5):
        data = {"content": "测试评论", "submission_id": str(uuid4())}
        assert (await client.post(url, headers=headers, json=data)).status_code == 201
    assert (await client.post(url, headers=headers, json=data)).status_code == 201
    limited = await client.post(url, headers=headers, json={**data, "submission_id": str(uuid4())})
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "60"
    post = database_session.scalar(select(BlogPost).where(BlogPost.slug == "published-featured"))
    assert post is not None
    post.status = BlogPostStatus.DRAFT
    database_session.commit()
    assert (await client.get(url)).status_code == 404


@pytest.mark.anyio
@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "DELETE"])
@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/blog/pages",
        "/api/v1/blog/pages/about",
        "/api/v1/admin/blog/pages",
        "/api/v1/admin/blog/pages/00000000-0000-0000-0000-000000000001",
    ],
)
async def test_retired_page_endpoints_are_unavailable(
    client: AsyncClient, method: str, path: str
) -> None:
    """停用页面功能后，公开与管理接口均不再接受请求。"""
    assert (await client.request(method, path)).status_code == 404


@pytest.mark.anyio
async def test_retired_pages_keep_historical_data(
    client: AsyncClient, database_session: Session
) -> None:
    """保留旧页面记录，但即使已发布也不再通过接口公开或删除。"""
    add_blog_content(database_session)
    owner = database_session.scalar(select(User).where(User.handle == "genesis"))
    assert owner is not None
    now = datetime.now(UTC)
    page = BlogPage(
        id=uuid4(),
        author_id=owner.id,
        slug="retired-about",
        title="历史页面",
        excerpt="保留已有内容",
        content_markdown="# 历史正文",
        status=BlogPostStatus.PUBLISHED,
        published_at=now,
        created_at=now,
        updated_at=now,
    )
    database_session.commit()

    assert (await client.get("/api/v1/blog/pages/retired-about")).status_code == 404
    token = await authenticate_owner(client, database_session)
    database_session.add(page)
    assert (
        await client.delete(
            f"/api/v1/admin/blog/pages/{page.id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    ).status_code == 404
    database_session.expire_all()
    retained = database_session.get(BlogPage, page.id)
    assert retained is not None and retained.content_markdown == "# 历史正文"
    assert (await client.get("/api/v1/blog/posts/published-featured")).status_code == 200
