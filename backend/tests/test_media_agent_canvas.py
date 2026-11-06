"""验证真实身份隔离、图片目录查询及批量参数方案不提交生成。"""

import asyncio
import json
from collections.abc import Iterator
from copy import deepcopy
from typing import cast
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from langchain_core.messages import ToolMessage
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from genesis_api.agent.context import agent_invocation_context
from genesis_api.core.config import Settings
from genesis_api.database.base import Base
from genesis_api.identity.models import User, UserRole
from genesis_api.media import image
from genesis_api.media.agent import tools as media_tools
from genesis_api.media.models import MediaAsset, MediaProject, ProjectAsset
from genesis_api.media.schemas import CanvasDocument

type CanvasTools = tuple[UUID, UUID, list[UUID], sessionmaker[Session]]


def test_asset_tools_link_only_owned_library_assets(canvas_tools: CanvasTools) -> None:
    """账户素材可幂等关联；其他作品私有素材及无身份调用均被拒绝。"""
    actor, project_id, _, sessions = canvas_tools
    ids = [uuid4(), uuid4()]
    with sessions() as session:
        for index, asset_id in enumerate(ids):
            session.add(MediaAsset(id=asset_id, owner_id=actor, name=f"参考{index}.png",
                                   kind="image", mime_type="image/png", size=4,
                                   in_library=index == 0))
        session.commit()
    tools = {entry.name: entry for entry in media_tools.build_media_tools(Settings())}
    args = {"project_id": str(project_id), "asset_id": str(ids[0])}
    with agent_invocation_context(actor, "member", "media"):
        listed = asyncio.run(tools["get_media_assets"].ainvoke({"project_id": str(project_id)}))
        assert [item["id"] for item in listed["items"]] == [str(ids[0])]
        for _ in range(2):
            assert asyncio.run(tools["reference_media_asset"].ainvoke(args))["id"] == str(ids[0])
        assert "不在账户素材库" in asyncio.run(tools["reference_media_asset"].ainvoke(
            {**args, "asset_id": str(ids[1])},
        ))
    with sessions() as session:
        assert session.get(ProjectAsset, (project_id, ids[0])) is not None
        assert session.get(ProjectAsset, (project_id, ids[1])) is None
    assert "有效的业务用户身份" in asyncio.run(tools["reference_media_asset"].ainvoke(args))


def test_edit_canvas_validates_graph_version_and_supports_replay(canvas_tools: CanvasTools) -> None:
    """原生写入复用页面校验，覆盖副本、编组、布局、连线与引用的批量保存。"""
    actor, project_id, ids, sessions = canvas_tools
    tools = {entry.name: entry for entry in media_tools.build_media_tools(Settings())}
    with agent_invocation_context(actor, "member", "media"):
        snapshot = asyncio.run(tools["get_media_canvas"].ainvoke({"project_id": str(project_id)}))
        document = CanvasDocument.model_validate(snapshot).model_dump(mode="json")
        copy = deepcopy(document["nodes"][0])
        copy["id"] = str(uuid4())
        copy["name"] = "副本"
        copy["x"] = 200
        document["nodes"].append(copy)
        document["nodes"].append({
            "id": str(uuid4()), "type": "group", "x": 0, "y": 0,
            "width": 1200, "height": 600, "member_ids": [str(ids[0]), copy["id"]],
        })
        document["edges"] = [{"id": str(uuid4()), "source": str(ids[0]), "target": copy["id"]}]
        args = {"project_id": str(project_id), "expected_version": snapshot["version"],
                "document": document}
        result = asyncio.run(tools["edit_media_canvas"].ainvoke(args))
        assert result["version"] == snapshot["version"] + 1
        assert asyncio.run(tools["edit_media_canvas"].ainvoke(args))["version"] == result["version"]
        document["nodes"][0]["x"] = 999
        assert "其他窗口修改" in asyncio.run(tools["edit_media_canvas"].ainvoke(args))
        args["expected_version"] = result["version"]
        document["edges"][0]["source"] = str(uuid4())
        assert "连线必须连接" in asyncio.run(tools["edit_media_canvas"].ainvoke(args))
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None and project.version == result["version"]
    assert "有效的业务用户身份" in asyncio.run(tools["edit_media_canvas"].ainvoke(args))


