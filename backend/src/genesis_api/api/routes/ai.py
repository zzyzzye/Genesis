from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from genesis_api.ai.schemas import AiChatRequest
from genesis_api.ai.service import AiChatService, AiProviderError
from genesis_api.api.dependencies import CurrentUserDependency
from genesis_api.core.config import Settings, get_settings

router = APIRouter(prefix="/ai", tags=["ai"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


@router.post("/chat/stream")
async def stream_chat(
    request: AiChatRequest,
    _: CurrentUserDependency,
    settings: SettingsDependency,
) -> StreamingResponse:
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
