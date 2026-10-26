"""账户头像存储，复用持久化媒体卷与有界上传能力。"""

from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from genesis_api.core.uploads import copy_upload, image_header_mime, media_suffix

STORAGE_ROOT = Path("/data/media/avatars")
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def save_upload(file: UploadFile) -> tuple[Path, str]:
    """按内容识别位图并限制 5 MiB，返回新路径和 MIME，失败不保留文件。"""
    header = file.file.read(32)
    file.file.seek(0)
    mime = image_header_mime(header)
    if mime is None:
        raise HTTPException(422, "请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片")
    path = STORAGE_ROOT / f"{uuid4()}{media_suffix(mime)}"
    copy_upload(file, path, MAX_AVATAR_BYTES)
    return path, mime