@pytest.mark.parametrize(
    "node_type",
    [
        "note",
        "text",
        "shape",
        "group",
        "asset",
        "video",
        "image_generation",
        "audio_generation",
        "image",
        "audio",
        "video_asset",
    ],
)
def test_rename_node_saves_only_name_and_replay_is_idempotent(
    canvas_tools: CanvasTools,
    node_type: str,
) -> None:
    """真实工具直接保存所有类型的标题，重放不再次增加画布版本。"""
    actor_id, project_id, ids, sessions = canvas_tools
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None
        original = deepcopy(project.canvas)
        original_nodes = cast(list[dict[str, object]], original["nodes"])
        original_nodes[0]["type"] = node_type
        if node_type == "group":
            original_nodes[0]["member_ids"] = list(map(str, ids[1:3]))
        project.canvas = original
        session.commit()
    entry = next(t for t in media_tools.build_media_tools(Settings()) if t.name == "rename_node")
    args = {
        "project_id": str(project_id),
        "node_id": str(ids[0]),
        "name": "  开场空镜  ",
        "expected_version": 0,
    }
    with agent_invocation_context(actor_id, "member", "media"):
        message = asyncio.run(
            entry.ainvoke(
                {
                    "type": "tool_call",
                    "id": "rename",
                    "name": entry.name,
                    "args": args,
                }
            )
        )
        assert isinstance(message, ToolMessage) and message.status == "success"
        assert json.loads(str(message.content))["changed"] is True
        assert message.artifact["resource"]["kind"] == "canvas_node_rename"
        assert message.artifact["resource"]["scope_id"] == str(project_id)
        assert message.artifact["resource"]["parent_id"] == str(ids[0])
        replay = asyncio.run(entry.ainvoke(args))
        assert replay["changed"] is False and replay["version"] == 1
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None and project.version == 1
        expected = deepcopy(original)
        cast(list[dict[str, object]], expected["nodes"])[0]["name"] = "开场空镜"
        assert project.canvas == expected


@pytest.mark.parametrize("name", ["", "   ", "长" * 121])
def test_rename_rejects_empty_or_long_names(canvas_tools: CanvasTools, name: str) -> None:
    """无效输入不产生部分写入或版本变化。"""
    actor_id, project_id, ids, sessions = canvas_tools
    entry = next(t for t in media_tools.build_media_tools(Settings()) if t.name == "rename_node")
    with agent_invocation_context(actor_id, "member", "media"):
        result = asyncio.run(
            entry.ainvoke(
                {
                    "project_id": str(project_id),
                    "node_id": str(ids[0]),
                    "name": name,
                    "expected_version": 0,
                }
            )
        )
    assert result == "节点名称去掉首尾空白后须为 1–120 字符"
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None and project.version == 0


def test_rename_rejects_wrong_actor_missing_node_and_stale_version(
    canvas_tools: CanvasTools,
) -> None:
    """权限、归属、节点和版本均在服务端校验，不能用模型参数绕过。"""
    actor_id, project_id, ids, sessions = canvas_tools
    entry = next(t for t in media_tools.build_media_tools(Settings()) if t.name == "rename_node")
    args = {
        "project_id": str(project_id),
        "node_id": str(ids[0]),
        "name": "新名",
        "expected_version": 0,
    }
    assert "有效的业务用户身份" in asyncio.run(entry.ainvoke(args))
    with agent_invocation_context(actor_id, "member", "blog"):
        assert "有效的业务用户身份" in asyncio.run(entry.ainvoke(args))
    with agent_invocation_context(uuid4(), "member", "media"):
        assert asyncio.run(entry.ainvoke(args)) == "作品不存在"
    with agent_invocation_context(actor_id, "member", "media"):
        assert asyncio.run(entry.ainvoke({**args, "node_id": str(uuid4())})) == "节点不存在"
        assert "画布已更新" in asyncio.run(entry.ainvoke({**args, "expected_version": 9}))
        assert isinstance(asyncio.run(entry.ainvoke({**args, "expected_version": -1})), str)
    with sessions() as session:
        project = session.get(MediaProject, project_id)
        assert project is not None and project.version == 0


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
        assert canvas["image_generation_with_references_node_ids"] == [str(ids[1])]
        target = next(node for node in canvas["nodes"] if node["id"] == str(ids[1]))
        assert target["image_reference_node_ids"] == [str(ids[0])]
        assert target["reference_node_ids"] == [str(ids[0])]
        assert isinstance(asyncio.run(entries["configure_image_nodes"].ainvoke(args)), dict)


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
