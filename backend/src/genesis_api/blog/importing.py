"""复用 YAML 安全解析与 ZIP 读取，预览后只创建草稿，不覆盖已有文章。"""

import hashlib
import json
import re
import stat
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from uuid import UUID, uuid4
from zipfile import BadZipFile, ZipFile

import yaml
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from genesis_api.blog.models import BlogCategory, BlogPost, BlogTag
from genesis_api.blog.operations import (
    BlogOperationResult,
    operation_digest,
    previous_operation,
    save_operation,
)
from genesis_api.blog.schemas import BlogPostWrite, BlogTagWrite
from genesis_api.blog.service import apply_post_data
from genesis_api.identity.models import User

MAX_UPLOAD = 20 * 1024 * 1024
MAX_ARTICLE = 2 * 1024 * 1024
MAX_EXPANDED = 50 * 1024 * 1024


class ImportPreviewItem(BaseModel):
    """预览只返回展示字段，不把整批正文保存在浏览器存储中。"""

    path: str
    title: str
    slug: str
    categories: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    issue: str | None = None


class ImportPreview(BaseModel):
    """单次选择的解析结果；不写入文章或分类标签。"""

    items: list[ImportPreviewItem]


@dataclass
class ParsedArticle:
    """当前请求内的正文与元数据，不持久化上传文件。"""

    preview: ImportPreviewItem
    data: BlogPostWrite | None
    categories: list[BlogTagWrite]


def slug_for(value: str, fallback: str) -> str:
    """优先复用英文文件名；中文名称使用稳定摘要，不引入拼音依赖。"""
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:140].strip("-")
    return slug or f"import-{hashlib.sha256(fallback.encode()).hexdigest()[:12]}"


def taxonomy(value: object) -> list[BlogTagWrite]:
    """兼容名称列表及 Genesis 的名称/slug 对象列表，不接受无限层级元数据。"""
    if value is None:
        return []
    if isinstance(value, (str, dict)):
        value = [value]
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("分类和标签应为名称列表，最多 100 项")
    output: list[BlogTagWrite] = []
    for item in value:
        if isinstance(item, str):
            output.append(BlogTagWrite(name=item, slug=slug_for(item, item)))
        elif isinstance(item, dict):
            name = item.get("name")
            if not isinstance(name, str):
                raise ValueError("分类或标签缺少名称")
            output.append(BlogTagWrite(name=name, slug=item.get("slug") or slug_for(name, name)))
        else:
            raise ValueError("分类或标签格式无法识别")
    if len({item.slug for item in output}) != len(output):
        raise ValueError("分类或标签标识重复")
    return output


def split_front_matter(text: str) -> tuple[dict[str, object], str]:
    """只在文件开头解析有界 front matter，拒绝别名图和不安全 YAML 标签。"""
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, text
    size = 0
    for end, line in enumerate(lines[1:], 1):
        size += len(line.encode())
        if size > 64 * 1024:
            raise ValueError("front matter 超过 64 KiB")
        if line.strip() in {"---", "..."}:
            header = "".join(lines[1:end])
            for event in yaml.parse(header):
                if isinstance(event, yaml.AliasEvent):
                    raise ValueError("front matter 不支持 YAML 别名引用")
            value = yaml.safe_load(header)
            if value is not None and not isinstance(value, dict):
                raise ValueError("front matter 应为键值对象")
            body = "".join(lines[end + 1 :])
            if body.startswith("\r\n"):
                body = body[2:]
            elif body.startswith("\n"):
                body = body[1:]
            return value or {}, body
    raise ValueError("front matter 缺少结束的 ---")


def markdown_entries(files: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    """只读取 Markdown 项，不解压到磁盘，并核对总展开大小、路径和清单。"""
    entries: list[tuple[str, bytes]] = []
    expanded = 0
    for filename, content in files:
        if filename.lower().endswith((".md", ".markdown")):
            entries.append((filename, content))
            expanded += len(content)
            continue
        if not filename.lower().endswith(".zip"):
            raise ValueError("只支持 .md、.markdown 或 ZIP 文件")
        with ZipFile(BytesIO(content)) as archive:
            if len(archive.infolist()) > 1000:
                raise ValueError("ZIP 包含过多文件")
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("ZIP 存在重复文件路径")
            for info in archive.infolist():
                path = PurePosixPath(info.filename)
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or "\\" in info.filename
                    or ":" in info.filename
                ):
                    raise ValueError("ZIP 包含不安全路径")
                if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
                    raise ValueError("不支持符号链接或加密 ZIP")
            if "manifest.json" in names:
                info = archive.getinfo("manifest.json")
                if info.file_size > 512 * 1024:
                    raise ValueError("ZIP 清单过大")
                manifest = json.loads(archive.read(info))
                if (
                    not isinstance(manifest, dict)
                    or manifest.get("format") != "genesis-articles"
                    or manifest.get("version") != 1
                ):
                    raise ValueError("不支持这个 ZIP 清单格式或版本")
                items = manifest.get("articles")
                if not isinstance(items, list) or len(items) > 200:
                    raise ValueError("ZIP 清单中的文章列表无效")
                declared_paths = [
                    item.get("file") if isinstance(item, dict) else None for item in items
                ]
                if any(not isinstance(name, str) for name in declared_paths):
                    raise ValueError("ZIP 清单存在无效的文章路径")
                names = [name for name in declared_paths if isinstance(name, str)]
                if len(names) != len(set(names)):
                    raise ValueError("ZIP 清单存在无效或重复的文章路径")
            for name in names:
                if (
                    not isinstance(name, str)
                    or not name.lower().endswith((".md", ".markdown"))
                    or name.startswith("__MACOSX/")
                ):
                    continue
                info = archive.getinfo(name)
                if info.file_size > MAX_ARTICLE:
                    raise ValueError("单篇 Markdown 不能超过 2 MiB")
                expanded += info.file_size
                if expanded > MAX_EXPANDED:
                    raise ValueError("ZIP 展开后的 Markdown 总量不能超过 50 MiB")
                entries.append((f"{filename}/{name}", archive.read(info)))
    if not entries or len(entries) > 200 or expanded > MAX_EXPANDED:
        raise ValueError("请选择 1–200 篇 Markdown，总量最多 50 MiB")
    if len({path for path, _ in entries}) != len(entries):
        raise ValueError("存在同名文件，请分别导入")
    return entries


