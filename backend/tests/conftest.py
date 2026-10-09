"""后端测试共用 fixture，异步测试统一使用 asyncio 后端。"""

import pytest


@pytest.fixture
def anyio_backend() -> str:
    """固定异步测试后端，以匹配任务管理器使用的 asyncio 原语。"""
    return "asyncio"
