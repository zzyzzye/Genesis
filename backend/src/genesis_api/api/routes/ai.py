from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from time import monotonic
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from genesis_api.agent.context import build_studio_agent_context
from genesis_api.ai.models import AiChatRunStatus
from genesis_api.ai.runs import (
    ai_chat_run_manager,
    create_ai_chat_run,
    get_ai_chat_run_snapshot,
)
from genesis_api.ai.schemas import (
    AiActionConfirmation,
    AiChatRequest,
    AiChatRunCreated,
    AiChatRunSnapshot,
    AiContext,
)
from genesis_api.api.dependencies import CurrentUserDependency, OwnerDependency, SessionDependency
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import UserRole

router = APIRouter(prefix="/ai", tags=["ai"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]
logger = logging.getLogger(__name__)


def _prepare_request(
    request: AiChatRequest,
    *,
    current_user_role: UserRole,
    session: SessionDependency,
) -> AiChatRequest:
    if request.surface == "studio" and current_user_role is not UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="博客后台 AI 仅限站点所有者使用",
        )

    if request.surface != "studio":
        return request

    context = request.context or AiContext()
    agent_context = build_studio_agent_context(
        session,
        route=context.route,
        section=context.section,
        page_type=context.page_type,
        post_id=context.post_id,
        title=context.title,
        excerpt=context.excerpt,
        content_markdown=context.content_markdown,
        editor_status=context.editor_status,
    )
    return request.model_copy(update={"context": context.model_copy(update=agent_context)})


def _load_snapshot(run_id: UUID, user_id: UUID) -> AiChatRunSnapshot | None:
    with SessionLocal() as session:
        return get_ai_chat_run_snapshot(session, run_id=run_id, user_id=user_id)


def _encode_event(payload: dict[str, object], *, event_id: int | None = None) -> str:
    prefix = f"id: {event_id}\n" if event_id is not None else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_response(run_id: UUID, user_id: UUID, request: Request) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        last_sequence = -1
        last_content = ""
        last_heartbeat = monotonic()

        while True:
            snapshot = await asyncio.to_thread(_load_snapshot, run_id, user_id)
            if snapshot is None:
                yield _encode_event({"type": "error", "message": "AI 生成任务不存在"})
                return

            if last_sequence < 0:
                yield _encode_event(
                    {
                        "type": "snapshot",
                        "run_id": str(snapshot.id),
                        "content": snapshot.content,
                        "sequence": snapshot.sequence,
                    },
                    event_id=snapshot.sequence,
                )
            elif snapshot.sequence != last_sequence:
                if snapshot.content.startswith(last_content):
                    delta = snapshot.content[len(last_content) :]
                    if delta:
                        yield _encode_event(
                            {
                                "type": "token",
                                "content": delta,
                                "sequence": snapshot.sequence,
                            },
                            event_id=snapshot.sequence,
                        )
                else:
                    yield _encode_event(
                        {
                            "type": "snapshot",
                            "run_id": str(snapshot.id),
                            "content": snapshot.content,
                            "sequence": snapshot.sequence,
                        },
                        event_id=snapshot.sequence,
                    )

            last_sequence = snapshot.sequence
            last_content = snapshot.content

            if snapshot.status is AiChatRunStatus.COMPLETED:
                yield _encode_event(
                    {"type": "done", "sequence": snapshot.sequence},
                    event_id=snapshot.sequence,
                )
                return
            if snapshot.status is AiChatRunStatus.FAILED:
                yield _encode_event(
                    {
                        "type": "error",
                        "message": snapshot.error or "AI 生成失败",
                        "sequence": snapshot.sequence,
                    },
                    event_id=snapshot.sequence,
                )
                return
            if await request.is_disconnected():
                return

            now = monotonic()
            if now - last_heartbeat >= 10:
                yield ": keep-alive\n\n"
                last_heartbeat = now
            await asyncio.sleep(0.12)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _start_run(
    request: AiChatRequest,
    *,
    current_user: CurrentUserDependency,
    session: SessionDependency,
    settings: Settings,
) -> AiChatRunCreated:
    prepared_request = _prepare_request(
        request,
        current_user_role=current_user.role,
        session=session,
    )
    run = create_ai_chat_run(
        session,
        user_id=current_user.id,
        request=prepared_request,
        settings=settings,
    )
    ai_chat_run_manager.start(run.id, prepared_request, settings)
    return run


