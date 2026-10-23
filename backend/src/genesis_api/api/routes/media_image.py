"""图片模型与持久化图片生成入口；参考素材在服务端通过 multipart 上传。"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy import select

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.core.config import get_settings
from genesis_api.media import image, service
from genesis_api.media.models import ImageGeneration
from genesis_api.media.schemas import CanvasDocument, GenerationSubmit

router = APIRouter()


@router.get("/image-models")
async def image_models(user: CurrentUserDependency) -> dict[str, object]:
    """返回当前图片 Key 的完整目录，图片编辑不依赖公网素材地址。"""
    settings = get_settings()
    if not settings.image_api_key:
        return {"configured": False, "references_ready": False, "models": []}
    return {
        "configured": True,
        "references_ready": True,
        "models": await image.available_models(settings),
    }


@router.get("/projects/{project_id}/image-generations")
def image_tasks(
    project_id: UUID, node_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> list[dict[str, object]]:
    """恢复当前节点最近图片任务，页面刷新不会重新请求生成。"""
    service.project_for(session, user.id, project_id)
    rows = session.scalars(
        select(ImageGeneration)
        .where(
            ImageGeneration.project_id == project_id,
            ImageGeneration.owner_id == user.id,
            ImageGeneration.node_id == node_id,
        )
        .order_by(ImageGeneration.created_at.desc(), ImageGeneration.id.desc())
        .limit(10)
    )
    return [image.task_data(row) for row in rows]


@router.post("/projects/{project_id}/image-generations", status_code=202)
async def create_image_task(
    project_id: UUID,
    data: GenerationSubmit,
    user: CurrentUserDependency,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """先保存生成意图，再在独立会话提交一次图片请求。

    Args:
        project_id: 当前用户拥有的作品。
        data: 浏览器本次意图标识及目标节点；断网重试应复用标识。
        user: 当前身份，限制作品与参考素材归属。
        session: 请求事务，保存任务后释放作品锁。
        background_tasks: 响应返回后提交供应商，不占用请求会话。

    Returns:
        持久任务状态，不包含 Key、图片二进制或供应商私有链接。

    Raises:
        HTTPException: 归属不符 404，已有活动任务 409，参数无效 422，未配置 503。
    """
    settings = get_settings()
    image.headers(settings)
    project = service.project_for(session, user.id, project_id)
    existing = session.get(ImageGeneration, data.request_id)
    if existing is not None:
        if (existing.owner_id, existing.project_id, existing.node_id) != (
            user.id,
            project_id,
            data.node_id,
        ):
            raise HTTPException(409, "请求标识已被使用")
        return image.task_data(existing)
    active = session.scalar(
        select(ImageGeneration).where(
            ImageGeneration.project_id == project_id,
            ImageGeneration.node_id == data.node_id,
            ImageGeneration.status.in_((*image.ACTIVE, "unknown")),
        )
    )
    if active is not None:
        if active.status == "unknown" and data.acknowledge_unknown:
            active.status = "acknowledged"
        else:
            raise HTTPException(409, "该节点已有图片任务，请先查看任务状态")
    task = ImageGeneration(
        id=data.request_id,
        owner_id=user.id,
        project_id=project_id,
        node_id=data.node_id,
        snapshot={},
    )
    node = image.prepare(task, CanvasDocument.model_validate(project.canvas), session)
    models = await image.available_models(settings)
    if not any(model["id"] == node.generation.model for model in models):
        raise HTTPException(422, "该图片模型当前不可用，请刷新模型目录")
    session.add(task)
    session.commit()
    background_tasks.add_task(image.submit_saved_task, task.id, settings)
    return image.task_data(task)


@router.post("/projects/{project_id}/image-generations/{task_id}/retry-download")
def retry_image_save(
    project_id: UUID,
    task_id: UUID,
    user: CurrentUserDependency,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> dict[str, object]:
    """只重试保存已返回的图片，绝不重新调用生成接口。"""
    service.project_for(session, user.id, project_id)
    task = session.scalar(
        select(ImageGeneration)
        .where(
            ImageGeneration.id == task_id,
            ImageGeneration.project_id == project_id,
            ImageGeneration.owner_id == user.id,
        )
        .with_for_update()
    )
    if task is None:
        raise HTTPException(404, "图片任务不存在")
    if task.status != "download_failed" or not image.result_cache(task.id).is_file():
        raise HTTPException(409, "当前没有可重试保存的图片结果")
    task.status = "downloading"
    task.error = ""
    session.commit()
    background_tasks.add_task(image.save_task, task.id)
    return image.task_data(task)
