from fastapi import APIRouter

router = APIRouter(prefix="/media", tags=["影音系统"])


@router.get("/health")
def media_health() -> dict[str, str]:
    return {"status": "ok", "system": "media"}
