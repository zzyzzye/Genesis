"""FastAPI 应用装配入口，统一管理路由、中间件与 Agent 资源生命周期。"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from genesis_api.agent.runtime import embedded_agent_runtime
from genesis_api.ai.runs import ai_chat_run_manager
from genesis_api.api.router import api_router
from genesis_api.core.config import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """按依赖顺序启动 checkpoint 与后台任务，并反向关闭资源。

    Args:
        _: FastAPI 传入的应用实例，此处无需读取实例属性。

    Yields:
        不产出业务值；应用在资源就绪后开始处理请求。
    """
    settings = get_settings()
    await embedded_agent_runtime.startup(settings)
    # 先准备 checkpoint，再恢复任务，避免生成流程访问尚未初始化的运行时。
    await ai_chat_run_manager.recover_interrupted_runs(settings)
    try:
        yield
    finally:
        # 等待生成任务退出后才关闭 checkpoint，避免取消过程中仍访问已关闭连接。
        await ai_chat_run_manager.shutdown()
        await embedded_agent_runtime.shutdown()


def create_app() -> FastAPI:
    """装配中间件与版本化路由，资源连接交给 lifespan 初始化。

    Returns:
        配置完成的 FastAPI 应用，不启动额外服务器进程。
    """
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
