"""影音归属查询与素材回收；事务提交和实际文件删除由路由编排。"""

from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset

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
        素材标识、名称、类型、大小与是否保留在账户库的标记。
    """
    return {
        "id": str(asset.id),
        "name": asset.name,
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
