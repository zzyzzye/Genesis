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
from jwt import InvalidTokenError, decode

from genesis_api.agent.capabilities import agent_capabilities
from genesis_api.agent.contracts import AgentActionConfirmation
from genesis_api.ai.models import AiChatRunStatus
from genesis_api.ai.runs import (
    ai_chat_run_manager,
    create_ai_chat_run,
    get_ai_chat_run_snapshot,
)
from genesis_api.ai.schemas import (
    AiChatRequest,
    AiChatRunCreated,
    AiChatRunSnapshot,
    AiContext,
)
from genesis_api.api.dependencies import CurrentUserDependency, OwnerDependency, SessionDependency
from genesis_api.blog.agent.context import build_blog_agent_context
from genesis_api.core.config import Settings, get_settings
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import User, UserRole

router = APIRouter(prefix="/ai", tags=["ai"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]
logger = logging.getLogger(__name__)


def _prepare_request(
    request: AiChatRequest,
    *,
    current_user: User,
    current_user_role: UserRole,
    session: SessionDependency,
) -> AiChatRequest:
    if request.surface == "studio" and current_user_role is not UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="博客后台 AI 仅限站点所有者使用",
        )

    if request.surface != "studio":
        return request.model_copy(
            update={
                "actor_id": current_user.id,
                "actor_role": current_user.role.value,
            }
        )

    context = request.context or AiContext()
    if context.module not in (None, "blog") or context.section not in (None, "posts"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="当前后台模块尚未提供 Agent 能力",
        )
    agent_context = build_blog_agent_context(
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
    return request.model_copy(
        update={
            "context": context.model_copy(update=agent_context),
            "actor_id": current_user.id,
            "actor_role": current_user.role.value,
        }
    )


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
        current_user=current_user,
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


@router.delete("/chat/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_chat_run(
    run_id: UUID,
    current_user: CurrentUserDependency,
    session: SessionDependency,
) -> None:
    snapshot = get_ai_chat_run_snapshot(session, run_id=run_id, user_id=current_user.id)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 生成任务不存在")
    if snapshot.status in (AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING):
        await ai_chat_run_manager.cancel(run_id)


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
    confirmation: AgentActionConfirmation,
    current_user: OwnerDependency,
    session: SessionDependency,
    settings: SettingsDependency,
) -> object:
    """执行已由用户确认的签名 proposal；Agent 本身永远不直接写业务库。"""
    try:
        proposal = decode(
            confirmation.proposal_token,
            settings.agent_action_secret.get_secret_value(),
            algorithms=["HS256"],
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=422, detail="操作提议无效或已过期") from exc
    if proposal.get("actor_id") != str(current_user.id):
        raise HTTPException(status_code=403, detail="操作提议不属于当前用户")
    module = proposal.get("module", "blog")
    action = proposal.get("action")
    payload = proposal.get("payload")
    if not isinstance(module, str) or not isinstance(action, str):
        raise HTTPException(status_code=422, detail="操作类型无效")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="操作参数无效")
    try:
        return agent_capabilities.confirm_action(
            module, action, payload, current_user=current_user, session=session
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
