from typing import Literal

from pydantic import BaseModel, Field

JobKind = Literal[
    "image_upscale",
    "face_enhancement",
    "background_removal",
    "inpainting",
    "face_swap",
    "colorization",
    "denoise",
    "segmentation",
    "video_upscale",
    "frame_interpolation",
    "video_transcode",
]

JobStatus = Literal["queued", "running", "succeeded", "failed"]


class HealthResponse(BaseModel):
    service: str
    status: str
    version: str


class PipelineDescriptor(BaseModel):
    id: str
    category: Literal["image", "video"]
    engines: list[str]
    description: str


class WorkerDispatchRequest(BaseModel):
    job_id: str
    kind: JobKind
    input_uri: str
    source_uri: str | None = None
    mask_uri: str | None = None
    output_dir: str
    output_format: str | None = None
    options: dict[str, str] = Field(default_factory=dict)
    callback_url: str
    worker_token: str


class WorkerDispatchResponse(BaseModel):
    accepted: bool
    engine: str
    message: str


class WorkerCallbackPayload(BaseModel):
    status: JobStatus | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    message: str | None = None
    output_uri: str | None = None
