"""所有者专用导入和批量文章管理，统一回滚失败事务。"""

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from genesis_api.api.dependencies import OwnerDependency, SessionDependency
from genesis_api.blog.importing import MAX_UPLOAD, ImportPreview, commit_import, parse_import
from genesis_api.blog.operations import BlogBatchWrite, BlogOperationResult, apply_batch

router = APIRouter(prefix="/admin/blog/posts", tags=["博客管理"])


async def read_files(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    """限制整个请求为 20 MiB，关闭上传临时文件，不信任声明大小。"""
    result: list[tuple[str, bytes]] = []
    size = 0
    try:
        if not 1 <= len(files) <= 20:
            raise HTTPException(400, "一次请选择 1–20 个 Markdown 或 ZIP 文件。")
        for item in files:
            content = await item.read(MAX_UPLOAD - size + 1)
            size += len(content)
            if size > MAX_UPLOAD:
                raise HTTPException(413, "上传文件总量不能超过 20 MiB。")
            name = (item.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
            if not name or len(name) > 255:
                raise HTTPException(400, "文件名无效或过长。")
            result.append((name, content))
        return result
    finally:
        for item in files:
            await item.close()


@router.post("/import/preview", response_model=ImportPreview)
async def preview_articles(
    session: SessionDependency,
    _: OwnerDependency,
    files: Annotated[list[UploadFile], File()],
) -> ImportPreview:
    """仅解析上传内容并报告冲突，绝不发布或覆盖文章。"""
    content = await read_files(files)
    parsed = await run_in_threadpool(parse_import, session, content)
    return ImportPreview(items=[item.preview for item in parsed])


@router.post("/import", response_model=BlogOperationResult)
async def import_articles(
    session: SessionDependency,
    owner: OwnerDependency,
    files: Annotated[list[UploadFile], File()],
    operation_id: Annotated[UUID, Form()],
    paths: Annotated[str, Form(max_length=150000)],
) -> BlogOperationResult:
    """确认所选条目后创建草稿；同一标识可安全重试核对回执。"""
    content = await read_files(files)
    try:
        selected = json.loads(paths)
        if not isinstance(selected, list) or not all(isinstance(item, str) for item in selected):
            raise HTTPException(400, "所选文章列表格式无效。")
        return await run_in_threadpool(
            commit_import, session, owner, operation_id, content, selected
        )
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            409, "导入时文章或分类标签已变化，本次未提交，请重新预览后重试。"
        ) from None
    except json.JSONDecodeError:
        raise HTTPException(400, "所选文章列表格式无效。") from None
    except Exception:
        session.rollback()
        raise


@router.post("/bulk", response_model=BlogOperationResult)
def batch_articles(
    data: BlogBatchWrite, session: SessionDependency, owner: OwnerDependency
) -> BlogOperationResult:
    """全部条目验证成功后一起提交；失败保留原内容，不产生部分发布。"""
    try:
        return apply_batch(session, owner, data)
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "文章或分类标签已变化，本次未提交，请刷新后重新选择。") from None
    except ValueError as error:
        session.rollback()
        raise HTTPException(400, str(error)) from None
    except Exception:
        session.rollback()
        raise
