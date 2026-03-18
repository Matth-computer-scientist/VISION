from fastapi import APIRouter

from app.core.settings import get_settings
from app.schemas.contracts import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        service=settings.service_name,
        status="healthy",
        version=settings.service_version,
    )
