"""云影 Images 适配：本地参考上传、幂等提交与私有图片入库。"""

import asyncio
import base64
import binascii
import ipaddress
import json
import logging
import socket
from contextlib import ExitStack
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, object_session

from genesis_api.billing import service as billing
from genesis_api.billing.transport import after_response, before_request, execution_context
from genesis_api.core.config import Settings
from genesis_api.core.uploads import media_filename
from genesis_api.database.session import SessionLocal
from genesis_api.identity.models import User
from genesis_api.llm.catalog import model_catalog
from genesis_api.media import service
from genesis_api.media.models import ImageGeneration, MediaAsset, ProjectAsset
from genesis_api.media.schemas import CanvasDocument, CanvasNode, GenerationSubmit

logger = logging.getLogger(__name__)
ACTIVE = ("submitting", "processing", "downloading")
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_RESPONSE_BYTES = 180 * 1024 * 1024
_agent_tasks: set[asyncio.Task[None]] = set()


def headers(settings: Settings) -> dict[str, str]:
    """只向配置的图片服务发送凭据，禁止在响应或日志中展开。"""
    if settings.image_api_key is None or not settings.image_api_key.get_secret_value().strip():
        raise HTTPException(503, "尚未配置图片服务，请配置 GENESIS_IMAGE_API_KEY")
    return {"Authorization": f"Bearer {settings.image_api_key.get_secret_value()}"}


async def available_models(settings: Settings, *, refresh: bool = False) -> list[dict[str, object]]:
    """读取当前渠道共享目录，不把文档名单用作可用模型白名单。"""
    try:
        payload = await model_catalog.get(
            settings.image_api_base_url.rstrip("/") + "/v1/models",
            headers(settings),
            refresh=refresh,
        )
        rows = payload["data"]
        ids = dict.fromkeys(
            item["id"]
            for item in rows
            if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
        )
        return [{"id": name} for name in ids]
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "图片模型目录暂不可用，请重试") from exc


def task_data(task: ImageGeneration) -> dict[str, object]:
    """只返回本地状态和私有素材标识，不返回上游地址、原始响应或凭据。"""
    return {
        "billing": billing.source_billing(session, task.id)
        if (session := object_session(task))
        else None,
        "id": str(task.id),
        "node_id": str(task.node_id),
        "status": task.status,
        "progress": 0,
        "error": task.error,
        "asset_ids": task.asset_ids,
        "asset_id": task.asset_ids[0] if task.asset_ids else None,
        "generation": task.snapshot.get("generation"),
    }


async def admit_task(
    session: Session,
    user: User,
    project_id: UUID,
    data: GenerationSubmit,
    settings: Settings,
    *,
    expected_version: int | None = None,
    reuse_active: bool = False,
) -> tuple[ImageGeneration, bool]:
    """复用画布归属、参数、幂等与计费校验，保存图片任务但不调用上游。

    Args:
        session: 独立请求或工具会话，成功创建后提交事务。
        user: 服务端认证的用户，不接受模型传入的身份。
        project_id: 当前用户拥有的作品。
        data: 同一生成意图必须复用的请求标识及节点。
        settings: 已配置的图片与计费服务。
        expected_version: Agent 读取的画布版本；过期时拒绝新建任务。
        reuse_active: Agent 重复要求生成时返回已有活动任务，不重新消费。

    Returns:
        真实任务与是否本次新建；只有新建任务需要安排后台执行。

    Raises:
        HTTPException: 归属、版本、参考、模型或余额校验失败。
    """
    headers(settings)
    project = service.project_for(session, user.id, project_id)
    existing = session.get(ImageGeneration, data.request_id)
    if existing is not None:
        if (existing.owner_id, existing.project_id, existing.node_id) != (
            user.id,
            project_id,
            data.node_id,
        ):
            raise HTTPException(409, "请求标识已被使用")
        return existing, False
    active = session.scalar(
        select(ImageGeneration).where(
            ImageGeneration.project_id == project_id,
            ImageGeneration.node_id == data.node_id,
            ImageGeneration.status.in_((*ACTIVE, "unknown")),
        )
    )
    if active is not None:
        if reuse_active:
            return active, False
        if active.status == "unknown" and data.acknowledge_unknown:
            active.status = "acknowledged"
        else:
            raise HTTPException(409, "该节点已有图片任务，请先查看任务状态")
    if expected_version is not None and project.version != expected_version:
        raise HTTPException(409, "画布已更新，请重新读取画布并核对节点后提交生成")
    task = ImageGeneration(
        id=data.request_id,
        owner_id=user.id,
        project_id=project_id,
        node_id=data.node_id,
        snapshot={},
    )
    node = prepare(task, CanvasDocument.model_validate(project.canvas), session)
    models = await available_models(settings)
    if not any(model["id"] == node.generation.model for model in models):
        raise HTTPException(422, "该图片模型当前不可用，请刷新模型目录")
    billing.admit(
        session,
        user,
        source_id=task.id,
        kind="image",
        provider="image",
        model=node.generation.model,
        quote_id=data.quote_id,
        settings=settings,
        parameters=billing.media_parameters(node),
    )
    session.add(task)
    session.commit()
    return task, True


