"""验证任意文件、目录树、重试、权限和安全下载的完整生命周期。"""

from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes import blog_attachments as routes
from genesis_api.blog import attachments as storage
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole


@pytest.fixture
async def attachment_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncGenerator[tuple[AsyncClient, FastAPI, Session, User], None]:
    """隔离文件与数据库，用依赖覆盖切换作者、成员和匿名权限。"""
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(routes.admin_router, prefix="/api/v1")
    app.include_router(routes.public_router, prefix="/api/v1")
    with Session(engine) as session:
        owner = User(handle="attachment-test", display_name="测试作者", role=UserRole.OWNER)
        session.add(owner)
        session.commit()

        def db() -> Generator[Session, None, None]:
            try:
                yield session
            finally:
                session.rollback()

        app.dependency_overrides[get_session] = db
        app.dependency_overrides[get_current_user] = lambda: owner
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test/api/v1"
        ) as client:
            yield client, app, session, owner
    engine.dispose()


ADMIN = "/admin/blog/attachments"


async def folder(client: AsyncClient, name: str, parent: str | None = None) -> dict[str, Any]:
    """创建测试目录并检查标准回执。"""
    response = await client.post(
        ADMIN + "/folders", json={"id": str(uuid4()), "name": name, "parent_id": parent}
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


async def upload(
    client: AsyncClient,
    name: str = "data.unknown",
    content: bytes = b"test",
    *,
    path: str | None = None,
    parent: str | None = None,
    identifier: str | None = None,
    mime: str = "application/octet-stream",
) -> Any:
    """通过真实 multipart 解析上传，不绕过路由的实际大小校验。"""
    data = {"id": identifier or str(uuid4())}
    if path is not None:
        data["relative_path"] = path
    if parent:
        data["parent_id"] = parent
    return await client.post(ADMIN + "/files", data=data, files={"file": (name, content, mime)})


def update_data(item: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """携带明确版本，模拟用户从当前列表执行写入。"""
    return {
        "name": item["name"],
        "parent_id": item["parent_id"],
        "is_public": item["is_public"],
        "expected_updated_at": item["updated_at"],
        **changes,
    }


@pytest.mark.anyio
async def test_files_folders_public_lifecycle(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User],
) -> None:
    c, _, _, _ = attachment_client
    assert (await c.get(ADMIN)).json()["total"] == 0
    root = await folder(c, "资料")
    nested = await folder(c, "草稿", root["id"])
    response = await upload(
        c, "任意.xyz", b"<script>example</script>", parent=nested["id"], mime="text/html"
    )
    assert response.status_code == 201
    item = response.json()
    assert item["is_public"] is False and "sha256" not in item
    listing = (await c.get(ADMIN, params={"folder_id": nested["id"]})).json()
    assert [row["name"] for row in listing["breadcrumbs"]] == ["资料", "草稿"]
    assert listing["items"][0]["id"] == item["id"]
    url = f"/blog/attachments/{item['id']}/file"
    assert (await c.get(url)).status_code == 404
    private = await c.get(f"{ADMIN}/{item['id']}/file")
    assert private.content == b"<script>example</script>"
    assert private.headers["content-type"] == "application/octet-stream"
    assert private.headers["content-disposition"].startswith("attachment;")
    assert private.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in private.headers["content-security-policy"]
    published = (
        await c.put(f"{ADMIN}/{item['id']}", json=update_data(item, is_public=True))
    ).json()
    assert (await c.get(url)).status_code == 200
    assert (await c.get(url, headers={"Range": "bytes=0-7"})).content == b"<script>"
    moved = await c.put(
        f"{ADMIN}/{item['id']}", json=update_data(published, name="改名.bin", parent_id=None)
    )
    assert moved.status_code == 200
    item = moved.json()
    assert (await c.get(url)).status_code == 200
    assert (await c.put(f"{ADMIN}/{item['id']}", json=update_data(published))).status_code == 409
    hidden = (await c.put(f"{ADMIN}/{item['id']}", json=update_data(item, is_public=False))).json()
    assert (await c.get(url)).status_code == 404
    assert (
        await c.delete(f"{ADMIN}/{root['id']}", params={"expected_updated_at": root["updated_at"]})
    ).status_code == 409
    assert (
        await c.delete(f"{ADMIN}/{item['id']}", params={"expected_updated_at": item["updated_at"]})
    ).status_code == 409
    assert (
        await c.delete(
            f"{ADMIN}/{item['id']}", params={"expected_updated_at": hidden["updated_at"]}
        )
    ).status_code == 204
    assert not (storage.STORAGE_ROOT / item["id"]).exists()
    for directory in (nested, root):
        assert (
            await c.delete(
                f"{ADMIN}/{directory['id']}",
                params={"expected_updated_at": directory["updated_at"]},
            )
        ).status_code == 204


@pytest.mark.anyio
async def test_directory_upload_retries_and_conflicts(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User],
) -> None:
    c, _, _, _ = attachment_client
    identifier = str(uuid4())
    first = await upload(c, path="项目/文档/empty.any", content=b"", identifier=identifier)
    assert first.status_code == 201 and first.json()["size"] == 0
    again = await upload(c, path="项目/文档/empty.any", content=b"", identifier=identifier)
    assert again.json()["id"] == identifier
    assert (
        await upload(c, path="项目/文档/empty.any", content=b"other", identifier=identifier)
    ).status_code == 409
    assert (await upload(c, path="项目/文档/empty.any")).status_code == 409
    second = await upload(c, path="项目/文档/source.py")
    assert second.status_code == 201
    root = (await c.get(ADMIN)).json()
    assert root["total"] == 1 and root["items"][0]["name"] == "项目"
    doc = (await c.get(ADMIN, params={"folder_id": root["items"][0]["id"]})).json()["items"][0]
    assert (await c.get(ADMIN, params={"folder_id": doc["id"]})).json()["total"] == 2
    create = {"id": str(uuid4()), "name": "可重试", "parent_id": None}
    assert (await c.post(ADMIN + "/folders", json=create)).status_code == 201
    assert (await c.post(ADMIN + "/folders", json=create)).status_code == 201
    assert (await c.post(ADMIN + "/folders", json={**create, "name": "变化"})).status_code == 409
    assert (await folder(c, "可重试的另一个"))["kind"] == "folder"
    assert (
        await c.post(ADMIN + "/folders", json={**create, "id": str(uuid4())})
    ).status_code == 409
    renamed = await c.put(
        f"{ADMIN}/{identifier}", json=update_data(first.json(), name="已改名", parent_id=None)
    )
    assert renamed.status_code == 200
    assert (await upload(c, path="项目/文档/empty.any", content=b"", identifier=identifier)).json()[
        "name"
    ] == "已改名"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "path",
    ["../bad", "/absolute", "a//b", "a/./b", "a/../b", "a\\b", "a/\x01bad", "x/" + "z" * 256],
)
async def test_path_rejection(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User], path: str
) -> None:
    c, _, _, _ = attachment_client
    assert (await upload(c, path=path)).status_code == 422
    assert (await c.get(ADMIN)).json()["total"] == 0
    assert list(storage.STORAGE_ROOT.iterdir()) == []


