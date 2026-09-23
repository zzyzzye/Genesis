from collections.abc import AsyncGenerator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes.media import router
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole
from genesis_api.media import service


@pytest.fixture
async def media_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[AsyncClient, None]:
    monkeypatch.setattr(service, "STORAGE_ROOT", tmp_path)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with Session(engine) as session:
        user = User(handle="media-test", display_name="测试", role=UserRole.MEMBER)
        session.add(user)
        session.commit()
        app.dependency_overrides[get_session] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: user
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test/api/v1/media"
        ) as client:
            yield client
    engine.dispose()


@pytest.mark.anyio
async def test_project_asset_lifecycle(media_client: AsyncClient) -> None:
    c = media_client
    assert (await c.get("health")).status_code == 200
    assert (await c.get("projects")).json() == []
    p = (await c.post("projects", json={"name": "作品一"})).json()["id"]
    assert (await c.patch(f"projects/{p}", json={"name": "改名"})).json()["name"] == "改名"
    assert len((await c.get("projects?q=改名")).json()) == 1
    uploaded = await c.post(
        f"projects/{p}/assets", files={"file": ("test.png", b"image-bytes", "image/png")}
    )
    assert uploaded.status_code == 201
    a = uploaded.json()["id"]
    assert (await c.get("assets")).json()["total"] == 0
    assert (await c.get(f"projects/{p}/assets?kind=image&q=test")).json()["total"] == 1
    assert (await c.get(f"assets/{a}")).json()["in_library"] is False
    assert (await c.get(f"assets/{a}/file")).content == b"image-bytes"
    assert (await c.get(f"assets/{a}/file", headers={"Range": "bytes=0-4"})).content == b"image"
    doc = {
        "nodes": [
            {
                "id": str(uuid4()),
                "type": "asset",
                "asset_id": a,
                "x": 0,
                "y": 0,
                "width": 300,
                "height": 200,
            }
        ],
        "viewport": {"x": 10, "y": 20, "zoom": 1},
    }
    assert (await c.put(f"projects/{p}/canvas", json={"version": 0, "document": doc})).json()[
        "version"
    ] == 1
    assert (
        await c.put(f"projects/{p}/canvas", json={"version": 0, "document": doc})
    ).status_code == 409
    assert (await c.get(f"projects/{p}/canvas")).json()["document"]["nodes"][0]["asset_id"] == a
    assert (await c.delete(f"assets/{a}")).status_code == 409
    assert (await c.post(f"assets/{a}/library")).json()["in_library"] is True
    p2 = (await c.post("projects", json={"name": "作品二"})).json()["id"]
    assert (
        await c.post(f"projects/{p2}/assets/reference", json={"asset_id": a})
    ).status_code == 200
    assert (
        await c.post(f"projects/{p2}/assets/reference", json={"asset_id": a})
    ).status_code == 200
    assert (await c.delete(f"projects/{p}/assets/{a}")).json()["document"]["nodes"] == []
    assert (await c.delete(f"projects/{p}")).status_code == 204
    assert (await c.get(f"assets/{a}/file")).status_code == 200
    assert (await c.delete(f"assets/{a}")).status_code == 409
    assert (await c.delete(f"projects/{p2}")).status_code == 204
    assert (await c.delete(f"assets/{a}")).status_code == 204
    assert (await c.get(f"assets/{a}")).status_code == 404


@pytest.mark.anyio
async def test_invalid_upload_and_canvas(
    media_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = media_client
    p = (await c.post("projects", json={"name": "校验"})).json()["id"]
    assert (await c.post("projects", json={"name": " "})).status_code == 422
    assert (
        await c.post("assets", files={"file": ("bad.svg", b"<svg/>", "image/svg+xml")})
    ).status_code == 415
    assert (
        await c.post("assets", files={"file": ("empty.png", b"", "image/png")})
    ).status_code == 422
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 4)
    assert (
        await c.post("assets", files={"file": ("large.png", b"12345", "image/png")})
    ).status_code == 413
    assert list(service.STORAGE_ROOT.iterdir()) == []
    node = {
        "id": str(uuid4()),
        "type": "asset",
        "asset_id": str(uuid4()),
        "x": 0,
        "y": 0,
        "width": 300,
        "height": 200,
    }
    assert (
        await c.put(f"projects/{p}/canvas", json={"version": 0, "document": {"nodes": [node]}})
    ).status_code == 422
    node["type"] = "note"
    assert (
        await c.put(
            f"projects/{p}/canvas", json={"version": 0, "document": {"nodes": [node, node]}}
        )
    ).status_code == 422
    nodes = [
        {**node, "id": str(uuid4()), "type": kind, "asset_id": None, "text": kind}
        for kind in ("text", "shape")
    ]
    saved = await c.put(
        f"projects/{p}/canvas", json={"version": 0, "document": {"nodes": nodes}}
    )
    assert saved.status_code == 200
    assert [item["type"] for item in saved.json()["document"]["nodes"]] == ["text", "shape"]
    edge = {"id": str(uuid4()), "source": nodes[0]["id"], "target": nodes[1]["id"]}
    assert (
        await c.put(
            f"projects/{p}/canvas",
            json={"version": 1, "document": {"nodes": nodes, "edges": [edge]}},
        )
    ).status_code == 200
    assert (
        await c.put(
            f"projects/{p}/canvas",
            json={"version": 2, "document": {"nodes": nodes, "edges": [edge, edge]}},
        )
    ).status_code == 422
    for invalid in ({**edge, "target": str(uuid4())}, {**edge, "target": edge["source"]}):
        assert (
            await c.put(
                f"projects/{p}/canvas",
                json={"version": 2, "document": {"nodes": nodes, "edges": [invalid]}},
            )
        ).status_code == 422
    assert (await c.get(f"projects/{uuid4()}")).status_code == 404
    assert (await c.get(f"assets/{uuid4()}/file")).status_code == 404


