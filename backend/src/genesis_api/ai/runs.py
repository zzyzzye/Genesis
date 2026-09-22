from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.ai.models import AiChatRun, AiChatRunStatus
from genesis_api.ai.schemas import AiChatRequest, AiChatRunCreated, AiChatRunSnapshot
from genesis_api.ai.service import AgentService
from genesis_api.core.config import Settings
from genesis_api.database.session import SessionLocal

logger = logging.getLogger(__name__)
SessionFactory = Callable[[], Session]


class ChatStreamer(Protocol):
    def stream(self, request: AiChatRequest, *, thread_id: str) -> AsyncIterator[str]:
        ...


ChatServiceFactory = Callable[[Settings], ChatStreamer]


def _configured_model(settings: Settings, provider: str) -> str | None:
    if provider == "openai":
        return settings.text_openai_model
    if provider == "grok":
        return settings.text_grok_model
    if provider == "gemini":
        return settings.text_gemini_model
    if provider == "mimo":
        return settings.text_mimo_model
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
        thread_id=str(uuid4()),
        request_payload=_request_payload(request),
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
            lambda settings: AgentService(settings)
        )
        self._flush_interval = flush_interval
        self._flush_size = flush_size
        self._tasks: dict[UUID, asyncio.Task[None]] = {}
        self._semaphore: asyncio.Semaphore | None = None
        self._max_concurrent_runs: int | None = None

    def start(self, run_id: UUID, request: AiChatRequest, settings: Settings) -> None:
        if run_id in self._tasks:
            return
        if (
            self._semaphore is None
            or self._max_concurrent_runs != settings.agent_max_concurrent_runs
        ):
            self._semaphore = asyncio.Semaphore(settings.agent_max_concurrent_runs)
            self._max_concurrent_runs = settings.agent_max_concurrent_runs
        task = asyncio.create_task(
            self._generate(run_id, request, settings),
            name=f"ai-chat-run-{run_id}",
        )
        self._tasks[run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def recover_interrupted_runs(self, settings: Settings) -> None:
        recovered = await asyncio.to_thread(self._recover_interrupted_runs_sync)
        for run_id, request in recovered:
            self.start(run_id, request, settings)

    async def _generate(
        self,
        run_id: UUID,
        request: AiChatRequest,
        settings: Settings,
    ) -> None:
        semaphore = self._semaphore
        if semaphore is None:
            raise RuntimeError("AI 运行管理器尚未初始化")
        async with semaphore:
            await self._persist(run_id, status=AiChatRunStatus.RUNNING)
            pending = ""
            last_flush = asyncio.get_running_loop().time()
            try:
                streamer = self._chat_service_factory(settings)
                try:
                    token_stream = streamer.stream(request, thread_id=str(run_id))
                except TypeError as exc:
                    if "thread_id" not in str(exc):
                        raise
                    token_stream = cast(Any, streamer).stream(request)
                async for token in token_stream:
                    pending += token
                    now = asyncio.get_running_loop().time()
                    if (
                        len(pending) >= self._flush_size
                        or now - last_flush >= self._flush_interval
                    ):
                        await self._persist(run_id, append_content=pending)
                        pending = ""
                        last_flush = now
                await self._persist(
                    run_id,
                    append_content=pending,
                    status=AiChatRunStatus.COMPLETED,
                )
            except asyncio.CancelledError:
                # 保留 running 状态和 checkpoint，由下次启动恢复。
                raise
            except RuntimeError as exc:
                await self._persist(
                    run_id,
                    append_content=pending,
                    status=AiChatRunStatus.FAILED,
                    error=str(exc),
                )
            except Exception as exc:
                logger.exception("AI 后台生成任务失败：run_id=%s", run_id)
                error = "AI 生成失败，请稍后重试。"
                if "PermissionDenied" in type(exc).__name__ or "blocked" in str(exc).lower():
                    error = "模型服务拒绝了请求，请检查当前模型的 API Key、模型名称和服务商配置。"
                await self._persist(
                    run_id,
                    append_content=pending,
                    status=AiChatRunStatus.FAILED,
                    error=error,
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

    def _recover_interrupted_runs_sync(self) -> list[tuple[UUID, AiChatRequest]]:
        recovered: list[tuple[UUID, AiChatRequest]] = []
        with self._session_factory() as session:
            runs = session.scalars(
                select(AiChatRun).where(
                    AiChatRun.status.in_([AiChatRunStatus.PENDING, AiChatRunStatus.RUNNING])
                )
            )
            for run in runs:
                try:
                    request = _request_from_payload(run.request_payload)
                except ValueError:
                    run.status = AiChatRunStatus.FAILED
                    run.error = "任务缺少可恢复的请求数据，请重新发起。"
                    run.completed_at = datetime.now(UTC)
                    continue
                run.status = AiChatRunStatus.PENDING
                run.content = ""
                run.sequence += 1
                run.error = None
                run.completed_at = None
                recovered.append(
                    (run.id, request.model_copy(update={"resume_from_checkpoint": True}))
                )
            session.commit()
        return recovered


def _request_payload(request: AiChatRequest) -> dict[str, object]:
    payload = request.model_dump(mode="json")
    payload["actor_id"] = str(request.actor_id) if request.actor_id else None
    payload["actor_role"] = request.actor_role
    return cast(dict[str, object], payload)


def _request_from_payload(payload: dict[str, object]) -> AiChatRequest:
    if not payload:
        raise ValueError("empty request payload")
    return AiChatRequest.model_validate(payload)


ai_chat_run_manager = AiChatRunManager()
