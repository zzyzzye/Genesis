"""生成有界的图片缩略图缓存；调用方必须先校验素材读取权限。"""

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from threading import Lock

from PIL import Image, ImageOps

_locks = [Lock() for _ in range(16)]


@lru_cache(maxsize=64)
def _render(path: Path, modified: int, size: int) -> bytes:
    """按文件版本缓存最多 64 张 320px 缩略图，不写入原始素材。"""
    with Image.open(path) as source:
        source.thumbnail((320, 320))
        image = ImageOps.exif_transpose(source).convert("RGBA")
        output = BytesIO()
        image.save(output, format="WEBP", quality=80, method=4)
        return output.getvalue()


def thumbnail(path: Path) -> bytes:
    """合并同一文件的并发生成，修改或删除原文件后不复用旧版本。"""
    with _locks[hash(path) % len(_locks)]:
        stat = path.stat()
        return _render(path, stat.st_mtime_ns, stat.st_size)
