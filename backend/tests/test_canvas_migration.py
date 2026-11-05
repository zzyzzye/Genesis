"""验证历史内嵌视频无损拆分与重复读取幂等。"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from genesis_api.api.routes.media import canvas
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole
from genesis_api.media.canvas_migration import detach_legacy_video_results
from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset, VideoGeneration
from genesis_api.media.schemas import CanvasDocument, CanvasEdge, CanvasNode, GenerationResult


@pytest.fixture
def legacy() -> Generator[
    tuple[Session, MediaProject, CanvasDocument, VideoGeneration], None, None
]:
    """构造带下游引用和已完成视频的旧画布。"""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(id=uuid4(), handle="legacy-test", display_name="迁移测试", role=UserRole.MEMBER)
        asset = MediaAsset(
            id=uuid4(),
            owner_id=user.id,
            name="已有成品",
            kind="video",
            mime_type="video/mp4",
            size=100,
        )
        source = CanvasNode(
            id=uuid4(),
            type="video",
            asset_id=asset.id,
            name="镜头草稿",
            text="保留提示词",
            x=100,
            y=100,
            width=673,
            height=285,
        )
        target = CanvasNode(
            id=uuid4(),
            type="video",
            text=f"参考[成品](ref:{source.id})",
            x=900,
            y=100,
            width=600,
            height=378,
        )
        document = CanvasDocument(
            nodes=[source, target],
            edges=[CanvasEdge(id=uuid4(), source=source.id, target=target.id)],
        )
        project = MediaProject(
            id=uuid4(), owner_id=user.id, name="旧作品", canvas=document.model_dump(mode="json")
        )
        task = VideoGeneration(
            id=uuid4(),
            owner_id=user.id,
            project_id=project.id,
            node_id=source.id,
            snapshot={},
            status="completed",
            asset_id=asset.id,
        )
        session.add_all(
            [user, asset, project, task, ProjectAsset(project_id=project.id, asset_id=asset.id)]
        )
        session.commit()
        yield session, project, document, task
    engine.dispose()


def test_migration_preserves_draft_and_reconnects_result(
    legacy: tuple[Session, MediaProject, CanvasDocument, VideoGeneration],
) -> None:
    session, project, document, task = legacy
    changed = detach_legacy_video_results(session, project, document)
    source, target, result = changed.nodes
    assert source.asset_id is None and source.text == "保留提示词"
    assert (source.x, source.y, source.width, source.height) == (100, 100, 673, 285)
    assert source.generation == document.nodes[0].generation
    assert changed.viewport == document.viewport
    assert result.type == "video_asset" and result.asset_id == task.asset_id
    assert result.video_result and result.video_result.task_id == task.id
    assert changed.edges[0].id == document.edges[0].id
    assert changed.edges[0].source == result.id and changed.edges[0].target == target.id
    assert target.text == f"参考[成品](ref:{result.id})"
    assert changed.edges[-1].source == source.id and changed.edges[-1].target == result.id
    assert detach_legacy_video_results(session, project, changed) is changed
    assert task.status == "completed"


def test_migration_reuses_existing_result(
    legacy: tuple[Session, MediaProject, CanvasDocument, VideoGeneration],
) -> None:
    session, project, document, task = legacy
    result = CanvasNode(
        id=uuid4(),
        type="video_asset",
        asset_id=task.asset_id,
        x=1700,
        y=0,
        width=360,
        height=203,
        video_result=GenerationResult(task_id=task.id, index=0, status="completed"),
    )
    document.nodes.append(result)
    changed = detach_legacy_video_results(session, project, document)
    assert len(changed.nodes) == 3 and changed.nodes[-1].id == result.id


def test_migration_does_not_split_uploaded_preview(
    legacy: tuple[Session, MediaProject, CanvasDocument, VideoGeneration],
) -> None:
    session, project, document, task = legacy
    task.status = "processing"
    session.commit()
    assert detach_legacy_video_results(session, project, document) is document


def test_canvas_read_persists_migration_once(
    legacy: tuple[Session, MediaProject, CanvasDocument, VideoGeneration],
) -> None:
    """真实读取入口一次保存迁移版本，重开不新增节点或增加版本。"""
    session, project, _, _ = legacy
    user = session.get(User, project.owner_id)
    assert user is not None
    version = project.version
    first = canvas(project.id, user, session)
    session.expire_all()
    second = canvas(project.id, user, session)
    assert first == second and second["version"] == version + 1
    assert len(CanvasDocument.model_validate(second["document"]).nodes) == 3


@pytest.mark.parametrize("already_linked", [False, True])
def test_canvas_restores_uploaded_image_as_reference(
    legacy: tuple[Session, MediaProject, CanvasDocument, VideoGeneration],
    already_linked: bool,
) -> None:
    """旧图片预览恢复为连入参考，复用已有图，不误改原来的输出连线。"""
    session, project, document, task = legacy
    asset = session.get(MediaAsset, task.asset_id)
    assert asset is not None
    asset.kind = "image"
    asset.mime_type = "image/png"
    task.status = "processing"
    source = document.nodes[0]
    if already_linked:
        image = CanvasNode(
            id=uuid4(),
            type="image",
            asset_id=asset.id,
            x=-400,
            y=0,
            width=360,
            height=280,
        )
        document.nodes.append(image)
        document.edges.append(CanvasEdge(id=uuid4(), source=image.id, target=source.id))
    project.canvas = document.model_dump(mode="json")
    session.commit()
    user = session.get(User, project.owner_id)
    assert user is not None
    first = canvas(project.id, user, session)
    changed = CanvasDocument.model_validate(first["document"])
    assert len(changed.nodes) == 3 and len(changed.edges) == 2
    generator = changed.nodes[0]
    assert generator.asset_id is None and generator.text == source.text
    assert generator.generation.mode == "reference"
    assert changed.viewport == document.viewport
    assert changed.edges[0] == document.edges[0]
    reference = changed.nodes[-1]
    assert reference.type == "image" and reference.asset_id == asset.id
    assert changed.edges[-1].source == reference.id and changed.edges[-1].target == generator.id
    session.expire_all()
    assert canvas(project.id, user, session) == first
