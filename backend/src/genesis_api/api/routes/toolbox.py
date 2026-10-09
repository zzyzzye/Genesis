from fastapi import APIRouter

router = APIRouter(prefix="/toolbox", tags=["工具箱"])


@router.get("/health")
def toolbox_health() -> dict[str, str]:
    return {"status": "ok", "system": "toolbox"}
