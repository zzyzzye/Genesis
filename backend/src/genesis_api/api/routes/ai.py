from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from genesis_api.agent.context import build_studio_agent_context
from genesis_api.ai.schemas import AiChatRequest, AiContext
from genesis_api.ai.service import AiChatService, AiProviderError
from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.core.config import Settings, get_settings
from genesis_api.identity.models import UserRole

router = APIRouter(prefix="/ai", tags=["ai"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


@router.post("/chat/stream")
async def stream_chat(
    request: AiChatRequest,
    current_user: CurrentUserDependency,
    session: SessionDependency,
    settings: SettingsDependency,
) -> StreamingResponse:
    if request.surface == "studio" and current_user.role is not UserRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="博客后台 AI 仅限站点所有者使用",
        )

    # 博客 Studio 是单作者后台，AI 默认获得全量文章知识库；不暴露给公开博客。
    if request.surface == "studio":
        context = request.context or AiContext()
        agent_context = build_studio_agent_context(
            session,
            post_id=context.post_id,
            title=context.title,
            excerpt=context.excerpt,
            content_markdown=context.content_markdown,
        )
        request = request.model_copy(update={"context": context.model_copy(update=agent_context)})

    async def events() -> AsyncIterator[str]:
        try:
            async for token in AiChatService(settings).stream(request):
                payload = json.dumps({"type": "token", "content": token}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            yield 'data: {"type":"done"}\n\n'
        except AiProviderError as exc:
            payload = json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False)
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
