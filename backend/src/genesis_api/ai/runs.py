from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from genesis_api.ai.models import AiChatRun, AiChatRunStatus
from genesis_api.ai.schemas import AiChatRequest, AiChatRunCreated, AiChatRunSnapshot
from genesis_api.ai.service import AiChatService, AiProviderError
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal

logger = logging.getLogger(__name__)
SessionFactory = Callable[[], Session]


class ChatStreamer(Protocol):
    def stream(self, request: AiChatRequest) -> AsyncIterator[str]:
        ...


ChatServiceFactory = Callable[[Settings], ChatStreamer]


def _configured_model(settings: Settings, provider: str) -> str | None:
    if provider == "openai":
        return settings.text_openai_model
    if provider == "grok":
        return settings.text_grok_model
    if provider == "gemini":
        return settings.text_gemini_model
    return settings.text_claude_model


def create_ai_chat_run(
    session: Session,
    *,
    user_id: UUID,
    request: AiChatRequest,
    settings: Settings,
) -> AiChatRunCreated:
    provider = request.provider or settings.text_provider
    run = AiChatRun(
        user_id=user_id,
        surface=request.surface,
        provider=provider,
        model=request.model or _configured_model(settings, provider),
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return AiChatRunCreated(id=run.id, status=run.status)


def get_ai_chat_run_snapshot(
    session: Session,
    *,
    run_id: UUID,
    user_id: UUID,
) -> AiChatRunSnapshot | None:
    run = session.scalar(
        select(AiChatRun).where(AiChatRun.id == run_id, AiChatRun.user_id == user_id)
    )
    if run is None:
        return None
    return AiChatRunSnapshot(
        id=run.id,
        status=run.status,
        content=run.content,
        sequence=run.sequence,
        error=run.error,
    )


class AiChatRunManager:
    """在服务端独立执行模型流，并将可恢复快照持久化到数据库。"""

    def __init__(
        self,
        session_factory: SessionFactory = SessionLocal,
        chat_service_factory: ChatServiceFactory | None = None,
        *,
        flush_interval: float = 0.08,
        flush_size: int = 160,
    ) -> None:
        self._session_factory = session_factory
        self._chat_service_factory = chat_service_factory or (
            lambda settings: AiChatService(settings)
        )
        self._flush_interval = flush_interval
        self._flush_size = flush_size
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, run_id: UUID, request: AiChatRequest, settings: Settings) -> None:
        task = asyncio.create_task(
            self._generate(run_id, request, settings),
            name=f"ai-chat-run-{run_id}",
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def shutdown(self) -> None:
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def fail_interrupted_runs(self) -> None:
        await asyncio.to_thread(self._fail_interrupted_runs_sync)

    async def _generate(
        self,
        run_id: UUID,
        request: AiChatRequest,
        settings: Settings,
    ) -> None:
        await self._persist(run_id, status=AiChatRunStatus.RUNNING)
        pending = ""
        last_flush = asyncio.get_running_loop().time()
        try:
            async for token in self._chat_service_factory(settings).stream(request):
                pending += token
                now = asyncio.get_running_loop().time()
                if len(pending) >= self._flush_size or now - last_flush >= self._flush_interval:
                    await self._persist(run_id, append_content=pending)
                    pending = ""
                    last_flush = now
            await self._persist(
                run_id,
                append_content=pending,
                status=AiChatRunStatus.COMPLETED,
            )
        except asyncio.CancelledError:
            await self._persist(
                run_id,
                append_content=pending,
                status=AiChatRunStatus.FAILED,
                error="服务已停止，生成任务中断，请重新发起。",
            )
            raise
        except AiProviderError as exc:
            await self._persist(
                run_id,
                append_content=pending,
                status=AiChatRunStatus.FAILED,
                error=str(exc),
            )
        except Exception:
            logger.exception("AI 后台生成任务失败：run_id=%s", run_id)
            await self._persist(
                run_id,
                append_content=pending,
                status=AiChatRunStatus.FAILED,
                error="AI 生成失败，请稍后重试。",
            )

    async def _persist(
        self,
        run_id: UUID,
        *,
        append_content: str = "",
        status: AiChatRunStatus | None = None,
        error: str | None = None,
    ) -> None:
        await asyncio.to_thread(
            self._persist_sync,
            run_id,
            append_content,
            status,
            error,
        )

    def _persist_sync(
        self,
        run_id: UUID,
        append_content: str,
        status: AiChatRunStatus | None,
        error: str | None,
    ) -> None:
        with self._session_factory() as session:
            run = session.get(AiChatRun, run_id)
            if run is None:
                return
            if append_content:
                run.content += append_content
                run.sequence += 1
            if status is not None:
                run.status = status
                if status in (AiChatRunStatus.COMPLETED, AiChatRunStatus.FAILED):
                    run.completed_at = datetime.now(UTC)
            if error is not None:
                run.error = error
            session.commit()

    def _fail_interrupted_runs_sync(self) -> None:
        with self._session_factory() as session:
            session.execute(
                update(AiChatRun)
                .where(AiChatRun.status.in_([AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING]))
                .values(
                    status=AiChatRunStatus.FAILED,
                    error="服务已重启，生成任务中断，请重新发起。",
                    completed_at=datetime.now(UTC),
                )
            )
            session.commit()


ai_chat_run_manager = AiChatRunManager()
