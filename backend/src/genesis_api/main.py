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
    """统一管理后台任务与 Agent 存储，按依赖顺序启动并反向关闭。"""
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
    """装配中间件与版本化路由，资源初始化由 lifespan 在应用启动时执行。"""
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
