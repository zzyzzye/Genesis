"""私有影音 API：校验资源归属、画布关联、并发版本与上传边界。"""

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
    """在当前用户的两个作品间复制素材引用，不复制底层文件。

    Args:
        project_id: 素材当前所属的源作品 UUID。
        target_id: 同一用户的目标作品 UUID。
        data: 待引用素材 ID 列表，内部去重后处理。
        user: 已认证用户，源与目标作品都按该身份校验归属。
        session: 当前事务会话，按稳定顺序锁定作品后提交引用。

    Raises:
        HTTPException: 作品或素材不属于用户返回 404；源引用已移除返回 409。
    """
    for item in sorted({project_id, target_id}):
        # 源和目标作品采用相同锁定顺序，并都必须属于当前用户。
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
    """返回影音模块存活标识，不检测素材存储或生成服务。"""
    return {"status": "ok", "system": "media"}


@router.get("/projects")
def projects(
    user: CurrentUserDependency, session: SessionDependency, q: str = ""
) -> list[dict[str, object]]:
    """按名称筛选当前用户的作品，按最近更新时间倒序返回。

    Args:
        user: 已认证用户，查询仅包含其作品。
        session: 当前请求会话。
        q: 名称查询片段，SQL 通配字符按普通文字处理。

    Returns:
        全部匹配作品的摘要，不包含画布文档，此接口不分页。
    """
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
    """为当前用户创建带空画布的作品并提交。

    Args:
        data: 已规范化并校验的作品名称。
        user: 已认证用户，作为作品所有者。
        session: 当前请求会话。

    Returns:
        新作品摘要，包含初始画布版本。
    """
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
    """返回当前用户的作品摘要，不存在或归属不符时返回 404。"""
    return service.project_data(service.project_for(session, user.id, project_id))


