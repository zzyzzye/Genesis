from fastapi import APIRouter

from genesis_api.api.routes import admin_blog, auth, blog, health, llm

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(blog.router)
api_router.include_router(admin_blog.router)
api_router.include_router(llm.router)
