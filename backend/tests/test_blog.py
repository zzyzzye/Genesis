from collections.abc import AsyncGenerator, Generator
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.api.routes.blog import router
from genesis_api.blog.models import BlogPost, BlogPostStatus, BlogTag
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
    with Session(database_engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
async def client(database_session: Session) -> AsyncGenerator[AsyncClient, None]:
    def override_get_session() -> Generator[Session, None, None]:
        yield database_session

    app.dependency_overrides[get_session] = override_get_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def add_blog_content(session: Session) -> None:
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
    delete_response = await client.delete(
        f"/api/v1/admin/blog/posts/{created_post['id']}",
        headers=headers,
    )

    assert update_response.status_code == 200
    assert update_response.json()["published_at"] is not None
    assert public_response.status_code == 200
    assert public_response.json()["tags"][0]["name"] == "工程实践"
    assert duplicate_response.status_code == 409
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


def test_production_settings_require_a_non_default_jwt_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production")

    settings = Settings(
        environment="production",
        jwt_secret=SecretStr("a-different-production-secret"),
    )
    assert settings.jwt_secret.get_secret_value() == "a-different-production-secret"
