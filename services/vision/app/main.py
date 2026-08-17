import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.pipelines import router as pipelines_router
from app.core.settings import get_settings

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="Vision Service",
    version=settings.service_version,
    description="AI pipeline service for image and video operations with worker callbacks.",
)

allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(pipelines_router, prefix=settings.api_prefix)


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": settings.service_name,
        "status": "ready",
        "docs": "/docs",
    }
