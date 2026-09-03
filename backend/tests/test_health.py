import pytest
from httpx import ASGITransport, AsyncClient

from genesis_api.main import app


@pytest.mark.anyio
async def test_health_check() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "genesis-api",
        "environment": "development",
    }
