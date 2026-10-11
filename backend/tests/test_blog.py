"""验证博客公开查询、后台写入、分类标签与共享账号权限。"""

from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.api.routes.blog import router
from genesis_api.blog.agent import actions as blog_actions
from genesis_api.blog.agent.actions import confirm_blog_action
from genesis_api.blog.models import BlogComment, BlogPost, BlogPostStatus, BlogTag
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


@pytest.mark.parametrize("action", ["create_draft", "update_post"])
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
        changes if action == "create_draft" else {"post_id": str(target.id), "changes": changes}
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
async def test_comment_submission_moderation_and_public_boundary(
    client: AsyncClient, database_session: Session
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
    reader_headers = {"Authorization": f"Bearer {logged_in.json()['access_token']}"}
    url = "/api/v1/blog/posts/published-featured/comments"
    data = {"content": "  纯文本 <script>自检</script> %  ", "submission_id": str(uuid4())}
    assert (await client.post(url, json=data)).status_code == 401
    first = await client.post(url, headers=reader_headers, json=data)
    assert first.status_code == 201 and first.json()["state"] == "pending"
    receipt = first.json()
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
    assert set(public["items"][0]) == {"id", "content", "author_name", "created_at"}
    assert public["items"][0]["content"] == data["content"].strip()
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
