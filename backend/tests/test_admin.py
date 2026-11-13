"""全站后台使用隔离身份和数据库，验证权限、分页和内容隔离。"""

from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from genesis_api.ai.models import AiChatRun, AiChatRunStatus
from genesis_api.api.dependencies import get_current_user
from genesis_api.api.routes.admin import router
from genesis_api.database.base import Base
from genesis_api.database.session import get_session
from genesis_api.identity.models import User, UserRole
from genesis_api.media.models import ImageGeneration, MediaProject
from genesis_api.monitoring import number, snapshot


@pytest.fixture
def state() -> Generator[tuple[FastAPI, Session, User], None, None]:
    """每次创建独立数据库，不读生产身份或凭据。"""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    with Session(engine) as session:
        owner = User(
            id=uuid4(), handle="synthetic-owner", display_name="测试站长", role=UserRole.OWNER
        )
        session.add(owner)
        session.commit()
        app.dependency_overrides[get_session] = lambda: session
        app.dependency_overrides[get_current_user] = lambda: owner
        yield app, session, owner
    engine.dispose()


@pytest.mark.anyio
async def test_owner_boundary(state: tuple[FastAPI, Session, User]) -> None:
    """所有新接口都拒绝成员；未登录同样不能读取。"""
    app, _, owner = state
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner.role = UserRole.MEMBER
        for path in ["overview", "users", "tasks", "monitoring", "processes", "system-services"]:
            assert (await client.get(f"/api/v1/admin/{path}")).status_code == 403
        app.dependency_overrides.pop(get_current_user)
        for path in ["overview", "users", "tasks", "monitoring", "processes", "system-services"]:
            assert (await client.get(f"/api/v1/admin/{path}")).status_code == 401


@pytest.mark.anyio
async def test_host_resource_pages(
    state: tuple[FastAPI, Session, User], monkeypatch: pytest.MonkeyPatch
) -> None:
    """进程按资源排序分页，服务失败优先，非 systemd 主机不伪装正常。"""
    from genesis_api.api.routes import admin

    app, _, _ = state
    supported = True

    async def host() -> dict[str, Any]:
        return {
            "sampled_at": 100,
            "systemd": supported,
            "items": [
                {
                    "pid": i,
                    "name": f"worker-{i}",
                    "cpu": i,
                    "memory": 30 - i,
                    "scope": "host",
                    "private": "hidden",
                }
                for i in range(25)
            ],
        }

    async def services() -> dict[str, Any]:
        return {
            "sampled_at": 100,
            "items": [
                {"name": "a.service", "state": "active"},
                {"name": "z.service", "state": "failed"},
            ],
        }

    monkeypatch.setattr(admin, "host_snapshot", host)
    monkeypatch.setattr(admin, "system_services", services)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/v1/admin/processes")
        assert result.json()["items"][0]["pid"] == 24
        assert "hidden" not in result.text
        assert (await client.get("/api/v1/admin/processes?page=99")).json()["page"] == 2
        assert (await client.get("/api/v1/admin/processes?sort=memory")).json()["items"][0][
            "pid"
        ] == 0
        assert (await client.get("/api/v1/admin/processes?scope=isolated")).json()["total"] == 0
        assert (await client.get("/api/v1/admin/system-services")).json()["items"][0][
            "state"
        ] == "failed"
        assert (await client.get("/api/v1/admin/system-services?state=inactive")).json()[
            "total"
        ] == 0
        supported = False
        assert (await client.get("/api/v1/admin/system-services")).json()["supported"] is False


@pytest.mark.anyio
async def test_metadata_paging_and_filters(state: tuple[FastAPI, Session, User]) -> None:
    """媒体与聊天任务可合并分页，不返回用户正文和请求快照。"""
    app, session, owner = state
    for index in range(23):
        session.add(User(handle=f"synthetic-{index}", display_name="测试成员"))
    project = MediaProject(id=uuid4(), owner_id=owner.id, name="合成作品", canvas={})
    session.add(project)
    session.flush()
    session.add(
        ImageGeneration(
            id=uuid4(),
            owner_id=owner.id,
            project_id=project.id,
            node_id=uuid4(),
            snapshot={"prompt": "private-synthetic"},
            status="processing",
        )
    )
    session.add(
        AiChatRun(
            user_id=owner.id,
            surface="studio",
            provider="synthetic",
            status=AiChatRunStatus.FAILED,
            content="private-synthetic",
            error="private-synthetic",
            created_at=datetime.now(UTC),
        )
    )
    session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.get("/api/v1/admin/users?page=99")
        assert result.json()["page"] == 2
        assert len(result.json()["items"]) == 4
        assert "password" not in result.text
        assert (await client.get("/api/v1/admin/users?q=%25")).json()["total"] == 0
        result = await client.get("/api/v1/admin/tasks")
        assert result.json()["total"] == 2
        assert "private-synthetic" not in result.text
        assert "processing" in result.text
        assert result.headers["Cache-Control"] == "no-store"
        result = await client.get("/api/v1/admin/tasks?business=blog&status=failed")
        assert result.json()["total"] == 1
        assert (await client.get("/api/v1/admin/tasks?hours=24")).json()["total"] == 2
        assert (await client.get("/api/v1/admin/tasks?hours=25")).status_code == 422
        result = await client.get(f"/api/v1/admin/tasks?user_id={uuid4()}")
        assert result.json()["total"] == 0
        overview = (await client.get("/api/v1/admin/overview")).json()
        assert overview["users"] == 24
        assert overview["tasks_24h"] == 2
        assert overview["statuses"]["failed"] == 1


@pytest.mark.anyio
async def test_monitoring_allowlist_and_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """网络失败与非有限样本不伪装成零值，原始标签不出接口。"""

    async def fail(self: httpx.AsyncClient, url: str, **kwargs: Any) -> Any:
        raise httpx.ConnectError("synthetic")

    monkeypatch.setattr(httpx.AsyncClient, "get", fail)
    result = await snapshot("1h")
    assert result["available"] is False
    assert result["series"]["cpu"] == []
    assert result["errors"]
    assert number("NaN") is None
    assert number("+Inf") is None
    assert number("1.5") == 1.5

    async def success(self: httpx.AsyncClient, url: str, **kwargs: Any) -> httpx.Response:
        query = kwargs["params"]["query"]
        assert self.base_url.host == "prometheus"
        result = [
            {
                "metric": {"name": "test-container", "job": "node", "secret": "hidden"},
                "value": [100, "1"],
                "values": [[100, "NaN"], [101, "23"]],
            }
        ]
        assert query
        return httpx.Response(
            200,
            json={"status": "success", "data": {"result": result}},
            request=httpx.Request("GET", "http://prometheus"),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", success)
    result = await snapshot("24h")
    assert result["series"]["cpu"] == [[100, None], [101, 23]]
    assert "hidden" not in str(result)
    assert result["containers"][0]["memory"] == 1
