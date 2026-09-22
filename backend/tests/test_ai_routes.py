from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, Request
from jwt import encode
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.agent.contracts import AgentActionConfirmation
from genesis_api.ai.models import AiChatRunStatus
from genesis_api.ai.schemas import (
    AiChatRequest,
    AiChatRunCreated,
    AiChatRunSnapshot,
    AiContext,
    AiMessage,
)
from genesis_api.api.routes import ai as ai_route
from genesis_api.blog.models import BlogPost, BlogPostStatus
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole


def session_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker[Session](bind=engine, expire_on_commit=False)


def proposal_token(
    settings: Settings,
    actor_id: UUID,
    action: str,
    payload: object,
) -> str:
    return encode(
        {
            "actor_id": str(actor_id),
            "action": action,
            "payload": payload,
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(minutes=10),
        },
        settings.agent_action_secret.get_secret_value(),
        algorithm="HS256",
    )


def test_prepare_request_embeds_authenticated_actor_and_studio_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = User(id=uuid4(), handle="owner", display_name="Owner", role=UserRole.OWNER)
    request = AiChatRequest(
        surface="blog", messages=[AiMessage(role="user", content="你好")]
    )
    prepared = ai_route._prepare_request(
        request,
        current_user=owner,
        current_user_role=owner.role,
        session=pytest.MonkeyPatch(),  # type: ignore[arg-type]
    )
    assert prepared.actor_id == owner.id
    assert prepared.actor_role == "owner"

    monkeypatch.setattr(
        ai_route,
        "build_studio_agent_context",
        lambda *_args, **_kwargs: {"page": {"type": "overview"}},
    )
    studio = ai_route._prepare_request(
        AiChatRequest(
            surface="studio",
            messages=[AiMessage(role="user", content="后台")],
            context=AiContext(route="/studio"),
        ),
        current_user=owner,
        current_user_role=owner.role,
        session=pytest.MonkeyPatch(),  # type: ignore[arg-type]
    )
    assert studio.context is not None
    assert studio.context.page == {"type": "overview"}

    member = User(id=uuid4(), handle="member", display_name="Member", role=UserRole.MEMBER)
    with pytest.raises(HTTPException) as exc_info:
        ai_route._prepare_request(
            AiChatRequest(
                surface="studio", messages=[AiMessage(role="user", content="越权")]
            ),
            current_user=member,
            current_user_role=member.role,
            session=pytest.MonkeyPatch(),  # type: ignore[arg-type]
        )
    assert exc_info.value.status_code == 403


def test_confirm_agent_action_validates_signed_proposals() -> None:
    factory = session_factory()
    settings = Settings(agent_action_secret=SecretStr("x" * 32))
    with factory() as session:
        owner = User(handle="owner", display_name="Owner", role=UserRole.OWNER)
        session.add(owner)
        session.commit()

        with pytest.raises(HTTPException) as invalid:
            ai_route.confirm_agent_action(
                AgentActionConfirmation(proposal_token="invalid"), owner, session, settings
            )
        assert invalid.value.status_code == 422

        wrong_actor = proposal_token(settings, uuid4(), "create_draft", {})
        with pytest.raises(HTTPException) as forbidden:
            ai_route.confirm_agent_action(
                AgentActionConfirmation(proposal_token=wrong_actor), owner, session, settings
            )
        assert forbidden.value.status_code == 403

        invalid_action = proposal_token(settings, owner.id, "unknown", {})
        with pytest.raises(HTTPException) as bad_action:
            ai_route.confirm_agent_action(
                AgentActionConfirmation(proposal_token=invalid_action), owner, session, settings
            )
        assert bad_action.value.status_code == 422

        invalid_payload = proposal_token(settings, owner.id, "create_draft", "bad")
        with pytest.raises(HTTPException) as bad_payload:
            ai_route.confirm_agent_action(
                AgentActionConfirmation(proposal_token=invalid_payload), owner, session, settings
            )
        assert bad_payload.value.status_code == 422


def test_confirm_agent_action_executes_all_blog_mutations() -> None:
    factory = session_factory()
    settings = Settings(agent_action_secret=SecretStr("x" * 32))
    with factory() as session:
        owner = User(handle="owner", display_name="Owner", role=UserRole.OWNER)
        session.add(owner)
        session.commit()

        create_payload = {
            "title": "Agent 草稿",
            "excerpt": "摘要",
            "content_markdown": "# 正文",
            "slug": "agent-draft",
        }
        created = ai_route.confirm_agent_action(
            AgentActionConfirmation(
                proposal_token=proposal_token(
                    settings, owner.id, "create_draft", create_payload
                )
            ),
            owner,
            session,
            settings,
        )
        assert isinstance(created, dict)
        post_id = UUID(created["post_id"])

        updated = ai_route.confirm_agent_action(
            AgentActionConfirmation(
                proposal_token=proposal_token(
                    settings,
                    owner.id,
                    "update_post",
                    {"post_id": str(post_id), "changes": '{"title":"新标题"}'},
                )
            ),
            owner,
            session,
            settings,
        )
        assert isinstance(updated, dict) and updated["status"] == "updated"
        assert session.get(BlogPost, post_id).title == "新标题"  # type: ignore[union-attr]

        published = ai_route.confirm_agent_action(
            AgentActionConfirmation(
                proposal_token=proposal_token(
                    settings, owner.id, "publish_post", {"post_id": str(post_id)}
                )
            ),
            owner,
            session,
            settings,
        )
        assert isinstance(published, dict) and published["status"] == "published"
        assert session.get(BlogPost, post_id).status is BlogPostStatus.PUBLISHED  # type: ignore[union-attr]

        deleted = ai_route.confirm_agent_action(
            AgentActionConfirmation(
                proposal_token=proposal_token(
                    settings, owner.id, "delete_post", {"post_id": str(post_id)}
                )
            ),
            owner,
            session,
            settings,
        )
        assert isinstance(deleted, dict) and deleted["status"] == "deleted"
        assert session.scalar(select(BlogPost).where(BlogPost.id == post_id)) is None


