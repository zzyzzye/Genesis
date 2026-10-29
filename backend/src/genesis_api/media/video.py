"""云影视频协议适配：持久任务、防重提交、短期素材授权与私有结果入库。"""

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import jwt
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from genesis_api.billing import service as billing
from genesis_api.billing.transport import after_response, before_request, execution_context
from genesis_api.core.config import Settings, get_settings
from genesis_api.core.uploads import media_suffix
from genesis_api.database.session import SessionLocal
from genesis_api.llm.catalog import model_catalog
from genesis_api.media import service
from genesis_api.media.models import MediaAsset, ProjectAsset, VideoGeneration
from genesis_api.media.schemas import CanvasDocument
from genesis_api.media.video_catalog import CATALOG

logger = logging.getLogger(__name__)
ACTIVE = ("submitting", "queued", "processing", "downloading")


class VideoSubmit(BaseModel):
    """一次明确提交的请求标识与目标节点，不接受前端指定文件地址。"""

    request_id: UUID
    quote_id: UUID | None = None
    node_id: UUID
    acknowledge_unknown: bool = False


def headers(settings: Settings) -> dict[str, str]:
    """仅在服务端请求中展开视频凭据，不向响应或日志传播。"""
    if settings.video_api_key is None or not settings.video_api_key.get_secret_value().strip():
        raise HTTPException(503, "尚未配置视频服务，请配置 GENESIS_VIDEO_API_KEY")
    return {"Authorization": f"Bearer {settings.video_api_key.get_secret_value()}"}