def start_agent_task(task_id: UUID, settings: Settings) -> None:
    """让已入库任务独立于聊天继续执行，复用按钮提交的同一后台函数。"""
    task = asyncio.create_task(submit_saved_task(task_id, settings), name=f"media-image-{task_id}")
    _agent_tasks.add(task)

    def finished(result: asyncio.Task[None]) -> None:
        _agent_tasks.discard(result)
        if not result.cancelled() and result.exception() is not None:
            logger.error("图片后台任务执行异常，请查询持久任务状态：task_id=%s", task_id)

    task.add_done_callback(finished)


async def shutdown_agent_tasks() -> None:
    """应用退出时取消并等待图片请求，沿用既有的未知状态保护。"""
    tasks = list(_agent_tasks)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


def reference_nodes(document: CanvasDocument, node_id: UUID) -> list[CanvasNode]:
    """按连线顺序读取直接参考，排除自连、分组、重复和失效连线。"""
    sources = {node.id: node for node in document.nodes}
    ids = dict.fromkeys(
        edge.source for edge in document.edges if edge.target == node_id and edge.source != node_id
    )
    return [sources[key] for key in ids if key in sources and sources[key].type != "group"]


def prepare(task: ImageGeneration, document: CanvasDocument, session: Session) -> CanvasNode:
    """从已保存画布校验图片节点和连入图片，按连线顺序记录授权参考。

    Args:
        task: 待提交的持久记录，写入最小节点快照与参考标识。
        document: 当前作品已保存的画布。
        session: 校验素材归属及作品引用。

    Returns:
        已校验的生图节点；参数支持最终由所选模型决定。

    Raises:
        HTTPException: 缺少提示词、模型、参考素材或素材不属于作品。
    """
    node = next(
        (n for n in document.nodes if n.id == task.node_id and n.type == "image_generation"), None
    )
    if node is None or not node.text.strip() or not node.generation.model:
        raise HTTPException(422, "请先保存生图节点，并填写提示词和选择模型")
    ids: list[str] = []
    for source in reference_nodes(document, node.id):
        if source.asset_id is None:
            if source.type in ("image", "image_generation"):
                raise HTTPException(422, "参考图片尚未就绪，请先生成或导入图片，或断开该参考")
            continue
        if str(source.asset_id) in ids:
            continue
        asset = service.asset_for(session, task.owner_id, source.asset_id)
        if asset.kind != "image":
            continue
        if session.get(ProjectAsset, (task.project_id, asset.id)) is None:
            raise HTTPException(422, "图生图只接受当前作品中的图片参考")
        if not (service.STORAGE_ROOT / str(asset.id)).is_file():
            raise HTTPException(422, "参考图片文件不可用，请重新导入")
        ids.append(str(asset.id))
    # 生图模式由当前参考决定，旧草稿中的手动 mode 不再控制上游接口。
    node = node.model_copy(
        update={
            "generation": node.generation.model_copy(
                update={"mode": "reference" if ids else "text"}
            )
        }
    )
    task.reference_ids = ids
    task.snapshot = node.model_dump(mode="json")
    return node


def result_cache(task_id: UUID) -> Path:
    """返回任务私有响应缓存路径，不作为作品素材提供下载。"""
    return service.STORAGE_ROOT / f".image-result-{task_id}.json"


