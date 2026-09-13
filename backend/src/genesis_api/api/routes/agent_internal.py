from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from jwt import encode
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from genesis_api.agent.auth import AgentContextDependency, require_agent_scope
from genesis_api.agent.contracts import (
    AgentActionPreviewRequest,
    AgentActionProposal,
    AgentContext,
    AgentPostDetail,
    AgentPostSummary,
)
from genesis_api.blog.models import BlogPost
from genesis_api.blog.service import get_blog_post_by_id, list_admin_posts
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import get_session
from genesis_api.identity.models import User

router = APIRouter(prefix="/internal/agent", tags=["Agent 内部 API"])
SessionDependency = Annotated[Session, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def _user(context: AgentContextDependency, session: SessionDependency) -> User:
    user = session.get(User, context.actor_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Agent 用户不存在")
    return user


def _summary(post: BlogPost) -> AgentPostSummary:
    return AgentPostSummary(
        id=post.id,
        title=post.title,
        excerpt=post.excerpt,
        status=post.status.value,
        updated_at=post.updated_at,
        category=post.category.name if post.category else None,
        tags=[tag.slug for tag in post.tags],
    )


@router.get("/posts", response_model=list[AgentPostSummary])
def list_agent_posts(
    context: AgentContextDependency,
    session: SessionDependency,
) -> list[AgentPostSummary]:
    _user(context, session)
    return [_summary(post) for post in list_admin_posts(session)]


@router.get("/posts/search", response_model=list[AgentPostSummary])
def search_agent_posts(
    context: AgentContextDependency,
    session: SessionDependency,
    query: str = Query(min_length=1, max_length=200),
) -> list[AgentPostSummary]:
    _user(context, session)
    pattern = f"%{query}%"
    posts = session.scalars(
        select(BlogPost)
        .where(
            or_(
                BlogPost.title.ilike(pattern),
                BlogPost.excerpt.ilike(pattern),
                BlogPost.content_markdown.ilike(pattern),
                BlogPost.slug.ilike(pattern),
            )
        )
        .options(selectinload(BlogPost.category), selectinload(BlogPost.tags))
        .order_by(BlogPost.updated_at.desc())
    )
    return [_summary(post) for post in posts]


@router.get("/posts/{post_id}", response_model=AgentPostDetail)
def get_agent_post(
    post_id: UUID,
    context: AgentContextDependency,
    session: SessionDependency,
) -> AgentPostDetail:
    _user(context, session)
    post = get_blog_post_by_id(session, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    return AgentPostDetail(
        **_summary(post).model_dump(),
        content_markdown=post.content_markdown,
        slug=post.slug,
    )


@router.get("/posts/{post_id}/context", response_model=AgentPostDetail)
def get_agent_post_context(
    post_id: UUID,
    context: AgentContextDependency,
    session: SessionDependency,
) -> AgentPostDetail:
    return get_agent_post(post_id, context, session)


@router.post("/actions/preview", response_model=AgentActionProposal)
def preview_agent_action(
    request: AgentActionPreviewRequest,
    context: Annotated[AgentContext, Depends(require_agent_scope("agent:propose"))],
    session: SessionDependency,
    settings: SettingsDependency,
) -> AgentActionProposal:
    _user(context, session)
    payload = request.payload
    if request.action in {"update_post", "delete_post", "publish_post"}:
        try:
            post_id = UUID(str(payload.get("post_id")))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="post_id 无效") from exc
        if get_blog_post_by_id(session, post_id) is None:
            raise HTTPException(status_code=404, detail="文章不存在")
    required = ("title", "excerpt", "content_markdown", "slug")
    if request.action == "create_draft" and any(not payload.get(key) for key in required):
        raise HTTPException(status_code=422, detail="创建草稿缺少必要字段")

    proposal_id = uuid4()
    expires_at = datetime.now(UTC) + timedelta(minutes=10)
    token = encode(
        {
            "proposal_id": str(proposal_id),
            "actor_id": str(context.actor_id),
            "action": request.action,
            "payload": payload,
            "iat": datetime.now(UTC),
            "exp": expires_at,
        },
        settings.agent_context_secret.get_secret_value(),
        algorithm="HS256",
    )
    return AgentActionProposal(
        proposal_id=proposal_id,
        action=request.action,
        payload=payload,
        summary=f"确认{request.action}操作",
        expires_at=expires_at,
        proposal_token=token,
    )