@pytest.mark.anyio
async def test_tree_boundaries_and_size_cleanup(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    c, _, _, _ = attachment_client
    root = await folder(c, "根")
    child = await folder(c, "子", root["id"])
    for parent in (root["id"], child["id"]):
        assert (
            await c.put(f"{ADMIN}/{root['id']}", json=update_data(root, parent_id=parent))
        ).status_code == 422
    assert (
        await c.put(f"{ADMIN}/{root['id']}", json=update_data(root, is_public=True))
    ).status_code == 422
    file = (await upload(c)).json()
    assert (await c.get(ADMIN, params={"folder_id": file["id"]})).status_code == 422
    assert (await upload(c, parent=str(uuid4()))).status_code == 404
    assert (await upload(c, path="data.unknown/subfile")).status_code == 409
    monkeypatch.setattr(storage, "MAX_DEPTH", 2)
    assert (
        await c.post(
            ADMIN + "/folders", json={"id": str(uuid4()), "name": "太深", "parent_id": child["id"]}
        )
    ).status_code == 422
    assert (await upload(c, path="a/b/c/file")).status_code == 422
    other = await folder(c, "另一个")
    assert (
        await c.put(f"{ADMIN}/{root['id']}", json=update_data(root, parent_id=other["id"]))
    ).status_code == 422
    monkeypatch.setattr(routes, "MAX_UPLOAD_BYTES", 2)
    assert (await upload(c, path="失败目录/oversize", content=b"123")).status_code == 413
    assert (await c.get(ADMIN, params={"q": "失败目录"})).json()["total"] == 0
    assert len(list(storage.STORAGE_ROOT.iterdir())) == 1
    assert (await upload(c, content=b"123", identifier=file["id"])).status_code == 413


@pytest.mark.anyio
async def test_permissions_pagination_and_missing_files(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User],
) -> None:
    c, app, session, owner = attachment_client
    item = (await upload(c, name="literal%_.bin")).json()
    for n in range(22):
        await folder(c, f"目录{n:02}")
    listing = (await c.get(ADMIN)).json()
    assert listing["total"] == 23 and len(listing["items"]) == 20
    assert all(row["kind"] == "folder" for row in listing["items"])
    assert len((await c.get(ADMIN, params={"offset": 20})).json()["items"]) == 3
    assert (await c.get(ADMIN, params={"q": "%_"})).json()["total"] == 1
    assert (await c.get(ADMIN, params={"kind": "folder"})).json()["total"] == 22
    assert (await c.get(ADMIN, params={"limit": 101})).status_code == 422
    assert (
        await c.put(
            f"{ADMIN}/{item['id']}",
            json=update_data(item, expected_updated_at="2026-01-01T00:00:00"),
        )
    ).status_code == 422
    member = User(handle="attachment-member", display_name="测试成员", role=UserRole.MEMBER)
    other = User(handle="attachment-other", display_name="测试作者二", role=UserRole.OWNER)
    session.add_all([member, other])
    session.commit()
    app.dependency_overrides[get_current_user] = lambda: member
    assert (await c.get(ADMIN)).status_code == 403
    assert (await upload(c)).status_code == 403
    app.dependency_overrides[get_current_user] = lambda: other
    assert (await c.get(ADMIN)).json()["total"] == 0
    assert (await c.get(f"{ADMIN}/{item['id']}/file")).status_code == 404
    assert (await upload(c, identifier=item["id"])).status_code == 409
    app.dependency_overrides.pop(get_current_user)
    assert (await c.get(ADMIN)).status_code == 401
    assert (await c.get(f"/blog/attachments/{item['id']}/file")).status_code == 404
    app.dependency_overrides[get_current_user] = lambda: owner
    (storage.STORAGE_ROOT / item["id"]).unlink()
    assert (await c.get(f"{ADMIN}/{item['id']}/file")).status_code == 404


