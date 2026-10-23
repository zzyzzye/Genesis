"""视频模型、持久化任务与任务范围内的短期素材读取接口。"""

from uuid import UUID

import jwt
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.core.config import get_settings
from genesis_api.media import service, video
from genesis_api.media.models import VideoGeneration
from genesis_api.media.schemas import CanvasDocument
from genesis_api.media.video_catalog import CATALOG

router = APIRouter()


@router.get("/video-models")
async def video_models(user: CurrentUserDependency) -> dict[str, object]:
    """返回完整实时视频目录及已知参数，未配置时给出明确空态。"""
    settings = get_settings()
    if not settings.video_api_key:
        return {"configured": False, "references_ready": False, "models": []}
    ids = await video.available_models(settings)
    return {
        "configured": True,
        "references_ready": settings.video_public_base_url.startswith("https://"),
        "models": [
            {**CATALOG[item].data(), "parameters_known": True}
            if item in CATALOG
            else {
                "id": item,
                "parameters_known": False,
                "ratios": [],
                "durations": [],
                "resolutions": [],
                "images": 0,
                "videos": 0,
                "audio": False,
            }
            for item in ids
        ],
    }


@router.get("/projects/{project_id}/video-generations")
def video_tasks(
    project_id: UUID,
    node_id: UUID,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> list[dict[str, object]]:
    """刷新或重新打开页面后恢复节点最近任务，不重新创建供应商任务。"""
    service.project_for(session, user.id, project_id)
    rows = session.scalars(
        select(VideoGeneration)
        .where(
            VideoGeneration.project_id == project_id,
            VideoGeneration.owner_id == user.id,
            VideoGeneration.node_id == node_id,
        )
        .order_by(VideoGeneration.created_at.desc(), VideoGeneration.id.desc())
        .limit(10)
    )
    return [video.task_data(row) for row in rows]


@router.post("/projects/{project_id}/video-generations", status_code=202)
async def create_video_task(
    project_id: UUID,
    data: video.VideoSubmit,
    user: CurrentUserDependency,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """按保存后的节点提交一次视频任务，同标识重试只返回已有记录。

    Args:
        project_id: 当前用户拥有的目标作品。
        data: 本次请求标识、目标节点和未知任务的主动核实状态。
        user: 已认证用户，任务、作品和素材均按其身份隔离。
        session: 在请求结束前持久化本地任务与参数快照的会话。
        background_tasks: 响应返回后执行一次供应商提交，不复用请求会话。

    Returns:
        已持久化的本地任务状态；创建上游任务不阻塞响应。

    Raises:
        HTTPException: 归属不符返回 404，重复任务返回 409，参数错误返回 422，
            视频服务未配置或不可用时返回 503 或 502。
    """
    settings = get_settings()
    video.headers(settings)
    project = service.project_for(session, user.id, project_id)
    existing = session.get(VideoGeneration, data.request_id)
    if existing is not None:
        if (
            existing.owner_id != user.id
            or existing.project_id != project_id
            or existing.node_id != data.node_id
        ):
            raise HTTPException(409, "请求标识已被使用")
        return video.task_data(existing)
    active = session.scalar(
        select(VideoGeneration).where(
            VideoGeneration.project_id == project_id,
            VideoGeneration.node_id == data.node_id,
            VideoGeneration.status.in_((*video.ACTIVE, "unknown")),
        )
    )
    if active is not None:
        if active.status == "unknown" and data.acknowledge_unknown:
            active.status = "acknowledged"
        else:
            raise HTTPException(409, "该节点已有任务，请查看任务状态后再提交")
    document = CanvasDocument.model_validate(project.canvas)
    task = VideoGeneration(
        id=data.request_id,
        owner_id=user.id,
        project_id=project_id,
        node_id=data.node_id,
        snapshot=document.model_dump(mode="json"),
    )
    payload = video.build_payload(task, document, session, settings)
    task.snapshot = {
        "node": next(
            node.model_dump(mode="json") for node in document.nodes if node.id == data.node_id
        ),
        "reference_ids": task.reference_ids,
    }
    if payload["model"] not in await video.available_models(settings):
        raise HTTPException(422, "该视频模型当前不可用，请刷新模型目录")
    session.add(task)
    session.commit()
    background_tasks.add_task(video.submit_saved_task, task.id, payload, settings)
    return video.task_data(task)


@router.post("/projects/{project_id}/video-generations/{task_id}/retry-download")
def retry_video_download(
    project_id: UUID,
    task_id: UUID,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> dict[str, object]:
    """只重试已有任务的结果入库，不重新创建或扣费生成。"""
    service.project_for(session, user.id, project_id)
    task = session.get(VideoGeneration, task_id)
    if task is None or task.owner_id != user.id or task.project_id != project_id:
        raise HTTPException(404, "视频任务不存在")
    if task.status != "download_failed":
        raise HTTPException(409, "当前任务无需重试保存")
    task.status = "downloading"
    task.error = ""
    session.commit()
    return video.task_data(task)


@router.get("/video-references/{task_id}/{asset_id}")
def video_reference(
    task_id: UUID,
    asset_id: UUID,
    session: SessionDependency,
    token: str = Query(max_length=2000),
) -> FileResponse:
    """只允许任务授权的素材短期读取，不改变私有素材的登录鉴权。

    Args:
        task_id: 创建参考链接的本地任务标识。
        asset_id: 必须出现在该任务参考清单中的素材标识。
        session: 再次检查任务、作品和素材归属的会话。
        token: 带有效期、受众和任务范围的签名，不写入访问日志。

    Returns:
        不缓存的原始媒体响应，保留真实媒体类型。

    Raises:
        HTTPException: 授权过期、范围不符或文件不可用时统一返回 404。
    """
    try:
        claims = jwt.decode(
            token,
            get_settings().agent_action_secret.get_secret_value(),
            algorithms=["HS256"],
            audience="video-reference",
            options={"require": ["exp", "sub", "task", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(404, "素材授权无效或已过期") from exc
    task = session.get(VideoGeneration, task_id)
    if (
        task is None
        or claims["sub"] != str(asset_id)
        or claims["task"] != str(task_id)
        or str(asset_id) not in task.reference_ids
    ):
        raise HTTPException(404, "素材授权无效或已过期")
    service.project_for(session, task.owner_id, task.project_id)
    asset = service.asset_for(session, task.owner_id, asset_id)
    path = service.STORAGE_ROOT / str(asset_id)
    if not path.is_file():
        raise HTTPException(404, "素材文件不可用")
    return FileResponse(path, media_type=asset.mime_type, headers={"Cache-Control": "no-store"})
