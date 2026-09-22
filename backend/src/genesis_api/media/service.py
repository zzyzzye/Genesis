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
    return {
        "id": str(asset.id),
        "name": asset.name,
        "kind": asset.kind,
        "mime_type": asset.mime_type,
        "size": asset.size,
        "in_library": asset.in_library,
    }


def project_data(project: MediaProject) -> dict[str, object]:
    return {
        "id": str(project.id),
        "name": project.name,
        "updated_at": project.updated_at.isoformat(),
        "version": project.version,
    }


def collect_orphans(session: Session, asset_ids: list[UUID]) -> list[Path]:
    paths = []
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
            session.delete(asset)
            paths.append(STORAGE_ROOT / str(asset_id))
    return paths