@pytest.mark.anyio
async def test_disk_failure_preserves_existing_file(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    c, _, _, _ = attachment_client
    identifier = str(uuid4())
    (storage.STORAGE_ROOT / identifier).write_bytes(b"preexisting")
    assert (await upload(c, identifier=identifier)).status_code == 503
    assert (storage.STORAGE_ROOT / identifier).read_bytes() == b"preexisting"
    assert (await c.get(ADMIN)).json()["total"] == 0

    def unavailable(*args: Any, **kwargs: Any) -> Any:
        raise OSError("模拟不可用存储")

    monkeypatch.setattr(routes, "copy_upload", unavailable)
    assert (await upload(c, path="事务目录/file")).status_code == 503
    assert (await c.get(ADMIN)).json()["total"] == 0


@pytest.mark.anyio
async def test_delete_storage_failure_and_commit_rollback(
    attachment_client: tuple[AsyncClient, FastAPI, Session, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    """删除失败保留记录，事务失败恢复文件，用户可以按原版本重试。"""
    c, _, session, _ = attachment_client
    item = (await upload(c)).json()
    path = storage.STORAGE_ROOT / item["id"]

    def unavailable_rename(*args: Any, **kwargs: Any) -> Any:
        raise OSError("模拟存储重命名失败")

    with monkeypatch.context() as patch:
        patch.setattr(Path, "rename", unavailable_rename)
        response = await c.delete(
            f"{ADMIN}/{item['id']}", params={"expected_updated_at": item["updated_at"]}
        )
        assert response.status_code == 503
    assert path.read_bytes() == b"test"
    assert (await c.get(f"{ADMIN}/{item['id']}")).status_code == 200

    def unavailable_commit() -> None:
        raise RuntimeError("模拟事务失败")

    with monkeypatch.context() as patch:
        patch.setattr(session, "commit", unavailable_commit)
        with pytest.raises(RuntimeError, match="模拟事务失败"):
            await c.delete(
                f"{ADMIN}/{item['id']}", params={"expected_updated_at": item["updated_at"]}
            )
    assert path.read_bytes() == b"test"
    assert (await c.get(f"{ADMIN}/{item['id']}")).status_code == 200
