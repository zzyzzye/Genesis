"""工具箱业务入口，目前仅提供模块存活检查。"""

from fastapi import APIRouter

router = APIRouter(prefix="/toolbox", tags=["工具箱"])


@router.get("/health")
def toolbox_health() -> dict[str, str]:
    """返回工具箱模块标识，不宣称具体业务工具已接入。"""
    return {"status": "ok", "system": "toolbox"}
