from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select

from genesis_api.api.dependencies import CurrentUserDependency, SessionDependency
from genesis_api.media import service
from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset
from genesis_api.media.schemas import (
    AssetCopies,
    AssetReference,
    CanvasDocument,
    CanvasWrite,
    ProjectWrite,
)

router = APIRouter(prefix="/media", tags=["影音系统"])


@router.post("/projects/{project_id}/copy-assets/{target_id}", status_code=204)
def copy_assets(
    project_id: UUID,
    target_id: UUID,
    data: AssetCopies,
    user: CurrentUserDependency,
    session: SessionDependency,
) -> None:
    for item in sorted({project_id, target_id}):
        service.project_for(session, user.id, item)
    for asset_id in sorted(set(data.asset_ids)):
        if session.get(ProjectAsset, (project_id, asset_id)) is None:
            raise HTTPException(409, "原作品中的素材已被移除，请先整理本地画布")
        service.asset_for(session, user.id, asset_id)
        if session.get(ProjectAsset, (target_id, asset_id)) is None:
            session.add(ProjectAsset(project_id=target_id, asset_id=asset_id))
    session.commit()


@router.get("/health")
def media_health() -> dict[str, str]:
    return {"status": "ok", "system": "media"}


@router.get("/projects")
def projects(
    user: CurrentUserDependency, session: SessionDependency, q: str = ""
) -> list[dict[str, object]]:
    rows = session.scalars(
        select(MediaProject)
        .where(
            MediaProject.owner_id == user.id,
            MediaProject.name.contains(q, autoescape=True),
        )
        .order_by(MediaProject.updated_at.desc())
    )
    return [service.project_data(row) for row in rows]


