"""后台文本任务与输出快照；模型执行状态的恢复由 LangGraph checkpoint 负责。"""

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
    """后台管理器依赖的最小流式服务协议，便于注入实现与测试替身。"""

    def stream(self, request: AiChatRequest, *, thread_id: str) -> AsyncIterator[str]:
        """提供后台管理器所需的流式调用接口。

        Args:
            request: 已完成身份注入的对话请求。
            thread_id: 本次执行对应的 checkpoint 线程标识。

        Returns:
            逐段产出文本的异步迭代器；调用本身不要求等待整个回答完成。
        """
        ...


ChatServiceFactory = Callable[[Settings], ChatStreamer]


def _configured_model(settings: Settings, provider: str) -> str | None:
    """读取供应商的默认模型。

    Args:
        settings: 应用配置，允许某些供应商未设置默认模型。
        provider: 已通过请求或配置字面量校验的供应商名称；此处不做合法性校验。

    Returns:
        默认模型名称或 None；末尾分支处理 claude，不是未知供应商的容错策略。
    """
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
    """先提交任务记录，再由调用方启动生成。

    Args:
        session: 创建记录的数据库会话，此处提交并刷新实体。
        user_id: 任务所属用户，查询快照时用于隔离访问。
        request: 已注入可信身份的请求，包含恢复所需消息与模型选项。
        settings: 未指定供应商或模型时使用的默认配置。

    Returns:
        已持久化的任务 ID 与初始状态，不负责启动后台协程。
    """
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
    """按用户与任务 ID 读取输出快照，不返回内部请求载荷。

    Args:
        session: 查询使用的数据库会话。
        run_id: 目标任务 UUID。
        user_id: 服务端认证的用户 UUID。

    Returns:
        任务文本、状态与修订序号；不存在或不属于该用户时返回 None。
    """
    # 同时按任务和用户筛选，不能仅凭客户端提供的 run_id 读取其他用户输出。
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
        """配置后台服务与快照批量写入策略，不在构造时启动任务。

        Args:
            session_factory: 每次持久化使用的独立数据库会话工厂。
            chat_service_factory: 流式服务工厂；None 时构建 AgentService。
            flush_interval: 待写文本达到该时间间隔时提交，单位为秒。
            flush_size: 待写文本达到该字符数时提交，不是模型 token 数。
        """
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
        """在当前进程启动任务，同一任务的重复调用直接返回。

        Args:
            run_id: 调用方已经持久化的任务 ID，也作为实际执行的线程标识。
            request: 已准备好的消息、身份和恢复标记。
            settings: 服务配置，其中并发上限用于构建执行信号量。
        """
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
        # 保留任务引用直至结束；记录持久化在数据库，内存只保存当前进程的执行句柄。
        task.add_done_callback(lambda _: self._tasks.pop(run_id, None))

    async def shutdown(self) -> None:
        """取消并等待后台任务退出，保留未完成状态供下次启动恢复。"""
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def cancel(self, run_id: UUID) -> None:
        """停止用户主动取消的任务，并标记为终态以阻止重启恢复。

        Args:
            run_id: 已由 API 检查归属的任务 ID；此方法不重复做权限查询。
        """
        task = self._tasks.get(run_id)
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await asyncio.to_thread(self._cancel_sync, run_id)

    def _cancel_sync(self, run_id: UUID) -> None:
        """在独立会话中将未完成任务标记为失败，保留已生成内容。"""
        with self._session_factory() as session:
            run = session.get(AiChatRun, run_id)
            if run is None or run.status not in (
                AiChatRunStatus.PENDING,
                AiChatRunStatus.RUNNING,
            ):
                return
            run.status = AiChatRunStatus.FAILED
            run.error = "生成已由用户停止。"
            run.completed_at = datetime.now(UTC)
            session.commit()

    async def recover_interrupted_runs(self, settings: Settings) -> None:
        """恢复未完成任务，应在应用初始化 checkpoint 后调用。

        Args:
            settings: 重启后的应用配置，用于重新构建流式服务。
        """
        recovered = await asyncio.to_thread(self._recover_interrupted_runs_sync)
        for run_id, request in recovered:
            self.start(run_id, request, settings)

    async def _generate(
        self,
        run_id: UUID,
        request: AiChatRequest,
        settings: Settings,
    ) -> None:
        """受并发上限约束执行模型流，并按批次保存结果。

        Args:
            run_id: 已持久化的任务 ID。
            request: 本次执行的可信请求，恢复任务含 checkpoint 恢复标记。
            settings: 流式服务使用的应用配置。

        Raises:
            RuntimeError: 管理器尚未初始化执行信号量。
            CancelledError: 服务关闭或用户停止时取消执行；取消本身不写失败终态。
                用户主动停止的终态由 cancel 单独保存，其他生成异常记录为失败。
        """
        semaphore = self._semaphore
        if semaphore is None:
            raise RuntimeError("AI 运行管理器尚未初始化")
        async with semaphore:
            # 状态在获得执行名额后才改为 running，排队期间仍保持 pending。
            await self._persist(run_id, status=AiChatRunStatus.RUNNING)
            pending = ""
            last_flush = asyncio.get_running_loop().time()
            try:
                streamer = self._chat_service_factory(settings)
                try:
                    token_stream = streamer.stream(request, thread_id=str(run_id))
                except TypeError as exc:
                    # 兼容旧流式实现的签名；其他 TypeError 必须交给正常错误处理。
                    if "thread_id" not in str(exc):
                        raise
                    token_stream = cast(Any, streamer).stream(request)
                async for token in token_stream:
                    pending += token
                    # 按长度或间隔批量写入快照，避免每个文本片段都产生数据库提交。
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
                # 未提交的 pending 文本不会在此补写；恢复依靠 checkpoint 而非内存缓冲。
                # 保留 running 状态，由下次启动恢复；用户取消则由 cancel 写入失败终态。
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
        """将快照写入交给工作线程，避免同步数据库提交阻塞事件循环。

        Args:
            run_id: 待更新任务 ID。
            append_content: 追加文本；空值不递增内容序号。
            status: 新状态；None 表示保留现有状态。
            error: 要保存的错误文本；None 表示不修改错误字段。
        """
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
        """在独立事务中追加文本并更新状态，任务已不存在时直接返回。

        Args:
            run_id: 待更新任务 ID。
            append_content: 追加文本，非空时内容修订序号增加一次。
            status: 可选新状态；进入完成或失败状态时记录结束时间。
            error: 可选错误文本；None 不清除已有错误。
        """
        with self._session_factory() as session:
            run = session.get(AiChatRun, run_id)
            if run is None:
                return
            if append_content:
                run.content += append_content
                # 序号随内容提交递增；SSE 仍单独检查状态，终态可没有新增文本。
                run.sequence += 1
            if status is not None:
                run.status = status
                if status in (AiChatRunStatus.COMPLETED, AiChatRunStatus.FAILED):
                    run.completed_at = datetime.now(UTC)
            if error is not None:
                run.error = error
            session.commit()

    def _recover_interrupted_runs_sync(self) -> list[tuple[UUID, AiChatRequest]]:
        """准备未完成任务的恢复请求，并重置可重放的展示快照。

        请求无法还原的旧任务会标记为失败；有效任务清空文本并增加序号，
        后续由 LangGraph checkpoint 恢复执行，不继续拼接旧文本快照。

        Returns:
            任务 ID 与附带恢复标记的请求列表，数据库修改已提交。
        """
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
                # 清空展示文本并递增序号，恢复时由图重新输出，不把旧快照重复拼接。
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
    """序列化恢复请求，并显式补入普通序列化排除的身份字段。

    Args:
        request: 已由 API 准备的请求，不包含需要持久化的上游 API Key。

    Returns:
        JSON 兼容的请求字典，保留消息、模型选项与可信调用身份。
    """
    payload = request.model_dump(mode="json")
    payload["actor_id"] = str(request.actor_id) if request.actor_id else None
    payload["actor_role"] = request.actor_role
    return cast(dict[str, object], payload)


def _request_from_payload(payload: dict[str, object]) -> AiChatRequest:
    """从数据库载荷还原恢复请求，继续使用 Pydantic 校验契约。

    Args:
        payload: 服务端此前持久化的请求，不是客户端重新提交的身份声明。

    Returns:
        校验通过的对话请求，恢复标记由任务管理器另行设置。

    Raises:
        ValueError: 载荷为空或不符合请求契约，包含 Pydantic ValidationError。
    """
    if not payload:
        raise ValueError("empty request payload")
    return AiChatRequest.model_validate(payload)


ai_chat_run_manager = AiChatRunManager()