def parse_import(session: Session, files: list[tuple[str, bytes]]) -> list[ParsedArticle]:
    """逐篇给出可导入或冲突原因；预览不创建任何数据库记录。"""
    try:
        entries = markdown_entries(files)
    except (ValueError, BadZipFile, KeyError, RuntimeError, NotImplementedError):
        raise HTTPException(
            400, "文件或 ZIP 无法解析，请检查格式、清单、路径、加密及大小限制。"
        ) from None
    occupied = set(session.scalars(select(BlogPost.slug)))
    output: list[ParsedArticle] = []
    for path, content in entries:
        preview = ImportPreviewItem(path=path, title=PurePosixPath(path).stem[:200], slug="")
        parsed = ParsedArticle(preview, None, [])
        try:
            if len(content) > MAX_ARTICLE:
                raise ValueError("单篇 Markdown 不能超过 2 MiB")
            metadata, body = split_front_matter(content.decode("utf-8-sig"))
            if metadata.get("genesis_export_version", 1) != 1:
                raise ValueError("不支持这个 Genesis 导出版本")
            title = metadata.get("title") or next(
                iter(re.findall(r"^#\s+(.+)$", body, re.MULTILINE)), preview.title
            )
            slug = metadata.get("slug") or slug_for(PurePosixPath(path).stem, path)
            categories = taxonomy(metadata.get("categories") or metadata.get("category"))
            tags = taxonomy(metadata.get("tags"))
            data = BlogPostWrite.model_validate(
                {
                    "slug": slug,
                    "title": title,
                    "excerpt": metadata.get("excerpt")
                    or re.sub(r"[#*`>\[\]]", "", body).strip()[:160],
                    "content_markdown": body,
                    "cover_image_url": metadata.get("cover_image_url"),
                    "tags": [tag.model_dump() for tag in tags],
                    "read_time_minutes": metadata.get("read_time_minutes", 1),
                    "status": "draft",
                }
            )
            preview.title, preview.slug = data.title, data.slug
            preview.categories = [item.name for item in categories]
            preview.tags = [item.name for item in tags]
            if data.slug in occupied:
                preview.issue = "同路径文章已存在或在回收站，本次不会覆盖"
            else:
                occupied.add(data.slug)
            parsed.data, parsed.categories = data, categories
        except (ValueError, UnicodeError, yaml.YAMLError, RecursionError):
            preview.issue = (
                "正文编码或元数据无效，请检查 UTF-8、标题/路径、分类、标签及 front matter"
            )
        output.append(parsed)
    return output


def commit_import(
    session: Session,
    owner: User,
    operation_id: UUID,
    files: list[tuple[str, bytes]],
    paths: list[str],
) -> BlogOperationResult:
    """重新解析所选文件并创建草稿，重复请求只返回原回执。"""
    digest = operation_digest(
        {
            "files": [(name, hashlib.sha256(content).hexdigest()) for name, content in files],
            "paths": sorted(paths),
        }
    )
    previous = previous_operation(session, owner, operation_id, "import", digest)
    if previous is not None:
        return previous
    parsed = parse_import(session, files)
    if not paths or len(paths) > 200 or len(set(paths)) != len(paths):
        raise HTTPException(400, "请选择 1–200 篇文章，不能重复选择。")
    if not set(paths).issubset(item.preview.path for item in parsed):
        raise HTTPException(400, "所选文章不在当前文件中，请重新预览。")
    ids: list[UUID] = []
    skipped: list[str] = []
    for item in parsed:
        if item.preview.path not in paths:
            continue
        if item.preview.issue or item.data is None:
            skipped.append(f"{item.preview.path}：{item.preview.issue}")
            continue
        categories = []
        for value in item.categories:
            category = session.scalar(select(BlogCategory).where(BlogCategory.slug == value.slug))
            if category is None:
                category = session.scalar(
                    select(BlogCategory).where(BlogCategory.name == value.name)
                )
            if category is None:
                category = BlogCategory(id=uuid4(), **value.model_dump())
                session.add(category)
                session.flush()
            categories.append(category.id)
        safe_tags: list[BlogTagWrite] = []
        for value in item.data.tags:
            existing = session.scalar(select(BlogTag).where(BlogTag.slug == value.slug))
            if existing is None:
                existing = session.scalar(select(BlogTag).where(BlogTag.name == value.name))
            safe_tags.append(
                BlogTagWrite(name=existing.name, slug=existing.slug) if existing else value
            )
        data = item.data.model_copy(
            update={"category_ids": list(dict.fromkeys(categories)), "tags": safe_tags}
        )
        post = BlogPost(id=uuid4(), author=owner)
        session.add(post)
        with session.no_autoflush:
            apply_post_data(session, post, data)
        session.flush()
        ids.append(post.id)
    return save_operation(
        session,
        owner,
        "import",
        digest,
        BlogOperationResult(
            operation_id=operation_id,
            affected_ids=ids,
            skipped=skipped,
        ),
    )
