"""文字引用使用真实画布与两种生成准备流程，不调用付费模型。"""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from genesis_api.blog import models as blog_models  # noqa: F401
from genesis_api.core.config import Settings
from genesis_api.media import image, video
from genesis_api.media.models import ImageGeneration, VideoGeneration
from genesis_api.media.prompt_references import resolve_text_mentions
from genesis_api.media.schemas import CanvasDocument, CanvasEdge, CanvasNode, GenerationSettings


def canvas() -> CanvasDocument:
    """构造一个文字来源与一个生成节点。"""
    source = CanvasNode(
        id=uuid4(), type="text", name="人物设定", text="白衬衫\n自然光",
        x=0, y=0, width=300, height=180,
    )
    target = CanvasNode(
        id=uuid4(), type="image_generation", text=f"开场：@[文字](ref:{source.id})。",
        generation=GenerationSettings(model="gpt-image-2"),
        x=400, y=0, width=300, height=180,
    )
    return CanvasDocument(nodes=[source, target], edges=[
        CanvasEdge(id=uuid4(), source=source.id, target=target.id),
    ])


@pytest.mark.parametrize("kind", ["image", "video"])
def test_generation_resolves_latest_text_without_mutating_canvas(kind: str) -> None:
    """实际准备流程使用最新文字，旧请求不变且不上传额外参考文件。"""
    document = canvas()
    source, target = document.nodes
    target.type = "image_generation" if kind == "image" else "video"
    original = target.text
    task_type = ImageGeneration if kind == "image" else VideoGeneration
    task = task_type(
        id=uuid4(), owner_id=uuid4(), project_id=uuid4(), node_id=target.id, snapshot={},
    )
    with Session() as session:
        def prepare() -> str:
            if isinstance(task, ImageGeneration):
                return image.prepare(task, document, session).text
            payload = video.build_payload(task, document, session, Settings())
            assert "image_urls" not in payload
            return str(payload["prompt"])

        first = prepare()
        assert first == "开场：白衬衫\n自然光。"
        frozen = dict(task.snapshot)
        source.text = "黑外套\n夜景"
        assert task.snapshot == frozen
        assert prepare() == "开场：黑外套\n夜景。"
        assert first == "开场：白衬衫\n自然光。"
        assert task.reference_ids == []
        assert target.text == original
        # 连线只提供候选，不会自动插入最新文字。
        target.text = "没有引用的独立提示词"
        assert prepare() == target.text


@pytest.mark.parametrize("failure", [
    "disconnect", "deleted", "wrong_type", "empty", "nested", "image", "overflow",
])
@pytest.mark.parametrize("kind", ["image", "video"])
def test_invalid_text_reference_blocks_both_generation_paths(failure: str, kind: str) -> None:
    """断线、空内容和嵌套素材标记不能静默降级或绕过授权。"""
    document = canvas()
    source, target = document.nodes
    target.type = "image_generation" if kind == "image" else "video"
    if failure == "disconnect":
        document.edges = []
    elif failure == "deleted":
        document.nodes.remove(source)
    elif failure == "wrong_type":
        source.type = "note"
    elif failure == "empty":
        source.text = " \n "
    elif failure in ("nested", "image"):
        source.text = f"@[{'文字' if failure == 'nested' else '图片'}](ref:{target.id})"
    else:
        source.text = "文" * 20000
    with Session() as session, pytest.raises(HTTPException) as caught:
        if kind == "image":
            image.prepare(ImageGeneration(node_id=target.id), document, session)
        else:
            video.build_payload(VideoGeneration(node_id=target.id), document, session, Settings())
    assert caught.value.status_code == 422


def test_text_order_repeats_and_indirect_connections() -> None:
    """按提示词位置展开；环形与间接连线不会递归引入内容。"""
    document = canvas()
    source, target = document.nodes
    token = f"@[文字](ref:{source.id})"
    assert resolve_text_mentions(f"{token} / {token}", document, target.id) == (
        f"{source.text} / {source.text}"
    )
    document.edges = [CanvasEdge(id=uuid4(), source=target.id, target=source.id)]
    with pytest.raises(HTTPException, match="文字引用已断开"):
        resolve_text_mentions(token, document, target.id)