async def request_image(task: ImageGeneration, session: Session, settings: Settings) -> None:
    """只提交一次同步请求，先缓存结果，再尝试保存，取消和断网不自动重放。

    Args:
        task: 已持久化且已加锁的本地任务。
        session: 用于状态更新及参考文件归属检查的独立后台会话。
        settings: 图片服务连接配置，Key 只用于本次请求。
    """
    node = CanvasNode.model_validate(task.snapshot)
    payload: dict[str, Any] = {
        "model": node.generation.model,
        "prompt": node.text.strip(),
        "n": node.generation.count,
    }
    if node.generation.image_size:
        payload["size"] = node.generation.image_size
    # 尚未确认逐模型画质档位，旧草稿字段仅保留兼容，不提交到上游。
    if node.generation.image_background:
        payload["background"] = node.generation.image_background
    sent = False
    try:
        with ExitStack() as files:
            uploads = []
            for asset_id in task.reference_ids:
                asset = service.asset_for(session, task.owner_id, UUID(asset_id))
                source = files.enter_context((service.STORAGE_ROOT / asset_id).open("rb"))
                uploads.append(
                    (
                        "image",
                        (
                            media_filename(asset.name, asset.mime_type),
                            source,
                            asset.mime_type,
                        ),
                    )
                )
            task.status = "processing"
            session.commit()
            # 公布生成状态后重新加锁，恢复进程通过 skip_locked 避免同时处理。
            session.refresh(task, with_for_update=True)
            auth = {**headers(settings), "Idempotency-Key": str(task.id)}
            kwargs: dict[str, Any] = (
                {"data": {key: str(value) for key, value in payload.items()}, "files": uploads}
                if uploads
                else {"json": payload}
            )
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(930, connect=10),
                trust_env=False,
                event_hooks={"request": [before_request], "response": [after_response]},
            ) as client:
                sent = True
                async with client.stream(
                    "POST",
                    settings.image_api_base_url.rstrip("/")
                    + ("/v1/images/edits" if uploads else "/v1/images/generations"),
                    headers=auth,
                    **kwargs,
                ) as response:
                    if 400 <= response.status_code < 500 and response.status_code != 408:
                        task.status = "failed"
                        task.error = {
                            401: "图片服务鉴权失败，请检查服务端 Key",
                            402: "图片服务余额或额度不足",
                            429: "图片服务请求过于频繁，请稍后重试",
                        }.get(
                            response.status_code, "图片请求被拒绝，请检查模型、尺寸、数量和参考图片"
                        )
                        session.commit()
                        return
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_RESPONSE_BYTES:
                            raise ValueError("图片响应过大")
            data = json.loads(body)
            rows = data.get("data") if isinstance(data, dict) else None
            if (
                not isinstance(rows, list)
                or not 1 <= len(rows) <= 4
                or not all(
                    isinstance(row, dict)
                    and (isinstance(row.get("b64_json"), str) or isinstance(row.get("url"), str))
                    for row in rows
                )
            ):
                raise ValueError("图片结果格式无效")
            # 仅缓存结果字段，丢弃用量、改写提示词等无关信息。
            cache = [
                {key: row[key] for key in ("b64_json", "url") if isinstance(row.get(key), str)}
                for row in rows
            ]
            service.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
            temporary = result_cache(task.id).with_suffix(".partial")
            temporary.write_text(json.dumps(cache), encoding="utf-8")
            temporary.replace(result_cache(task.id))
            task.status = "downloading"
            session.commit()
        await save_task(task.id)
    except asyncio.CancelledError:
        session.rollback()
        task.status = "downloading" if result_cache(task.id).is_file() else "unknown"
        task.error = "提交中断，请核实图片任务后再重试" if task.status == "unknown" else ""
        session.commit()
        raise
    except (httpx.HTTPError, ValueError, OSError, HTTPException):
        session.rollback()
        task.status = "unknown" if sent else "failed"
        task.error = (
            "图片请求结果未知，请先核实服务商记录，避免重复生成"
            if sent
            else "参考图片无法读取，请重新导入"
        )
        session.commit()


async def submit_saved_task(task_id: UUID, settings: Settings) -> None:
    """使用独立会话提交一次已保存任务，重复后台调度不重发。"""
    with SessionLocal() as session:
        task = session.scalar(
            select(ImageGeneration)
            .where(ImageGeneration.id == task_id, ImageGeneration.status == "submitting")
            .with_for_update(skip_locked=True)
        )
        if task is not None:
            try:
                with execution_context(task.id, settings, SessionLocal):
                    await request_image(task, session, settings)
            finally:
                billing.finish_operation(session, task.id)
                session.commit()


