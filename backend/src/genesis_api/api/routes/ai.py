"""AI API：注入登录身份、创建后台任务、传递快照和确认签名业务操作。"""

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
    """覆盖客户端身份字段，为博客后台补充数据库参考上下文。

    Args:
        request: 客户端对话请求，页面数据仅是编辑参考。
        current_user: 已认证的数据库用户，作为可信身份来源。
        current_user_role: 调用方传入的当前角色，用于检查后台访问权限。
        session: 当前请求会话，用于读取博客记录。

    Returns:
        注入可信身份后的请求副本，原请求不被原地修改。

    Raises:
        HTTPException: 非所有者访问 studio 返回 403，后台模块或栏目不支持返回 422。
    """
    if request.surface == "studio" and current_user_role is not UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="博客后台 AI 仅限站点所有者使用",
        )

    if request.surface != "studio":
        # 其他页面上下文仍是客户端参考数据，不代表数据库事实或业务访问权限。
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
    """为订阅轮询创建独立会话，返回当前用户的任务快照或 None。"""
    with SessionLocal() as session:
        return get_ai_chat_run_snapshot(session, run_id=run_id, user_id=user_id)


def _encode_event(payload: dict[str, object], *, event_id: int | None = None) -> str:
    """编码一条 SSE 数据事件，以空行结束供客户端分帧。

    Args:
        payload: 可 JSON 序列化的事件载荷，type 字段由调用方决定。
        event_id: 可选内容修订序号，不是 token 数。

    Returns:
        可直接写入 SSE 响应的文本，中文不转换为转义序列。
    """
    prefix = f"id: {event_id}\n" if event_id is not None else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_response(run_id: UUID, user_id: UUID, request: Request) -> StreamingResponse:
    """订阅已持久化的输出快照，连接断开不取消后台生成。

    Args:
        run_id: 已由路由检查访问权限的任务 UUID。
        user_id: 当前用户 UUID，后续轮询仍按归属过滤。
        request: HTTP 请求，用于检测客户端是否断开连接。

    Returns:
        禁用响应缓存与代理缓冲的 SSE 响应，首帧包含完整文本快照。
    """

    async def events() -> AsyncIterator[str]:
        """产出完整快照、文本增量、终态及心跳，内容重置时重发完整快照。

        Yields:
            已编码的 SSE 事件或心跳注释，终态与断开连接后停止轮询。
        """
        last_sequence = -1
        last_content = ""
        last_heartbeat = monotonic()

        while True:
            snapshot = await asyncio.to_thread(_load_snapshot, run_id, user_id)
            if snapshot is None:
                yield _encode_event({"type": "error", "message": "AI 生成任务不存在"})
                return

            if last_sequence < 0:
                # 每次新连接先发送完整内容，不要求浏览器保留上次连接的增量状态。
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
                    # 后台恢复可能重置内容，此时整段替换，不能继续追加旧文本。
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
                # 用户主动停止使用独立取消接口，离开页面仍可稍后重新订阅。
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
    """准备可信请求、提交任务记录，再启动与 HTTP 连接独立的生成。

    Args:
        request: 客户端对话消息及模型选项。
        current_user: 已认证的当前用户。
        session: 当前请求会话，用于上下文查询与任务创建。
        settings: 创建和执行任务使用的应用配置。

    Returns:
        已持久化的任务创建回执。

    Raises:
        HTTPException: 请求不符合后台权限或模块范围。
    """
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
    # 数据库记录已提交后再启动独立任务，SSE 的生命周期不拥有生成任务。
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
    """创建后台生成任务并返回 202 回执，客户端随后按任务 ID 订阅输出。

    Args:
        request: 已通过请求字段校验的对话输入。
        current_user: 身份依赖认证的用户。
        session: 当前请求会话。
        settings: 应用配置依赖。

    Returns:
        任务 ID 与初始状态，不等待模型生成完成。

    Raises:
        HTTPException: 博客后台权限不足或上下文模块不受支持。
    """
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
    """读取当前用户的任务快照，隐藏其他用户的任务是否存在。

    Args:
        run_id: 目标任务 UUID。
        current_user: 已认证用户，作为任务归属筛选条件。
        session: 当前请求会话。

    Returns:
        完整文本、状态及修订序号。

    Raises:
        HTTPException: 任务不存在或不属于当前用户，返回 404。
    """
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
    """停止当前用户的未完成任务，已进入终态的任务不重复取消。

    Args:
        run_id: 待停止的任务 UUID。
        current_user: 已认证用户，取消前检查任务归属。
        session: 归属查询使用的会话，取消状态由管理器独立保存。

    Raises:
        HTTPException: 任务不存在或不属于当前用户，返回 404。
    """
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
    """订阅当前用户的任务，重连先重放快照，再发送后续增量。

    Args:
        run_id: 已创建的任务 UUID。
        request: 当前连接请求，用于检测断开。
        current_user: 身份依赖认证的用户。
        session: 首次检查任务归属的数据库会话。

    Returns:
        SSE 响应，不拥有后台任务的生命周期。

    Raises:
        HTTPException: 任务不存在或不属于当前用户，返回 404。
    """
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
    """为旧客户端创建任务并直接返回订阅响应。

    Args:
        chat_request: 客户端对话输入，身份仍由服务端覆盖。
        request: 当前 HTTP 连接，用于订阅断开检测。
        current_user: 已认证用户。
        session: 上下文查询及任务创建使用的会话。
        settings: 应用配置依赖。

    Returns:
        后台任务的 SSE 响应；新客户端应使用 runs 接口保存任务 ID。
    """
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
    """验证签名提议后分派业务写入，仅接受令牌中的操作与载荷。

    Args:
        confirmation: 用户确认的提议令牌，不接受另外提交的可替换载荷。
        current_user: 所有者权限依赖校验的当前用户。
        session: 业务写操作使用的数据库会话。
        settings: 提议验签所需配置，不得输出相关凭据。

    Returns:
        业务模块执行操作后返回的结果。

    Raises:
        HTTPException: 令牌无效、过期或操作结构无效返回 422，
            提议不属于当前用户返回 403；业务层的 HTTP 错误原样传播。
        ValidationError: 业务载荷不符合对应写入契约。
    """
    # 使用验签后的操作载荷，并绑定当前 Owner；显示文本不是执行依据。
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