async def available_models(settings: Settings, *, refresh: bool = False) -> list[str]:
    """读取当前渠道共享目录，不回退到虚构目录。

    Args:
        settings: 服务端视频凭据与协议基础地址。

    Returns:
        服务商返回的完整模型 ID，保持顺序并去重。

    Raises:
        HTTPException: 未配置凭据返回 503，上游目录不可用返回 502。
    """
    auth = headers(settings)
    try:
        payload = await model_catalog.get(
            f"{settings.video_api_base_url.rstrip('/')}/v1/models", auth, refresh=refresh,
        )
        models = list(
            dict.fromkeys(
                item["id"]
                for item in payload["data"]
                if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
            )
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(502, "视频模型目录暂不可用，请重试") from exc
    return models


def task_data(task: VideoGeneration) -> dict[str, object]:
    """返回任务状态，公开任务标识始终取本地创建记录。"""
    return {
        "billing": billing.source_billing(session, task.id)
        if (session := object_session(task))
        else None,
        "id": str(task.id),
        "node_id": str(task.node_id),
        "status": task.status,
        "progress": task.progress,
        "error": task.error,
        "asset_id": str(task.asset_id) if task.asset_id else None,
    }


def reference_token(task: VideoGeneration, asset_id: UUID, settings: Settings) -> str:
    """为本次任务的指定素材签发两小时授权，不改变素材公开状态。"""
    return jwt.encode(
        {
            "sub": str(asset_id),
            "task": str(task.id),
            "aud": "video-reference",
            "exp": datetime.now(UTC) + timedelta(hours=2),
        },
        settings.agent_action_secret.get_secret_value(),
        algorithm="HS256",
    )


def build_payload(
    task: VideoGeneration,
    document: CanvasDocument,
    session: Session,
    settings: Settings,
) -> dict[str, object]:
    """校验已保存节点和直接参考，按文档字段构造供应商请求。

    Args:
        task: 当前用户的待提交任务，校验后写入其参考素材标识。
        document: 服务端已保存的画布快照，不接受浏览器指定的素材 URL。
        session: 用于检查素材归属、作品引用和文件可用性的事务。
        settings: 公网素材地址与短期链接签名配置。

    Returns:
        仅包含公开协议字段的请求体；参考链接只用于此任务。

    Raises:
        HTTPException: 节点、模型参数、素材类型或数量不合法时返回 422。
    """
    node = next((n for n in document.nodes if n.id == task.node_id and n.type == "video"), None)
    if node is None:
        raise HTTPException(422, "请先保存生视频节点")
    spec = CATALOG.get(node.generation.model)
    if not node.generation.model:
        raise HTTPException(422, "请选择当前可用的视频模型")
    if not node.text.strip():
        raise HTTPException(422, "请填写镜头描述")
    if node.generation.count != 1:
        raise HTTPException(422, "视频接口每次创建一个任务，请将生成数量设为 1")
    if spec is None:
        # 目录不提供参数能力时只发送协议必填项，不猜测可选参数与参考能力。
        if node.generation.mode != "text":
            raise HTTPException(422, "该模型尚无参考参数说明，请使用文生视频")
        task.reference_ids = []
        return {"model": node.generation.model, "prompt": node.text.strip()}
    if (
        node.duration_seconds not in spec.durations
        or node.generation.ratio not in spec.ratios
        or node.generation.resolution.lower() not in spec.resolutions
    ):
        raise HTTPException(422, "所选时长、比例或清晰度不受当前模型支持")
    sources = {n.id: n for n in document.nodes}
    references: dict[str, list[str]] = {"image": [], "video": [], "audio": []}
    ids: list[str] = []
    if node.generation.mode != "text":
        if not settings.video_public_base_url.startswith("https://"):
            raise HTTPException(422, "素材参考需先部署公网 HTTPS 地址并配置视频素材访问地址")
        for edge in document.edges:
            source = sources.get(edge.source)
            if edge.target != node.id or source is None or source.asset_id is None:
                continue
            asset_id = source.asset_id
            if str(asset_id) in ids:
                continue
            asset = service.asset_for(session, task.owner_id, asset_id)
            if session.get(ProjectAsset, (task.project_id, asset.id)) is None:
                raise HTTPException(422, "参考素材不在当前作品中")
            if not (service.STORAGE_ROOT / str(asset.id)).is_file():
                raise HTTPException(422, "参考素材文件不可用，请重新导入")
            ids.append(str(asset.id))
            token = reference_token(task, asset.id, settings)
            references[asset.kind].append(
                f"{settings.video_public_base_url.rstrip('/')}{settings.api_v1_prefix}"
                f"/media/video-references/{task.id}/{asset.id}"
                f"{media_suffix(asset.mime_type)}?token={token}"
            )
        if not ids:
            raise HTTPException(422, "请先连接参考素材节点")
    if (
        len(references["image"]) > spec.images
        or len(references["video"]) > spec.videos
        or len(references["audio"]) > spec.max_audio
    ):
        raise HTTPException(422, "参考素材类型或数量超出当前模型支持范围")
    if node.generation.mode == "first_last" and (
        spec.id != "minimax-h3-首尾帧" or len(references["image"]) != 2
    ):
        raise HTTPException(422, "首尾帧模式请选择对应模型，并按顺序连接两张图片")
    if ("v2v-reference" in spec.id or "动作迁移" in spec.id) and not references["video"]:
        raise HTTPException(422, "当前模型需要参考视频")
    if "对口型" in spec.id and (not references["audio"] or not references["image"]):
        raise HTTPException(422, "对口型模型需要图片和音频参考")
    task.reference_ids = ids
    payload: dict[str, object] = {
        "model": spec.id,
        "prompt": node.text.strip(),
        "duration": node.duration_seconds,
        "aspect_ratio": node.generation.ratio,
        "resolution": node.generation.resolution.lower(),
    }
    if references["image"]:
        payload["image_urls"] = references["image"]
    if references["video"]:
        payload["reference_video" if spec.videos == 1 else "reference_videos"] = (
            references["video"][0] if spec.videos == 1 else references["video"]
        )
    if references["audio"]:
        payload["audio_urls"] = references["audio"]
    return payload


async def submit_task(
    task: VideoGeneration,
    payload: dict[str, object],
    session: Session,
    settings: Settings,
) -> None:
    """只发送一次创建请求；结果未知时保留记录并禁止自动重放。

    Args:
        task: 已提交到数据库的本地任务，保存创建返回的公开任务标识。
        payload: 已校验的协议参数和参考链接，禁止写入日志。
        session: 提交成功、明确拒绝或结果未知状态的数据库会话。
        settings: 视频服务连接配置。
    """
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(930, connect=10),
            trust_env=False,
            event_hooks={"request": [before_request], "response": [after_response]},
        ) as client:
            response = await client.post(
                f"{settings.video_api_base_url.rstrip('/')}/v1/videos",
                headers=headers(settings),
                json=payload,
            )
        if 400 <= response.status_code < 500 and response.status_code != 408:
            task.status = "failed"
            task.error = f"视频服务拒绝创建（{response.status_code}），请检查模型参数或账户额度"
        else:
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("创建响应格式无效")
            task_id = data.get("task_id") or data.get("id")
            if not isinstance(task_id, str) or not re.fullmatch(r"[\w-]{1,200}", task_id):
                raise ValueError("缺少公开任务标识")
            task.upstream_id = task_id
            task.status = "queued"
    except (httpx.HTTPError, ValueError, TypeError):
        task.status = "unknown"
        task.error = "创建结果未知，未自动重提。请先核实供应商任务，避免重复扣费。"
    billing.finish_operation(session, task.id)
    session.commit()