@pytest.mark.anyio
async def test_remove_asset_cleans_connected_edges(media_client: AsyncClient) -> None:
    c = media_client
    project_id = (await c.post("projects", json={"name": "连线清理"})).json()["id"]
    asset_id = (
        await c.post(
            f"projects/{project_id}/assets",
            files={"file": ("frame.png", b"image-bytes", "image/png")},
        )
    ).json()["id"]
    media_node = str(uuid4())
    text_node = str(uuid4())
    group_id = str(uuid4())
    document = {
        "nodes": [
            {
                "id": media_node,
                "type": "asset",
                "asset_id": asset_id,
                "x": 0,
                "y": 0,
                "width": 300,
                "height": 200,
            },
            {"id": text_node, "type": "text", "x": 400, "y": 0, "width": 300, "height": 200},
            {"id": group_id, "type": "group", "member_ids": [media_node, text_node],
             "x": -20, "y": -40, "width": 750, "height": 280},
        ],
        "edges": [{"id": str(uuid4()), "source": text_node, "target": media_node}],
    }
    assert (
        await c.put(
            f"projects/{project_id}/canvas", json={"version": 0, "document": document}
        )
    ).status_code == 200
    result = await c.delete(f"projects/{project_id}/assets/{asset_id}")
    assert result.status_code == 200
    assert [node["id"] for node in result.json()["document"]["nodes"]] == [text_node]
    assert result.json()["document"]["edges"] == []


@pytest.mark.anyio
async def test_canvas_groups_and_background_are_validated(media_client: AsyncClient) -> None:
    c = media_client
    project_id = (await c.post("projects", json={"name": "画布分组"})).json()["id"]
    nodes = [
        {"id": str(uuid4()), "type": "note", "x": index * 300, "y": 0, "width": 200, "height": 120}
        for index in range(2)
    ]
    group = {
        "id": str(uuid4()), "type": "group", "member_ids": [node["id"] for node in nodes],
        "x": -20, "y": -30, "width": 550, "height": 180,
    }
    endpoint = f"projects/{project_id}/canvas"
    result = await c.put(endpoint, json={"version": 0, "document": {
        "nodes": [group, *nodes], "background": "lines",
    }})
    assert result.status_code == 200
    assert result.json()["document"]["background"] == "lines"
    invalid_group = {**group, "member_ids": [nodes[0]["id"], str(uuid4())]}
    assert (await c.put(endpoint, json={"version": 1, "document": {
        "nodes": [invalid_group, *nodes],
    }})).status_code == 422
    assert (await c.put(endpoint, json={"version": 1, "document": {
        "nodes": [group, *nodes], "edges": [{
            "id": str(uuid4()), "source": group["id"], "target": nodes[0]["id"],
        }],
    }})).status_code == 422


@pytest.mark.anyio
async def test_private_asset_references_and_cleanup(media_client: AsyncClient) -> None:
    c = media_client
    p = (await c.post("projects", json={"name": "原作"})).json()["id"]
    target = (await c.post("projects", json={"name": "副本"})).json()["id"]
    a = (
        await c.post(f"projects/{p}/assets", files={"file": ("sound.wav", b"wave", "audio/wav")})
    ).json()["id"]
    assert (
        await c.post(f"projects/{target}/assets/reference", json={"asset_id": a})
    ).status_code == 404
    assert (
        await c.post(f"projects/{p}/copy-assets/{target}", json={"asset_ids": [a]})
    ).status_code == 204
    assert (
        await c.post(f"projects/{p}/copy-assets/{target}", json={"asset_ids": [a]})
    ).status_code == 204
    assert (
        await c.post(f"projects/{p}/copy-assets/{target}", json={"asset_ids": [str(uuid4())]})
    ).status_code == 409
    assert (await c.delete(f"projects/{p}")).status_code == 204
    assert (await c.get(f"assets/{a}/file")).status_code == 200
    (service.STORAGE_ROOT / a).unlink()
    assert (await c.get(f"assets/{a}/file")).status_code == 404
    assert (await c.delete(f"projects/{target}/assets/{a}")).status_code == 200
    assert (await c.get(f"assets/{a}")).status_code == 404


@pytest.mark.anyio
async def test_cross_account_isolation(media_client: AsyncClient) -> None:
    c = media_client
    p = (await c.post("projects", json={"name": "私有作品"})).json()["id"]
    a = (await c.post("assets", files={"file": ("photo.png", b"image", "image/png")})).json()["id"]
    app = c._transport.app  # type: ignore[attr-defined]
    session = app.dependency_overrides[get_session]()
    other = User(handle="another", display_name="另一账户", role=UserRole.MEMBER)
    session.add(other)
    session.commit()
    app.dependency_overrides[get_current_user] = lambda: other
    assert (await c.get("projects")).json() == []
    assert (await c.get("assets")).json()["total"] == 0
    for route in [
        f"projects/{p}",
        f"projects/{p}/canvas",
        f"projects/{p}/assets",
        f"assets/{a}",
        f"assets/{a}/file",
    ]:
        assert (await c.get(route)).status_code == 404
    assert (await c.post(f"assets/{a}/library")).status_code == 404
    assert (await c.delete(f"projects/{p}")).status_code == 404
    assert (await c.delete(f"assets/{a}")).status_code == 404