async def public_image(url: str) -> bytes:
    """下载公网 HTTPS 图片，逐跳校验并固定解析地址，禁止请求私网和泄漏鉴权。

    Args:
        url: 服务商响应中的结果链接，不接受前端提供任意下载地址。

    Returns:
        限定体积内的图片字节；具体文件格式由保存阶段校验。

    Raises:
        ValueError: 非公网 HTTPS、重定向过多或图片超过限制。
        httpx.HTTPError: 结果链接失效或暂时不可用。
    """
    async with httpx.AsyncClient(
        timeout=120, trust_env=False, limits=httpx.Limits(max_keepalive_connections=0)
    ) as client:
        for _ in range(5):
            target = httpx.URL(url)
            if (
                target.scheme != "https"
                or not target.host
                or target.username
                or target.password
                or target.port not in (None, 443)
            ):
                raise ValueError("图片结果地址必须是公网 HTTPS")
            resolved = await asyncio.get_running_loop().getaddrinfo(
                target.host, 443, type=socket.SOCK_STREAM
            )
            addresses = [ipaddress.ip_address(item[4][0]) for item in resolved]
            if not addresses or any(not address.is_global for address in addresses):
                raise ValueError("禁止读取内网图片地址")
            async with client.stream(
                "GET",
                target.copy_with(host=str(addresses[0])),
                headers={"Host": target.host},
                extensions={"sni_hostname": target.host},
            ) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("图片结果重定向缺少地址")
                    url = str(target.join(location))
                    continue
                response.raise_for_status()
                mime = response.headers.get("content-type", "").split(";")[0].lower()
                if mime not in service.ALLOWED_TYPES or not mime.startswith("image/"):
                    raise ValueError("图片结果类型不正确")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_IMAGE_BYTES:
                        raise ValueError("图片超过大小限制")
                return bytes(body)
    raise ValueError("图片结果重定向过多")


def image_type(data: bytes) -> tuple[str, str]:
    """按二进制签名判断图片类型，不信任上游扩展名或 Base64 的格式声明。"""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis"):
        return "image/avif", ".avif"
    raise ValueError("结果不是支持的图片文件")


async def save_task(task_id: UUID) -> None:
    """从私有结果缓存保存全部图片；失败只允许重新保存，不再次生成。

    Args:
        task_id: 本地图片任务标识；使用行锁避免恢复进程和用户同时重复入库。
    """
    with SessionLocal() as session:
        task = session.scalar(
            select(ImageGeneration)
            .where(ImageGeneration.id == task_id, ImageGeneration.status == "downloading")
            .with_for_update(skip_locked=True)
        )
        if task is None:
            return
        paths: list[Path] = []
        try:
            rows = json.loads(result_cache(task.id).read_text(encoding="utf-8"))
            ids = []
            for index, row in enumerate(rows):
                if row.get("b64_json"):
                    if len(row["b64_json"]) > MAX_IMAGE_BYTES * 4 // 3 + 4:
                        raise ValueError("图片超过大小限制")
                    data = base64.b64decode(row["b64_json"], validate=True)
                else:
                    data = await public_image(row["url"])
                if not data or len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("图片为空或超过大小限制")
                mime, extension = image_type(data)
                asset_id = uuid4()
                path = service.STORAGE_ROOT / str(asset_id)
                paths.append(path)
                path.write_bytes(data)
                session.add(
                    MediaAsset(
                        id=asset_id,
                        owner_id=task.owner_id,
                        name=f"生成图片-{str(task.id)[:8]}-{index + 1}{extension}",
                        mime_type=mime,
                        kind="image",
                        size=len(data),
                        in_library=False,
                    )
                )
                session.flush()
                session.add(ProjectAsset(project_id=task.project_id, asset_id=asset_id))
                ids.append(str(asset_id))
            task.asset_ids = ids
            task.status = "completed"
            task.error = ""
            session.commit()
        except asyncio.CancelledError:
            session.rollback()
            for path in paths:
                path.unlink(missing_ok=True)
            raise
        except (httpx.HTTPError, ValueError, OSError, binascii.Error, SQLAlchemyError):
            session.rollback()
            for path in paths:
                path.unlink(missing_ok=True)
            task.status = "download_failed"
            task.error = "图片已返回但保存失败，可重试保存，无需重新生成"
            session.commit()
        else:
            try:
                result_cache(task.id).unlink(missing_ok=True)
            except OSError:
                logger.warning("图片结果已保存，临时响应缓存暂未清理：task_id=%s", task.id)


async def recover_images() -> None:
    """恢复已缓存结果；超过请求最长时间的中断记录标为未知，绝不重放生成。"""
    while True:
        try:
            with SessionLocal() as session:
                tasks = session.scalars(
                    select(ImageGeneration)
                    .where(ImageGeneration.status.in_(ACTIVE))
                    .order_by(ImageGeneration.created_at)
                    .limit(100)
                    .with_for_update(skip_locked=True)
                ).all()
                saving = []
                for task in tasks:
                    if result_cache(task.id).is_file():
                        task.status = "downloading"
                        saving.append(task.id)
                    elif datetime.now(UTC) - task.created_at.replace(tzinfo=UTC) > timedelta(
                        minutes=17
                    ):
                        task.status = "unknown"
                        task.error = "图片请求中断，请核实服务商记录后再提交"
                session.commit()
            for task_id in saving:
                await save_task(task_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("图片结果恢复暂不可用，将于下一轮重试")
        await asyncio.sleep(15)
