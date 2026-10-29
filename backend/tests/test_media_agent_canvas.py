"""验证真实身份隔离、图片目录查询及批量参数方案不提交生成。"""

import asyncio
from collections.abc import Iterator
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.agent.context import agent_invocation_context
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole
from genesis_api.media import image
from genesis_api.media.agent import tools as media_tools
from genesis_api.media.models import MediaProject
from genesis_api.media.schemas import CanvasDocument

type CanvasTools = tuple[UUID, UUID, list[UUID], sessionmaker[Session]]


@pytest.fixture
def canvas_tools(monkeypatch: pytest.MonkeyPatch) -> Iterator[CanvasTools]:
    """创建成员拥有的五个生图节点，复用实际数据库归属查询。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(media_tools, "SessionLocal", sessions)
    monkeypatch.setattr(
        image,
        "available_models",
        AsyncMock(
            return_value=[
                {"id": "image2.5-flare", "image_edit": True},
            ]
        ),
    )
    ids = [uuid4() for _ in range(5)]
    with Session(engine) as session:
        user = User(handle="canvas-member", display_name="测试成员", role=UserRole.MEMBER)
        session.add(user)
        session.flush()
        project = MediaProject(
            owner_id=user.id,
            name="烧烤",
            canvas={
                "nodes": [
                    {
                        "id": str(node_id),
                        "type": "image_generation",
                        "name": str(index),
                        "text": "原提示词",
                        "x": index * 760,
                        "y": 0,
                        "width": 640,
                        "height": 402,
                    }
                    for index, node_id in enumerate(ids)
                ]
            },
        )
        session.add(project)
        session.commit()
        actor_id, project_id = user.id, project.id
    yield actor_id, project_id, ids, sessions
    engine.dispose()


def test_member_reads_all_and_prepares_five_updates(
    canvas_tools: CanvasTools,
) -> None:
    actor_id, project_id, ids, _ = canvas_tools
    entries = {entry.name: entry for entry in media_tools.build_media_tools(Settings())}
    with agent_invocation_context(actor_id, "member", "media"):
        canvas = asyncio.run(entries["get_media_canvas"].ainvoke({"project_id": str(project_id)}))
        assert {node["id"] for node in canvas["nodes"]} == set(map(str, ids))
        models = asyncio.run(
            entries["get_image_generation_models"].ainvoke({"query": "Image 2.5 Flare"})
        )
        assert models["models"][0]["id"] == "image2.5-flare"
        plan = asyncio.run(
            entries["configure_image_nodes"].ainvoke(
                {
                    "project_id": str(project_id),
                    "model_id": "image2.5-flare",
                    "image_ratio": "16:9",
                    "image_resolution": "1K",
                }
            )
        )
        assert len(plan["operations"]) == 5
        assert plan["version"] == canvas["version"]
        assert plan["operations"][0]["generation"] == {
            "model": "image2.5-flare",
            "image_ratio": "16:9",
            "image_resolution": "1K",
        }
        after = asyncio.run(entries["get_media_canvas"].ainvoke({"project_id": str(project_id)}))
        assert after == canvas


def test_other_user_cannot_read_or_prepare(canvas_tools: CanvasTools) -> None:
    _, project_id, _, _ = canvas_tools
    entries = {entry.name: entry for entry in media_tools.build_media_tools(Settings())}
    with agent_invocation_context(uuid4(), "member", "media"):
        assert (
            asyncio.run(entries["get_media_canvas"].ainvoke({"project_id": str(project_id)}))
            == "作品不存在"
        )
        assert (
            asyncio.run(
                entries["configure_image_nodes"].ainvoke(
                    {
                        "project_id": str(project_id),
                        "model_id": "image2.5-flare",
                        "image_ratio": "16:9",
                        "image_resolution": "1K",
                    }
                )
            )
            == "作品不存在"
        )


def test_configuration_checks_actual_references_instead_of_legacy_mode(
    canvas_tools: CanvasTools, monkeypatch: pytest.MonkeyPatch
) -> None:
    actor_id, project_id, ids, sessions = canvas_tools
    monkeypatch.setattr(
        image,
        "available_models",
        AsyncMock(return_value=[{"id": "image2.5-flare", "image_edit": False}]),
    )
    entries = {entry.name: entry for entry in media_tools.build_media_tools(Settings())}
    args = {
        "project_id": str(project_id),
        "model_id": "image2.5-flare",
        "image_ratio": "16:9",
        "image_resolution": "1K",
    }
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None
        document = CanvasDocument.model_validate(project.canvas)
        document.nodes[0].generation.mode = "reference"
        project.canvas = document.model_dump(mode="json")
        session.commit()
    with agent_invocation_context(actor_id, "member", "media"):
        assert isinstance(asyncio.run(entries["configure_image_nodes"].ainvoke(args)), dict)
        with sessions() as session:
            project = session.get(MediaProject, project_id)
            assert project is not None
            project.canvas = {
                **project.canvas,
                "edges": [{"id": str(uuid4()), "source": str(ids[0]), "target": str(ids[1])}],
            }
            session.commit()
        canvas = asyncio.run(entries["get_media_canvas"].ainvoke({"project_id": str(project_id)}))
        assert canvas["image_reference_node_ids"] == [str(ids[1])]
        assert "尚无图生图支持说明" in asyncio.run(entries["configure_image_nodes"].ainvoke(args))


def test_missing_node_and_model_are_rejected(canvas_tools: CanvasTools) -> None:
    actor_id, project_id, _, _ = canvas_tools
    entry = next(
        tool
        for tool in media_tools.build_media_tools(Settings())
        if tool.name == "configure_image_nodes"
    )
    args = {
        "project_id": str(project_id),
        "model_id": "image2.5-flare",
        "image_ratio": "16:9",
        "image_resolution": "1K",
    }
    with agent_invocation_context(actor_id, "member", "media"):
        assert "节点缺失" in asyncio.run(entry.ainvoke({**args, "node_ids": [str(uuid4())]}))
        assert "模型当前不可用" in asyncio.run(entry.ainvoke({**args, "model_id": "fake-model"}))
    assert "有效的业务用户身份" in asyncio.run(entry.ainvoke(args))