async def submit_saved_task(
    task_id: UUID,
    payload: dict[str, object],
    settings: Settings,
) -> None:
    """提交响应先返回，后台独立持有会话，避免长创建请求占满网关超时。

    Args:
        task_id: 已持久化的本地任务标识，已提交过的记录不再发送请求。
        payload: 本次提交的参数快照，参考公网读取失败时不创建付费任务。
        settings: 视频服务配置，不依赖已经结束的请求级会话。
    """
    with SessionLocal() as session:
        task = session.scalar(
            select(VideoGeneration)
            .where(
                VideoGeneration.id == task_id,
                VideoGeneration.status == "submitting",
                VideoGeneration.upstream_id.is_(None),
            )
            .with_for_update(skip_locked=True)
        )
        if task is not None:
            try:
                await check_references(payload)
            except (httpx.HTTPError, ValueError):
                task.status = "failed"
                task.error = "参考素材公网地址不可读取，请检查部署地址、HTTPS 与素材访问后重试"
                billing.finish_operation(session, task.id)
                session.commit()
                return
            with execution_context(task.id, settings, SessionLocal):
                await submit_task(task, payload, session, settings)


async def check_references(payload: dict[str, object]) -> None:
    """创建付费任务前检查自有素材的公网 GET，不携带视频服务凭据。

    Args:
        payload: 服务端生成的请求体，只检查其中的参考 URL 字段。

    Raises:
        ValueError: 地址返回非 200 或媒体类型不匹配。
        httpx.HTTPError: 公网素材暂不可达或请求超时。
    """
    async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
        for key, prefix in (
            ("image_urls", "image/"),
            ("reference_videos", "video/"),
            ("reference_video", "video/"),
            ("audio_urls", "audio/"),
        ):
            values = payload.get(key, [])
            urls = [values] if isinstance(values, str) else values
            if not isinstance(urls, list):
                continue
            for url in urls:
                if not isinstance(url, str):
                    raise ValueError("素材地址无效")
                async with client.stream("GET", url) as response:
                    if response.status_code != 200 or not response.headers.get(
                        "content-type", ""
                    ).startswith(prefix):
                        raise ValueError("素材公网读取失败")


async def refresh_task(task: VideoGeneration, session: Session, settings: Settings) -> None:
    """轮询已有公开任务标识；完成后流式保存视频，原子关联作品素材。

    Args:
        task: 已有上游标识的活动任务；终态和未获标识的记录直接跳过。
        session: 状态变更和结果素材使用的事务，由调用方负责并发锁。
        settings: 视频状态查询使用的服务端连接配置。

    Raises:
        httpx.HTTPError: 状态查询暂不可用，调用方可稍后重查，不能重提创建。
        ValueError: 状态协议格式无效。下载失败另记为可重试保存状态。
    """
    if not task.upstream_id or task.status not in ACTIVE:
        return
    async with httpx.AsyncClient(timeout=30, trust_env=False) as client:
        response = await client.get(
            f"{settings.video_api_base_url.rstrip('/')}/v1/videos/{task.upstream_id}",
            headers=headers(settings),
        )
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("任务响应格式无效")
    status = data.get("status")
    if status in ("failed", "cancelled"):
        task.status = "failed"
        task.error = "视频生成失败，请检查提示词和参考素材后重试"
    elif status in ("queued", "pending", "processing", "in_progress"):
        task.status = "queued" if status in ("queued", "pending") else "processing"
        progress = data.get("progress", 0)
        task.progress = max(0, min(99, int(progress))) if isinstance(progress, (int, float)) else 0
    elif status == "completed":
        try:
            await save_result(task, session)
        except (httpx.HTTPError, ValueError, OSError):
            session.rollback()
            task.status = "download_failed"
            task.error = "视频已完成但保存失败，请在生成后 24 小时内重试保存，不会重新生成"
            session.commit()
        return
    session.commit()


