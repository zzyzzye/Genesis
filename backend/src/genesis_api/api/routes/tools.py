from fastapi import APIRouter

router = APIRouter(prefix="/tools", tags=["工具系统"])


@router.get("/health")
def tools_health() -> dict[str, str]:
    return {"status": "ok", "system": "tools"}
