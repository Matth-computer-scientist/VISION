from fastapi import APIRouter, BackgroundTasks

from app.core.settings import get_settings
from app.schemas.contracts import (
    JobAcceptedResponse,
    PipelineDescriptor,
    PipelineRequest,
    WorkerDispatchRequest,
    WorkerDispatchResponse,
)
from app.services.runner import pipeline_for_kind, resolve_engine, run_job

router = APIRouter(tags=["pipelines"])

PIPELINES = [
    PipelineDescriptor(
        id="image-upscale",
        category="image",
        engines=["ffmpeg", "real-esrgan", "realsr", "waifu2x"],
        description="Image enlargement with a working FFmpeg fallback and optional AI engines.",
    ),
    PipelineDescriptor(
        id="face-enhancement",
        category="image",
        engines=["gfpgan"],
        description="Targeted facial restoration after upscale or repair.",
    ),
    PipelineDescriptor(
        id="inpainting",
        category="image",
        engines=["lama"],
        description="Object removal and smart region reconstruction.",
    ),
    PipelineDescriptor(
        id="background-removal",
        category="image",
        engines=["u2net"],
        description="Foreground extraction for product and portrait assets.",
    ),
    PipelineDescriptor(
        id="face-swap",
        category="image",
        engines=["insightface"],
        description="Identity transfer pipeline for controlled face swap tasks.",
    ),
    PipelineDescriptor(
        id="video-upscale",
        category="video",
        engines=["ffmpeg", "real-esrgan"],
        description="Video enhancement through frame extraction and rebuild.",
    ),
    PipelineDescriptor(
        id="frame-interpolation",
        category="video",
        engines=["rife"],
        description="Intermediate frame generation for smoother playback.",
    ),
    PipelineDescriptor(
        id="video-transcode",
        category="video",
        engines=["ffmpeg"],
        description="Container and codec conversion through FFmpeg.",
    ),
]


@router.get("/pipelines", response_model=list[PipelineDescriptor])
async def list_pipelines() -> list[PipelineDescriptor]:
    return PIPELINES


@router.post("/jobs/upscale-image", response_model=JobAcceptedResponse, status_code=202)
async def upscale_image(payload: PipelineRequest) -> JobAcceptedResponse:
    return JobAcceptedResponse(
        status="accepted",
        pipeline="image-upscale",
        engine=payload.engine,
        next_step="The worker can run FFmpeg immediately and fall back from missing AI binaries when needed.",
    )


@router.post("/jobs/interpolate-video", response_model=JobAcceptedResponse, status_code=202)
async def interpolate_video(payload: PipelineRequest) -> JobAcceptedResponse:
    return JobAcceptedResponse(
        status="accepted",
        pipeline="frame-interpolation",
        engine=payload.engine,
        next_step="The worker can run RIFE and rebuild the target video with FFmpeg.",
    )


@router.post("/worker/execute", response_model=WorkerDispatchResponse, status_code=202)
async def execute_worker_job(
    payload: WorkerDispatchRequest,
    background_tasks: BackgroundTasks,
) -> WorkerDispatchResponse:
    settings = get_settings()
    engine = resolve_engine(payload)
    background_tasks.add_task(run_job, payload, settings)
    return WorkerDispatchResponse(
        accepted=True,
        engine=engine.replace("_", "-"),
        message=f"Accepted for {pipeline_for_kind(payload.kind)} with {engine.replace('_', '-')}.",
    )
