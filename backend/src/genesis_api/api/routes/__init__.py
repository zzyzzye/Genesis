"""各领域 HTTP 路由模块；统一挂载由 api/router.py 负责。"""

from genesis_api.api.routes import admin_blog, auth, blog, health, llm

__all__ = ["admin_blog", "auth", "blog", "health", "llm"]