@router.post("/projects", status_code=201)
def create_project(
    data: ProjectWrite, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    project = MediaProject(
        owner_id=user.id, name=data.name, canvas=CanvasDocument().model_dump(mode="json")
    )
    session.add(project)
    session.commit()
    return service.project_data(project)


@router.get("/projects/{project_id}")
def get_project(
    project_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    return service.project_data(service.project_for(session, user.id, project_id))


@router.patch("/projects/{project_id}")
def rename_project(
    project_id: UUID, data: ProjectWrite, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    project = service.project_for(session, user.id, project_id)
    project.name = data.name
    project.updated_at = datetime.now(UTC)
    session.commit()
    return service.project_data(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> None:
    project = service.project_for(session, user.id, project_id)
    ids = list(
        session.scalars(select(ProjectAsset.asset_id).where(ProjectAsset.project_id == project.id))
    )
    session.execute(delete(ProjectAsset).where(ProjectAsset.project_id == project.id))
    session.delete(project)
    paths = service.collect_orphans(session, ids)
    session.commit()
    for path in paths:
        path.unlink(missing_ok=True)


@router.get("/projects/{project_id}/canvas")
def canvas(
    project_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    project = service.project_for(session, user.id, project_id)
    return {"version": project.version, "document": project.canvas}


@router.put("/projects/{project_id}/canvas")
def save_canvas(
    project_id: UUID, data: CanvasWrite, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    project = service.project_for(session, user.id, project_id)
    if project.version != data.version:
        raise HTTPException(409, "作品已在其他窗口修改，请重新加载或另存为作品")
    ids = set(
        session.scalars(select(ProjectAsset.asset_id).where(ProjectAsset.project_id == project.id))
    )
    node_ids = [node.id for node in data.document.nodes]
    if len(set(node_ids)) != len(node_ids):
        raise HTTPException(422, "节点标识不能重复")
    edge_ids = [edge.id for edge in data.document.edges]
    if len(set(edge_ids)) != len(edge_ids):
        raise HTTPException(422, "连线标识不能重复")
    for edge in data.document.edges:
        if edge.source not in node_ids or edge.target not in node_ids or edge.source == edge.target:
            raise HTTPException(422, "连线必须连接作品内两个不同节点")
    for node in data.document.nodes:
        if node.type == "asset" and node.asset_id not in ids:
            raise HTTPException(422, "画布包含未关联到作品的素材")
    project.canvas = data.document.model_dump(mode="json")
    project.version += 1
    project.updated_at = datetime.now(UTC)
    session.commit()
    return {"version": project.version, "document": project.canvas}


@router.get("/assets")
@router.get("/projects/{project_id}/assets")
def assets(
    user: CurrentUserDependency,
    session: SessionDependency,
    project_id: UUID | None = None,
    q: str = "",
    kind: Literal["image", "video", "audio"] | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 24,
) -> dict[str, object]:
    statement = select(MediaAsset).where(
        MediaAsset.owner_id == user.id, MediaAsset.name.contains(q, autoescape=True)
    )
    if project_id is not None:
        service.project_for(session, user.id, project_id)
        statement = statement.join(ProjectAsset).where(ProjectAsset.project_id == project_id)
    else:
        statement = statement.where(MediaAsset.in_library.is_(True))
    if kind:
        statement = statement.where(MediaAsset.kind == kind)
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = session.scalars(
        statement.order_by(MediaAsset.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {"items": [service.asset_data(row) for row in rows], "total": total}


@router.post("/assets", status_code=201)
@router.post("/projects/{project_id}/assets", status_code=201)
def upload_asset(
    file: UploadFile,
    user: CurrentUserDependency,
    session: SessionDependency,
    project_id: UUID | None = None,
) -> dict[str, object]:
    if project_id:
        service.project_for(session, user.id, project_id)
    mime = (file.content_type or "").split(";")[0]
    if mime not in service.ALLOWED_TYPES:
        raise HTTPException(415, "请上传支持的图片、视频或音频格式")
    asset_id = uuid4()
    service.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    path = service.STORAGE_ROOT / str(asset_id)
    size = 0
    try:
        with path.open("xb") as destination:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > service.MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "单个文件不能超过 200 MiB")
                destination.write(chunk)
        if size == 0:
            raise HTTPException(422, "文件不能为空")
        asset = MediaAsset(
            id=asset_id,
            owner_id=user.id,
            name=(file.filename or "素材")[:255],
            mime_type=mime,
            kind=mime.split("/")[0],
            size=size,
            in_library=project_id is None,
        )
        session.add(asset)
        session.flush()
        if project_id:
            session.add(ProjectAsset(project_id=project_id, asset_id=asset_id))
        session.commit()
        return service.asset_data(asset)
    except Exception:
        session.rollback()
        path.unlink(missing_ok=True)
        raise


@router.get("/assets/{asset_id}")
def get_asset(
    asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    return service.asset_data(service.asset_for(session, user.id, asset_id))


@router.get("/assets/{asset_id}/file")
def asset_file(
    asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> FileResponse:
    asset = service.asset_for(session, user.id, asset_id)
    path = service.STORAGE_ROOT / str(asset.id)
    if not path.is_file():
        raise HTTPException(404, "素材文件不可用")
    return FileResponse(
        path,
        filename=asset.name,
        media_type=asset.mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/assets/{asset_id}/library")
def promote_asset(
    asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    asset = service.asset_for(session, user.id, asset_id)
    asset.in_library = True
    session.commit()
    return service.asset_data(asset)


@router.post("/projects/{project_id}/assets/reference")
def reference_asset(
    project_id: UUID, data: AssetReference, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    service.project_for(session, user.id, project_id)
    asset = service.asset_for(session, user.id, data.asset_id)
    if not asset.in_library and session.get(ProjectAsset, (project_id, asset.id)) is None:
        raise HTTPException(404, "素材不在账户素材库中")
    if session.get(ProjectAsset, (project_id, asset.id)) is None:
        session.add(ProjectAsset(project_id=project_id, asset_id=asset.id))
    session.commit()
    return service.asset_data(asset)


@router.delete("/projects/{project_id}/assets/{asset_id}")
def remove_reference(
    project_id: UUID, asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    project = service.project_for(session, user.id, project_id)
    service.asset_for(session, user.id, asset_id)
    session.execute(
        delete(ProjectAsset).where(
            ProjectAsset.project_id == project_id, ProjectAsset.asset_id == asset_id
        )
    )
    document = CanvasDocument.model_validate(project.canvas)
    document.nodes = [node for node in document.nodes if node.asset_id != asset_id]
    remaining = {node.id for node in document.nodes}
    document.edges = [
        edge for edge in document.edges if edge.source in remaining and edge.target in remaining
    ]
    project.canvas = document.model_dump(mode="json")
    project.version += 1
    project.updated_at = datetime.now(UTC)
    paths = service.collect_orphans(session, [asset_id])
    session.commit()
    for path in paths:
        path.unlink(missing_ok=True)
    return {"version": project.version, "document": project.canvas}


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: UUID, user: CurrentUserDependency, session: SessionDependency) -> None:
    asset = service.asset_for(session, user.id, asset_id)
    referenced = session.scalars(
        select(MediaProject).join(ProjectAsset).where(ProjectAsset.asset_id == asset_id)
    ).all()
    if referenced:
        raise HTTPException(409, "素材仍被作品引用：" + "、".join(p.name for p in referenced))
    session.delete(asset)
    session.commit()
    (service.STORAGE_ROOT / str(asset.id)).unlink(missing_ok=True)
