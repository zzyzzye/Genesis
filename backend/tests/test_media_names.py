"""验证外部参考链接与媒体上传文件名的后缀契约。"""

import pytest

from genesis_api.core.uploads import media_filename, media_suffix


@pytest.mark.parametrize(
    ("mime", "suffix"),
    [
        ("image/jpeg", ".jpg"),
        ("image/png", ".png"),
        ("image/avif", ".avif"),
        ("video/mp4", ".mp4"),
        ("video/quicktime", ".mov"),
        ("audio/mpeg", ".mp3"),
        ("audio/x-wav", ".wav"),
        ("audio/webm", ".webm"),
        ("IMAGE/WEBP; charset=binary", ".webp"),
    ],
)
def test_reference_suffix_matches_media_type(mime: str, suffix: str) -> None:
    """参考 URL 使用类型后缀，不受原名影响。"""
    assert media_suffix(mime) == suffix


@pytest.mark.parametrize(
    ("name", "mime", "expected"),
    [
        ("人物参考.png", "image/png", "人物参考.png"),
        ("人物.JPEG", "image/jpeg", "人物.jpeg"),
        ("参考画面", "image/webp", "参考画面.webp"),
        ("人物.jpg", "image/png", "人物.png"),
        ("片段", "video/mp4", "片段.mp4"),
        ("C:\\private\\人物.png", "image/png", "人物.png"),
        ("../../人物\r\n.png", "image/png", "人物.png"),
        ("..", "image/png", "reference.png"),
    ],
)
def test_media_names_keep_valid_suffix_without_paths(name: str, mime: str, expected: str) -> None:
    """只生成安全传输名，不把原始路径或伪后缀带给模型。"""
    assert media_filename(name, mime) == expected


def test_long_name_keeps_suffix_and_unknown_type_uses_binary() -> None:
    """截断只作用于主体，不能再次截掉后缀。"""
    name = media_filename("长" * 300 + ".png", "image/png")
    assert len(name) == 255 and name.endswith(".png")
    assert media_suffix("application/unknown") == ".bin"