async def save_result(task: VideoGeneration, session: Session) -> None:
    """只从文档固定下载域取回结果，限制类型和体积，不跟随任意重定向。

    Args:
        task: 已完成的上游任务，写入对应的本地素材标识与完成状态。
        session: 新建素材、作品引用和任务状态一次提交的数据库会话。

    Raises:
        ValueError: 返回类型错误、文件为空或超过已有素材大小限制。
        httpx.HTTPError: 视频下载失败。未提交的文件会在异常或取消时清理。
    """
    asset_id = task.asset_id or uuid4()
    path = service.STORAGE_ROOT / str(asset_id)
    temporary = service.STORAGE_ROOT / f"{task.id}.partial"
    service.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        async with (
            httpx.AsyncClient(timeout=300, trust_env=False) as client,
            client.stream(
                "GET", f"https://media.yyapi.cloud/public/videos/{task.upstream_id}/content"
            ) as response,
        ):
            response.raise_for_status()
            mime = response.headers.get("content-type", "").split(";")[0].lower()
            if mime not in service.ALLOWED_TYPES or not mime.startswith("video/"):
                raise ValueError("视频下载类型不正确")
            with temporary.open("wb") as output:
                async for chunk in response.aiter_bytes(256 * 1024):
                    size += len(chunk)
                    if size > service.MAX_UPLOAD_BYTES:
                        raise ValueError("视频超过素材大小限制")
                    output.write(chunk)
        if not size:
            raise ValueError("视频下载为空")
        temporary.replace(path)
        asset = MediaAsset(
            id=asset_id,
            owner_id=task.owner_id,
            name=f"生成视频-{str(task.id)[:8]}"
            + {"video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv"}.get(
                mime, ".mp4"
            ),
            mime_type=mime,
            kind="video",
            size=size,
            in_library=False,
        )
        session.add(asset)
        session.flush()
        session.add(ProjectAsset(project_id=task.project_id, asset_id=asset_id))
        task.asset_id = asset_id
        task.status = "completed"
        task.progress = 100
        task.error = ""
        session.commit()
    except BaseException:
        temporary.unlink(missing_ok=True)
        path.unlink(missing_ok=True)
        raise


async def refresh_videos() -> None:
    """随应用生命周期恢复轮询，多个实例用数据库行锁避免重复下载。"""
    while True:
        try:
            with SessionLocal() as listing:
                ids = listing.scalars(
                    select(VideoGeneration.id)
                    .where(VideoGeneration.status.in_(ACTIVE))
                    .order_by(VideoGeneration.created_at)
                    .limit(100)
                ).all()
            for task_id in ids:
                with SessionLocal() as session:
                    task = session.scalar(
                        select(VideoGeneration)
                        .where(VideoGeneration.id == task_id, VideoGeneration.status.in_(ACTIVE))
                        .with_for_update(skip_locked=True)
                    )
                    if task is None:
                        continue
                    if task.upstream_id is None:
                        created = task.created_at.replace(tzinfo=UTC)
                        if datetime.now(UTC) - created > timedelta(minutes=17):
                            task.status = "unknown"
                            task.error = "提交中断且创建结果未知，请核实供应商任务后再重试"
                            session.commit()
                        continue
                    try:
                        await refresh_task(task, session, get_settings())
                    except (httpx.HTTPError, ValueError, HTTPException):
                        session.rollback()
                        logger.warning("视频状态同步暂不可用：task_id=%s", task.id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("视频任务轮询暂不可用，将于下一轮重试")
        await asyncio.sleep(15)
