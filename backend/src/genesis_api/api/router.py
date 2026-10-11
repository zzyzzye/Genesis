"""聚合各业务路由，统一版本前缀由应用装配层添加。"""

from fastapi import APIRouter

from genesis_api.api.routes import (
    admin_blog,
    ai,
    auth,
    blog,
    blog_comments,
    health,
    llm,
    media,
    toolbox,
)

api_router = APIRouter()

# 平台级能力只负责健康检查和身份认证；业务路由按系统独立挂载，避免跨系统互相引用。
api_router.include_router(health.router, tags=["platform"])
api_router.include_router(auth.router)
api_router.include_router(blog.router)
api_router.include_router(blog_comments.public_router)
api_router.include_router(blog_comments.admin_router)
api_router.include_router(admin_blog.router)
api_router.include_router(llm.router)
api_router.include_router(ai.router)
api_router.include_router(toolbox.router)
api_router.include_router(media.router)
