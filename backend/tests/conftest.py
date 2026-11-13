"""后端测试共用 fixture，异步测试统一使用 asyncio 后端。"""

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def isolate_native_monitor(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """测试不接触本机真实宿主快照。"""
    from genesis_api import monitoring
    from genesis_api.api.routes import admin

    path = tmp_path / "snapshot.json"
    monkeypatch.setattr(monitoring, "NATIVE_SNAPSHOT", path)
    monkeypatch.setattr(admin, "NATIVE_SNAPSHOT", path)


@pytest.fixture
def anyio_backend() -> str:
    """固定异步测试后端，以匹配任务管理器使用的 asyncio 原语。"""
    return "asyncio"