@router.post(
    "/chat/runs",
    response_model=AiChatRunCreated,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_chat_run(
    request: AiChatRequest,
    current_user: CurrentUserDependency,
    session: SessionDependency,
    settings: SettingsDependency,
) -> AiChatRunCreated:
    return _start_run(
        request,
        current_user=current_user,
        session=session,
        settings=settings,
    )


@router.get("/chat/runs/{run_id}", response_model=AiChatRunSnapshot)
async def get_chat_run(
    run_id: UUID,
    current_user: CurrentUserDependency,
    session: SessionDependency,
) -> AiChatRunSnapshot:
    snapshot = get_ai_chat_run_snapshot(session, run_id=run_id, user_id=current_user.id)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 生成任务不存在")
    return snapshot


@router.get("/chat/runs/{run_id}/stream")
async def stream_chat_run(
    run_id: UUID,
    request: Request,
    current_user: CurrentUserDependency,
    session: SessionDependency,
) -> StreamingResponse:
    snapshot = get_ai_chat_run_snapshot(session, run_id=run_id, user_id=current_user.id)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 生成任务不存在")
    return _stream_response(run_id, current_user.id, request)


@router.post("/chat/stream")
async def stream_chat(
    chat_request: AiChatRequest,
    request: Request,
    current_user: CurrentUserDependency,
    session: SessionDependency,
    settings: SettingsDependency,
) -> StreamingResponse:
    """兼容旧客户端：任务仍在后台运行，但建议使用 runs 接口保存 run_id。"""
    run = _start_run(
        chat_request,
        current_user=current_user,
        session=session,
        settings=settings,
    )
    return _stream_response(run.id, current_user.id, request)

@router.post("/actions/confirm", response_model=object)
def confirm_agent_action(
    confirmation: AiActionConfirmation,
    current_user: OwnerDependency,
    session: SessionDependency,
) -> object:
    """执行已由用户确认的 Agent proposal；Agent 本身永远不直接写业务库。"""
    from genesis_api.blog.models import BlogPost, BlogPostStatus
    from genesis_api.blog.schemas import BlogPostWrite
    from genesis_api.blog.service import apply_post_data, get_blog_post_by_id

    payload = confirmation.payload
    if confirmation.action == "delete_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        session.delete(post)
        session.commit()
        return {"action": confirmation.action, "post_id": str(post_id), "status": "deleted"}

    if confirmation.action == "publish_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        post.status = BlogPostStatus.PUBLISHED
        session.commit()
        return {"action": confirmation.action, "post_id": str(post_id), "status": "published"}

    if confirmation.action == "update_post":
        post_id = _payload_uuid(payload, "post_id")
        post = get_blog_post_by_id(session, post_id)
        if post is None:
            raise HTTPException(status_code=404, detail="文章不存在")
        changes = payload.get("changes")
        if isinstance(changes, str):
            try:
                changes = json.loads(changes)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=422, detail="changes 必须是 JSON") from exc
        if not isinstance(changes, dict):
            raise HTTPException(status_code=422, detail="changes 必须是 JSON 对象")
        data = BlogPostWrite.model_validate({
            "slug": changes.get("slug", post.slug),
            "title": changes.get("title", post.title),
            "excerpt": changes.get("excerpt", post.excerpt),
            "content_markdown": changes.get("content_markdown", post.content_markdown),
            "cover_image_url": changes.get("cover_image_url", post.cover_image_url),
            "category_id": changes.get("category_id", post.category_id),
            "status": changes.get("status", post.status),
            "is_featured": changes.get("is_featured", post.is_featured),
            "read_time_minutes": changes.get("read_time_minutes", post.read_time_minutes),
            "published_at": changes.get("published_at", post.published_at),
            "tags": changes.get(
                "tags", [{"name": tag.name, "slug": tag.slug} for tag in post.tags]
            ),
        })
        try:
            apply_post_data(session, post, data)
            session.commit()
        except ValueError as exc:
            session.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"action": confirmation.action, "post_id": str(post_id), "status": "updated"}

    required = ("title", "excerpt", "content_markdown", "slug")
    if any(not isinstance(payload.get(key), str) or not payload[key] for key in required):
        raise HTTPException(status_code=422, detail="创建草稿缺少必要字段")
    post = BlogPost(author=current_user)
    session.add(post)
    data = BlogPostWrite.model_validate({
        "title": payload["title"], "excerpt": payload["excerpt"],
        "content_markdown": payload["content_markdown"], "slug": payload["slug"],
        "status": BlogPostStatus.DRAFT,
    })
    try:
        apply_post_data(session, post, data)
        session.commit()
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"action": confirmation.action, "post_id": str(post.id), "status": "created"}


def _payload_uuid(payload: dict[str, object], key: str) -> UUID:
    value = payload.get(key)
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"{key} 无效") from exc