@pytest.mark.anyio
async def test_chat_run_routes_keep_public_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = uuid4()
    user = User(id=uuid4(), handle="owner", display_name="Owner", role=UserRole.OWNER)
    request = AiChatRequest(
        surface="studio", messages=[AiMessage(role="user", content="执行")]
    )
    created = AiChatRunCreated(id=run_id, status=AiChatRunStatus.PENDING)
    snapshot = AiChatRunSnapshot(
        id=run_id,
        status=AiChatRunStatus.RUNNING,
        content="内容",
        sequence=1,
    )
    starts: list[UUID] = []
    cancellations: list[UUID] = []
    monkeypatch.setattr(ai_route, "_prepare_request", lambda value, **_: value)
    monkeypatch.setattr(ai_route, "create_ai_chat_run", lambda *_, **__: created)
    monkeypatch.setattr(
        cast(Any, ai_route).ai_chat_run_manager,
        "start",
        lambda value, *_: starts.append(value),
    )
    monkeypatch.setattr(ai_route, "get_ai_chat_run_snapshot", lambda *_, **__: snapshot)
    async def cancel(value: UUID) -> None:
        cancellations.append(value)
    monkeypatch.setattr(cast(Any, ai_route).ai_chat_run_manager, "cancel", cancel)
    response_marker = cast(Any, object())
    monkeypatch.setattr(ai_route, "_stream_response", lambda *_: response_marker)

    assert ai_route._start_run(
        request, current_user=user, session=cast(Any, object()), settings=Settings()
    ) == created
    assert starts == [run_id]
    assert await ai_route.create_chat_run(
        request, user, cast(Any, object()), Settings()
    ) == created
    assert await ai_route.get_chat_run(run_id, user, cast(Any, object())) == snapshot
    assert await ai_route.cancel_chat_run(run_id, user, cast(Any, object())) is None
    assert cancellations == [run_id]
    assert await ai_route.stream_chat_run(
        run_id, cast(Request, object()), user, cast(Any, object())
    ) is response_marker
    assert await ai_route.stream_chat(
        request, cast(Request, object()), user, cast(Any, object()), Settings()
    ) is response_marker

    monkeypatch.setattr(ai_route, "get_ai_chat_run_snapshot", lambda *_, **__: None)
    with pytest.raises(HTTPException) as missing:
        await ai_route.get_chat_run(run_id, user, cast(Any, object()))
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as missing_stream:
        await ai_route.stream_chat_run(
            run_id, cast(Request, object()), user, cast(Any, object())
        )
    assert missing_stream.value.status_code == 404
    with pytest.raises(HTTPException) as missing_cancel:
        await ai_route.cancel_chat_run(run_id, user, cast(Any, object()))
    assert missing_cancel.value.status_code == 404


def test_confirm_action_rejects_missing_posts_and_bad_changes() -> None:
    factory = session_factory()
    settings = Settings(agent_action_secret=SecretStr("x" * 32))
    with factory() as session:
        owner = User(handle="owner", display_name="Owner", role=UserRole.OWNER)
        session.add(owner)
        session.commit()
        missing_id = uuid4()
        for action in ("delete_post", "publish_post", "update_post"):
            token = proposal_token(
                settings,
                owner.id,
                action,
                {"post_id": str(missing_id), "changes": "{}"},
            )
            with pytest.raises(HTTPException) as missing:
                ai_route.confirm_agent_action(
                    AgentActionConfirmation(proposal_token=token), owner, session, settings
                )
            assert missing.value.status_code == 404

        post = BlogPost(
            author=owner,
            slug="existing",
            title="Existing",
            excerpt="Excerpt",
            content_markdown="Body",
            status=BlogPostStatus.DRAFT,
        )
        session.add(post)
        session.commit()
        for changes in ("not-json", "[]"):
            token = proposal_token(
                settings,
                owner.id,
                "update_post",
                {"post_id": str(post.id), "changes": changes},
            )
            with pytest.raises(HTTPException) as invalid:
                ai_route.confirm_agent_action(
                    AgentActionConfirmation(proposal_token=token), owner, session, settings
                )
            assert invalid.value.status_code == 422
