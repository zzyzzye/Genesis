"""影音归属查询、节点改名与素材回收；事务提交由调用方编排。"""

from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.core.uploads import media_filename
from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset
from genesis_api.media.schemas import CanvasDocument, CanvasWrite, ProjectWrite

STORAGE_ROOT = Path("/data/media")
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/flac",
    "audio/webm",
    "audio/aac",
}


def generated_asset_name(snapshot: dict[str, object], kind: str, index: int = 0) -> str:
    """按提交时的节点名及结果序号命名，不将任务标识作为素材名称。"""
    title = snapshot.get("name")
    label = "图片" if kind == "image" else "视频"
    base = (
        title.strip()
        if isinstance(title, str) and title.strip()
        else ("生图" if kind == "image" else "生视频")
    )
    suffix = f" · {label} {index + 1}"
    return base[: 120 - len(suffix)] + suffix


def sync_asset_names(
    session: Session,
    project: MediaProject,
    document: CanvasDocument,
    *,
    rename: bool = False,
) -> CanvasDocument:
    """素材节点共用数据库名称；保存时仅将明确的节点改名写回素材。

    Args:
        session: 调用方提交的事务会话。
        project: 已校验归属并锁定的作品。
        document: 待读取或保存的完整画布。
        rename: 保存时检测相对已保存画布的改名；读取不修改数据库。

    Returns:
        素材节点名称与素材记录一致的画布，生成草稿名称保持独立。

    Raises:
        HTTPException: 同一素材收到多个冲突名称时返回 422。
    """
    material_types = {"image", "video_asset", "audio", "asset"}
    ids = {
        node.asset_id for node in document.nodes if node.type in material_types and node.asset_id
    }
    if not ids:
        return document
    assets = {
        asset.id: asset
        for asset in session.scalars(
            select(MediaAsset)
            .join(ProjectAsset, ProjectAsset.asset_id == MediaAsset.id)
            .where(
                MediaAsset.id.in_(ids),
                MediaAsset.owner_id == project.owner_id,
                ProjectAsset.project_id == project.id,
            )
            .order_by(MediaAsset.id)
            .with_for_update(of=MediaAsset)
        )
    }
    previous = {node.id: node for node in CanvasDocument.model_validate(project.canvas).nodes}
    names: dict[UUID, str] = {}
    if rename:
        for node in document.nodes:
            old = previous.get(node.id)
            if (
                node.type not in material_types
                or node.asset_id not in assets
                or old is None
                or old.asset_id != node.asset_id
                or not node.name.strip()
                or node.name == old.name
            ):
                continue
            assert node.asset_id is not None
            name = node.name.strip()
            if node.asset_id in names and names[node.asset_id] != name:
                raise HTTPException(422, "同一素材不能同时使用不同名称")
            names[node.asset_id] = name
        for asset_id, name in names.items():
            assets[asset_id].name = name
    return document.model_copy(
        update={
            "nodes": [
                node.model_copy(update={"name": assets[node.asset_id].name[:120]})
                if node.type in material_types and node.asset_id in assets
                else node
                for node in document.nodes
            ]
        }
    )


def project_for(session: Session, owner_id: UUID, project_id: UUID) -> MediaProject:
    """读取并锁定当前用户的作品，不暴露其他用户的记录是否存在。

    Args:
        session: 当前事务的数据库会话。
        owner_id: 服务端认证的用户 ID。
        project_id: 待访问作品 ID。

    Returns:
        已申请行锁的作品，锁随调用方事务结束释放。

    Raises:
        HTTPException: 作品不存在或不属于当前用户，统一返回 404。
    """
    project = session.scalar(
        select(MediaProject)
        .where(
            MediaProject.id == project_id,
            MediaProject.owner_id == owner_id,
        )
        .with_for_update()
    )
    if project is None:
        raise HTTPException(404, "作品不存在")
    return project


def rename_node(
    session: Session,
    owner_id: UUID,
    project_id: UUID,
    node_id: UUID,
    name: str,
    expected_version: int,
) -> dict[str, object]:
    """按作品版本改名一个节点，保留原始画布的所有其他字段。

    Args:
        session: 调用方提交事务的会话，行锁覆盖版本检查和改名。
        owner_id: 已认证的用户标识，不接受模型指定身份。
        project_id: 当前用户拥有的作品。
        node_id: 作品内真实节点，所有节点类型均支持。
        name: 去除首尾空白后为 1–120 字符的名称。
        expected_version: 读取画布时取得的版本；同名重放不重复写入。

    Returns:
        节点原名、新名、作品版本和是否实际改动；调用方负责提交。

    Raises:
        HTTPException: 作品或节点不可访问返回 404，过期修改返回 409。
        ValidationError: 名称为空或超过长度限制。
    """
    name = ProjectWrite(name=name).name
    project = project_for(session, owner_id, project_id)
    document = CanvasDocument.model_validate(project.canvas)
    index = next((i for i, node in enumerate(document.nodes) if node.id == node_id), None)
    if index is None:
        raise HTTPException(404, "节点不存在")
    previous_name = document.nodes[index].name
    changed = previous_name != name
    if changed:
        if project.version != expected_version:
            raise HTTPException(409, "画布已更新，请重新读取画布后改名")
        # 只复制目标名称，不用默认值重建旧画布或改动正文、布局及素材关联。
        nodes = list(cast(list[dict[str, object]], project.canvas["nodes"]))
        nodes[index] = {**nodes[index], "name": name}
        target = document.nodes[index]
        material_types = {"image", "video_asset", "audio", "asset"}
        if target.asset_id and target.type in material_types:
            synchronized = sync_asset_names(
                session,
                project,
                CanvasDocument.model_validate({**project.canvas, "nodes": nodes}),
                rename=True,
            )
            for position, node in enumerate(synchronized.nodes):
                if node.asset_id == target.asset_id and node.type in material_types:
                    nodes[position] = {**nodes[position], "name": node.name}
        project.canvas = {**project.canvas, "nodes": nodes}
        project.version += 1
        project.updated_at = datetime.now(UTC)
    return {
        "project_id": str(project_id),
        "node_id": str(node_id),
        "previous_name": previous_name,
        "name": name,
        "version": project.version,
        "changed": changed,
    }


