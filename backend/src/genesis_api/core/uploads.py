"""共用有界分块上传，不信任文件名与声明大小。"""

from hashlib import sha256
from pathlib import Path

from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


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
