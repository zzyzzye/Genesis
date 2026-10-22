"""只读导出文章为 Markdown 或 ZIP，不读取附件、评论及账户私有字段。"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from contextlib import ExitStack
from datetime import UTC, datetime
from tempfile import SpooledTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile

from genesis_api.blog.models import BlogPost
from genesis_api.blog.schemas import BlogPostAdminRead


def markdown_filename(post: BlogPost) -> str:
    """生成不含路径字符的 ASCII 文件名，兼容历史文章的非规范 slug。"""
    slug = re.sub(r"[^a-z0-9-]", "-", post.slug.lower()).strip("-")[:160]
    return f"{slug or post.id}.md"


def article_markdown(post: BlogPost) -> str:
    """生成带 YAML front matter 的 Markdown，正文逐字保留。

    Args:
        post: 已由调用方授权读取、关联数据可用的文章。

    Returns:
        UTF-8 文本；元数据采用兼容 YAML 的 JSON 值转义，保留状态与多分类。
        不插入额外正文标题，也不改写代码、链接或附件地址。
    """
    metadata = BlogPostAdminRead.model_validate(post).model_dump(
        mode="json", exclude={"content_markdown"}
    )
    lines = ["---", "genesis_export_version: 1"]
    for key, value in metadata.items():
        encoded = json.dumps(value, ensure_ascii=False)
        # YAML 将这些 Unicode 字符视为换行，显式转义以免改变字段内容。
        for character in ("\x85", "\u2028", "\u2029"):
            encoded = encoded.replace(character, f"\\u{ord(character):04x}")
        lines.append(f"{key}: {encoded}")
    return "\n".join([*lines, "---", "", post.content_markdown])


def articles_archive(posts: Iterable[BlogPost], *, trashed: bool) -> SpooledTemporaryFile[bytes]:
    """将指定范围的文章写入临时 ZIP，交给响应在传输结束后关闭。

    Args:
        posts: 调用方已经过滤删除状态并完成授权的文章集合。
        trashed: 清单中记录为回收站导出，默认范围由路由决定。

    Returns:
        已回到起点的二进制文件；超过 8 MiB 时转为系统临时文件，减少内存占用。
        清单仅记录文件与原始标识，不包含附件或评论。

    Raises:
        Exception: 序列化或写入失败时关闭临时文件并继续抛出原异常。
    """
    with ExitStack() as resources:
        output: SpooledTemporaryFile[bytes] = resources.enter_context(
            SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
        )
        entries: list[dict[str, str]] = []
        with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
            for post in posts:
                # UUID 确保规范化后的历史 slug 不会造成重名或路径穿越。
                filename = f"articles/{markdown_filename(post)[:-3]}--{post.id}.md"
                archive.writestr(filename, article_markdown(post))
                entries.append({"id": str(post.id), "slug": post.slug, "file": filename})
            manifest = {
                "format": "genesis-articles",
                "version": 1,
                "exported_at": datetime.now(UTC).isoformat(),
                "scope": "trash" if trashed else "active",
                "count": len(entries),
                "articles": entries,
                "includes": {"comments": False, "attachments": False, "pages": False},
            }
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            archive.writestr(
                "README.md",
                "# Genesis 文章导出\n\n"
                + ("范围：回收站内的全部文章。\n" if trashed else "范围：全部草稿和已发布文章。\n")
                + "\narticles/ 中每篇文章包含原样 Markdown 正文，以及分类、标签、作者公开资料、"
                "发布状态和时间等 front matter 元数据。manifest.json 提供文件索引与格式版本。\n"
                "\n仅导出服务器已保存版本，不包含评论和附件文件；"
                "正文中的图片与附件地址保持原样，迁移站点时需要另行迁移对应文件。\n"
                "\n可在文章管理中导入此 ZIP：先预览，再将所选条目创建为草稿，"
                "同路径文章不会覆盖，原作者、标识、发布状态与定时计划不会恢复。"
                "这不是完整数据库备份。\n",
            )
        output.seek(0)
        # 成功后交给响应接管；异常仍由 ExitStack 关闭文件。
        resources.pop_all()
        return output
