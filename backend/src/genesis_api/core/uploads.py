"""共用有界分块上传，不信任文件名与声明大小。"""

from hashlib import sha256
from mimetypes import guess_all_extensions
from pathlib import Path

from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


def image_header_mime(header: bytes) -> str | None:
    """从签名识别可内嵌位图，不接受 SVG 或 HTML 等主动内容。"""
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "image/webp"
    if header[4:8] == b"ftyp" and header[8:12] in (b"avif", b"avis"):
        return "image/avif"
    return None


def media_suffix(mime_type: str) -> str:
    """按媒体类型生成稳定后缀，不将用户文件名用于参考链接路径。"""
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/avif": ".avif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
        "video/x-matroska": ".mkv",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/ogg": ".ogg",
        "audio/flac": ".flac",
        "audio/webm": ".webm",
        "audio/aac": ".aac",
    }.get(mime_type.split(";")[0].strip().lower(), ".bin")


def media_filename(name: str, mime_type: str) -> str:
    """保留与类型一致的后缀，补齐缺失或错误后缀，仅用于展示与传输。

    Args:
        name: 上传或重命名后的名称，不作为磁盘路径。
        mime_type: 业务已校验的媒体类型；聊天附件使用内容识别结果。

    Returns:
        去除路径及控制字符、保留后缀的至多 255 字文件名。
    """
    leaf = name.replace("\\", "/").rsplit("/", 1)[-1]
    leaf = "".join(char for char in leaf if ord(char) >= 32 and ord(char) != 127).strip()
    original_suffix = Path(leaf).suffix.lower()
    suffix = media_suffix(mime_type)
    if original_suffix and original_suffix in guess_all_extensions(mime_type, strict=False):
        suffix = original_suffix
    stem = Path(leaf).stem.strip(". ") or "reference"
    return stem[: 255 - len(suffix)] + suffix


def copy_upload(
    file: UploadFile, path: Path, limit: int, *, allow_empty: bool = False
) -> tuple[int, str]:
    """排他创建文件并计算摘要；写入失败只清理本次创建的文件。

    Args:
        file: 已解析的上传流，当前位置应位于文件起点。
        path: 由服务端生成的目标路径，不使用上传名称。
        limit: 实际允许的最大字节数。
        allow_empty: 是否接受零字节附件，影音素材保持禁止。

    Returns:
        实际字节数和 SHA-256 摘要。

    Raises:
        HTTPException: 超限返回 413，禁止的空文件返回 422。
        OSError: 目标已存在或底层存储不可用。
    """
    size = 0
    digest = sha256()
    path.parent.mkdir(parents=True, exist_ok=True)
    destination = path.open("xb")
    try:
        with destination:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"单个文件不能超过 {limit // (1024 * 1024)} MiB")
                destination.write(chunk)
                digest.update(chunk)
        if not size and not allow_empty:
            raise HTTPException(422, "文件不能为空")
        return size, digest.hexdigest()
    except Exception:
        path.unlink(missing_ok=True)
        raise