def asset_for(session: Session, owner_id: UUID, asset_id: UUID) -> MediaAsset:
    """读取并锁定当前用户的素材，不在此检查作品引用关系。

    Args:
        session: 当前事务的数据库会话。
        owner_id: 服务端认证的用户 ID。
        asset_id: 素材 ID。

    Returns:
        已申请行锁的素材，锁随调用方事务结束释放。

    Raises:
        HTTPException: 素材不存在或不属于当前用户，统一返回 404。
    """
    asset = session.scalar(
        select(MediaAsset)
        .where(
            MediaAsset.id == asset_id,
            MediaAsset.owner_id == owner_id,
        )
        .with_for_update()
    )
    if asset is None:
        raise HTTPException(404, "素材不存在")
    return asset


def asset_data(asset: MediaAsset) -> dict[str, object]:
    """提取素材展示字段，不包含服务器文件路径。

    Args:
        asset: 已通过归属检查的素材实体。

    Returns:
        素材标识、显示名、下载文件名、类型、大小与账户库保留标记。
    """
    return {
        "id": str(asset.id),
        "name": asset.name,
        "download_name": media_filename(asset.name, asset.mime_type),
        "kind": asset.kind,
        "mime_type": asset.mime_type,
        "size": asset.size,
        "in_library": asset.in_library,
    }


def project_data(project: MediaProject) -> dict[str, object]:
    """提取作品列表与概览数据，不携带完整画布。

    Args:
        project: 已通过归属检查的作品实体。

    Returns:
        可 JSON 序列化的作品摘要，包含画布保存版本。
    """
    return {
        "id": str(project.id),
        "name": project.name,
        "updated_at": project.updated_at.isoformat(),
        "version": project.version,
    }


def collect_orphans(session: Session, asset_ids: list[UUID]) -> list[Path]:
    """删除无作品引用且未保留在账户库中的素材记录，不删除文件。

    Args:
        session: 已完成归属校验的业务事务会话，此处不提交。
        asset_ids: 待检查的素材 ID，内部去重并按稳定顺序申请行锁。

    Returns:
        调用方提交数据库事务后应删除的文件路径，回滚时不得删除这些文件。
    """
    paths = []
    # 去重并按稳定顺序锁定素材，降低并发清理时因锁顺序不同产生死锁的风险。
    for asset_id in sorted(set(asset_ids)):
        asset = session.scalar(
            select(MediaAsset).where(MediaAsset.id == asset_id).with_for_update()
        )
        referenced = session.scalar(
            select(ProjectAsset.asset_id)
            .where(
                ProjectAsset.asset_id == asset_id,
            )
            .limit(1)
        )
        if asset is not None and not asset.in_library and referenced is None:
            # 此处只操作数据库；提交成功前不删除文件，避免回滚后引用仍在而文件丢失。
            session.delete(asset)
            paths.append(STORAGE_ROOT / str(asset_id))
    return paths


def save_canvas(
    session: Session, actor_id: UUID, project_id: UUID, data: CanvasWrite
) -> dict[str, object]:
    """统一校验画布版本、节点、分组和素材归属后保存。

    Args:
        session: 当前数据库会话，成功时提交事务。
        actor_id: 经过认证的业务用户。
        project_id: 用户拥有的作品。
        data: 读取版本及完整目标画布。

    Returns:
        递增版本及保存后的完整文档。

    Raises:
        HTTPException: 无权访问、版本过期或节点关系无效。
    """
    project = project_for(session, actor_id, project_id)
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
        if (
            node.type
            in ("video", "image_generation", "audio_generation", "video_asset", "image", "audio")
            and node.asset_id is not None
        ):
            if node.asset_id not in ids:
                raise HTTPException(422, "节点包含未关联到作品的素材")
            asset = session.get(MediaAsset, node.asset_id)
            expected_kind = {
                "image_generation": "image",
                "audio_generation": "audio",
                "video_asset": "video",
            }.get(node.type, node.type)
            if asset is None or (
                asset.kind == "audio" if node.type == "video" else asset.kind != expected_kind
            ):
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
    document = sync_asset_names(session, project, data.document, rename=True)
    project.canvas = document.model_dump(mode="json")
    project.version += 1
    project.updated_at = datetime.now(UTC)
    session.commit()
    return {"version": project.version, "document": project.canvas}
