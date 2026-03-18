from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.pipelines import router as pipelines_router
from app.core.settings import get_settings

settings = get_settings()

app = FastAPI(
    title="Vision Service",
    version=settings.service_version,
    description="AI pipeline service for image and video operations with worker callbacks.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