@router.patch("/projects/{project_id}")
def rename_project(
    project_id: UUID, data: ProjectWrite, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    """锁定当前用户的作品并改名，不修改画布保存版本。

    Args:
        project_id: 待改名作品 UUID。
        data: 已校验的新名称。
        user: 已认证用户。
        session: 当前事务会话，此处提交名称与更新时间。

    Returns:
        更新后的作品摘要。

    Raises:
        HTTPException: 作品不存在或不属于用户，返回 404。
    """
    project = service.project_for(session, user.id, project_id)
    project.name = data.name
    project.updated_at = datetime.now(UTC)
    session.commit()
    return service.project_data(project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> None:
    """删除作品及素材引用，提交后清理失去全部引用的临时素材文件。

    Args:
        project_id: 待删除作品 UUID。
        user: 已认证用户，删除前检查作品归属。
        session: 当前事务会话，数据库提交先于文件删除。

    Raises:
        HTTPException: 作品不存在或不属于用户，返回 404。
        OSError: 数据库已提交后的文件清理失败，不会自动回滚作品删除。
    """
    project = service.project_for(session, user.id, project_id)
    ids = list(
        session.scalars(select(ProjectAsset.asset_id).where(ProjectAsset.project_id == project.id))
    )
    session.execute(delete(ProjectAsset).where(ProjectAsset.project_id == project.id))
    session.delete(project)
    paths = service.collect_orphans(session, ids)
    # 先提交作品和引用删除，再清理文件；文件系统删除不属于数据库事务。
    session.commit()
    for path in paths:
        path.unlink(missing_ok=True)


@router.get("/projects/{project_id}/canvas")
def canvas(
    project_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    """返回作品完整画布与版本；归属检查失败时返回 404。"""
    project = service.project_for(session, user.id, project_id)
    return {"version": project.version, "document": project.canvas}


@router.put("/projects/{project_id}/canvas")
def save_canvas(
    project_id: UUID, data: CanvasWrite, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    """锁定作品并按客户端版本保存完整画布，检查节点与素材引用关系。

    Args:
        project_id: 待保存作品 UUID。
        data: 客户端读取的版本与完整画布文档，不是增量补丁。
        user: 已认证用户，作为作品归属检查依据。
        session: 当前事务会话，锁覆盖版本比较、关系校验与提交。

    Returns:
        保存后的画布文档与递增版本。

    Raises:
        HTTPException: 归属不符返回 404，客户端版本过期返回 409，
            节点、连线、分组或素材引用关系无效返回 422。
    """
    project = service.project_for(session, user.id, project_id)
    if project.version != data.version:
        # 行锁保证版本检查与保存处于同一事务；客户端须先核对最新版本再重试。
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
    grouped_ids: set[UUID] = set()
    # Pydantic 负责节点字段范围，此处再检查节点之间的关系与数据库素材关联。
    node_by_id = {node.id: node for node in data.document.nodes}
    if any(
        node_by_id[edge.source].type == "group" or node_by_id[edge.target].type == "group"
        for edge in data.document.edges
    ):
        raise HTTPException(422, "分组边框不能作为连线端点")
    for node in data.document.nodes:
        if node.type == "asset" and node.asset_id not in ids:
            raise HTTPException(422, "画布包含未关联到作品的素材")
        if node.type in ("video", "image", "audio") and node.asset_id is not None:
            if node.asset_id not in ids:
                raise HTTPException(422, "节点包含未关联到作品的素材")
            asset = session.get(MediaAsset, node.asset_id)
            if asset is None or (node.type in ("image", "audio") and asset.kind != node.type):
                raise HTTPException(422, "素材类型与节点不匹配")
        if node.type == "group":
            if len(node.member_ids) < 2 or len(set(node.member_ids)) != len(node.member_ids):
                raise HTTPException(422, "分组至少需要两个不同节点")
            for member_id in node.member_ids:
                member = node_by_id.get(member_id)
                if member is None or member.type == "group" or member_id in grouped_ids:
                    raise HTTPException(422, "分组成员无效或已属于其他分组")
                grouped_ids.add(member_id)
        elif node.member_ids:
            raise HTTPException(422, "只有分组节点可以包含成员")
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
    """分页查询当前用户的作品素材或账户素材库。

    Args:
        user: 已认证用户，所有查询均限制素材归属。
        session: 当前请求会话。
        project_id: 有值时只查询该作品引用；None 时只查询账户库保留项。
        q: 素材名称查询片段，按普通文字处理 SQL 通配字符。
        kind: 可选图片、视频或音频筛选。
        page: 从一开始的页码。
        page_size: 每页数量，接口限制不超过一百。

    Returns:
        当前页素材展示数据及筛选后的总数。

    Raises:
        HTTPException: 指定作品不存在或不属于用户，返回 404。
    """
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
    """分块保存上传文件及素材记录，失败时回滚并清理本次文件。

    Args:
        file: 上传文件，按声明的 MIME 类型白名单检查，不进行内容转码。
        user: 已认证用户，作为素材所有者。
        session: 当前事务会话，文件写入后保存记录并提交。
        project_id: 指定时建立作品引用；None 时直接保留在账户素材库。

    Returns:
        素材展示信息，不包含服务器文件路径。

    Raises:
        HTTPException: 作品归属不符返回 404，类型不支持返回 415，
            大小超过限制返回 413，文件为空返回 422。
        OSError: 文件创建、写入或失败清理发生错误。
    """
    if project_id:
        service.project_for(session, user.id, project_id)
    mime = (file.content_type or "").split(";")[0]
    if mime not in service.ALLOWED_TYPES:
        raise HTTPException(415, "请上传支持的图片、视频或音频格式")
    asset_id = uuid4()
    service.STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    # 服务端 UUID 决定文件路径，上传文件名只作为展示元数据，不参与路径拼接。
    path = service.STORAGE_ROOT / str(asset_id)
    size = 0
    try:
        with path.open("xb") as destination:
            # 分块复制并累计实际大小，不把整个文件载入内存或只信任上传声明。
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
        # 文件写入与数据库提交不能组成原子事务，失败时回滚并清理本次文件。
        session.rollback()
        path.unlink(missing_ok=True)
        raise


@router.get("/assets/{asset_id}")
def get_asset(
    asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    """读取当前用户的素材元数据，不存在或归属不符时返回 404。"""
    return service.asset_data(service.asset_for(session, user.id, asset_id))


@router.get("/assets/{asset_id}/file")
def asset_file(
    asset_id: UUID, user: CurrentUserDependency, session: SessionDependency
) -> FileResponse:
    """返回当前用户的素材文件，禁止共享缓存并关闭 MIME 嗅探。

    Args:
        asset_id: 素材 UUID，文件路径仅按服务端标识构建。
        user: 已认证用户。
        session: 当前请求会话，用于素材归属查询。

    Returns:
        使用展示名称及已存 MIME 类型的文件响应。

    Raises:
        HTTPException: 素材不属于用户、记录不存在或文件缺失，返回 404。
    """
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
    """将当前用户的素材保留到账户素材库，不复制文件或删除作品引用。"""
    asset = service.asset_for(session, user.id, asset_id)
    asset.in_library = True
    session.commit()
    return service.asset_data(asset)


@router.post("/projects/{project_id}/assets/reference")
def reference_asset(
    project_id: UUID, data: AssetReference, user: CurrentUserDependency, session: SessionDependency
) -> dict[str, object]:
    """将账户库素材引用到当前用户的作品，已有引用不重复创建。

    Args:
        project_id: 目标作品 UUID。
        data: 待引用素材 UUID。
        user: 已认证用户，作品和素材都需属于该用户。
        session: 当前事务会话，此处提交引用记录。

    Returns:
        被引用素材的展示数据。

    Raises:
        HTTPException: 归属不符或素材不在账户库且尚未关联该作品，返回 404。
    """
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
    """移除作品素材引用，并清理引用它的节点、连线及不足两项的分组。

    Args:
        project_id: 当前用户的作品 UUID。
        asset_id: 待移除引用的素材 UUID。
        user: 已认证用户，作品与素材均按该身份检查。
        session: 当前事务会话，保存画布后提交，再删除已成为孤立项的文件。

    Returns:
        清理后的完整画布及递增版本，其他作品和账户库中的素材保留。

    Raises:
        HTTPException: 作品或素材不存在或归属不符，返回 404。
        OSError: 数据库提交后清理孤立文件失败。
    """
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
    for node in document.nodes:
        if node.type == "group":
            node.member_ids = [member for member in node.member_ids if member in remaining]
    document.nodes = [
        node for node in document.nodes if node.type != "group" or len(node.member_ids) >= 2
    ]
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
    """删除没有作品引用的素材记录，再清理文件。

    Args:
        asset_id: 待删除素材 UUID。
        user: 已认证用户，删除前检查素材归属。
        session: 当前事务会话，记录删除先于文件清理提交。

    Raises:
        HTTPException: 素材归属不符返回 404，仍被作品引用返回 409。
        OSError: 数据库提交后的文件清理失败。
    """
    asset = service.asset_for(session, user.id, asset_id)
    referenced = session.scalars(
        select(MediaProject).join(ProjectAsset).where(ProjectAsset.asset_id == asset_id)
    ).all()
    if referenced:
        # 拒绝删除仍被作品使用的素材，避免留下失效的画布引用。
        raise HTTPException(409, "素材仍被作品引用：" + "、".join(p.name for p in referenced))
    session.delete(asset)
    session.commit()
    (service.STORAGE_ROOT / str(asset.id)).unlink(missing_ok=True)
