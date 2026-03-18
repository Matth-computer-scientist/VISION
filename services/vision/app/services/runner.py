import asyncio
import os
import shlex
import shutil
import subprocess
from pathlib import Path

import httpx

from app.core.settings import Settings
from app.schemas.contracts import WorkerCallbackPayload, WorkerDispatchRequest

ENGINE_BY_KIND: dict[str, str] = {
    "image_upscale": "ffmpeg",
    "face_enhancement": "gfpgan",
    "background_removal": "u2net",
    "inpainting": "lama",
    "face_swap": "insightface",
    "video_upscale": "ffmpeg",
    "frame_interpolation": "rife",
    "video_transcode": "ffmpeg",
}

PIPELINE_BY_KIND: dict[str, str] = {
    "image_upscale": "image-upscale",
    "face_enhancement": "face-enhancement",
    "background_removal": "background-removal",
    "inpainting": "inpainting",
    "face_swap": "face-swap",
    "video_upscale": "video-upscale",
    "frame_interpolation": "frame-interpolation",
    "video_transcode": "video-transcode",
}


def resolve_engine(request: WorkerDispatchRequest) -> str:
    requested = request.options.get("engine", "").strip().lower()
    if requested:
        return requested.replace("-", "_")
    return ENGINE_BY_KIND[request.kind]


def pipeline_for_kind(kind: str) -> str:
    return PIPELINE_BY_KIND[kind]


def build_output_path(request: WorkerDispatchRequest, engine: str) -> Path:
    output_dir = Path(request.output_dir)
    suffix = request.output_format or Path(request.input_uri).suffix.lstrip(".") or "out"
    filename = f"{request.job_id}-{engine.replace('_', '-')}.{suffix}"
    return output_dir / filename


def build_command(
    request: WorkerDispatchRequest,
    settings: Settings,
    engine: str,
    output_path: Path,
) -> str:
    if engine == "ffmpeg":
        template = ffmpeg_template_for_kind(request.kind, settings)
    else:
        template = getattr(settings, f"{engine}_cmd", "").strip()

    if not template:
        raise RuntimeError(f"No command template configured for engine '{engine}'")

    input_path = Path(request.input_uri)
    format_values = {
        "input": str(input_path),
        "input_dir": str(input_path.parent),
        "output": str(output_path),
        "output_dir": str(output_path.parent),
        "scale": request.options.get("scale", "4"),
        "fps": request.options.get("fps", "60"),
        "mask": request.options.get("mask", ""),
        "ffmpeg_bin": settings.ffmpeg_bin,
    }
    return template.format(**format_values)


def ffmpeg_template_for_kind(kind: str, settings: Settings) -> str:
    if kind == "image_upscale":
        return settings.ffmpeg_image_upscale_cmd.strip()
    if kind == "video_upscale":
        return settings.ffmpeg_video_upscale_cmd.strip()
    if kind == "video_transcode":
        return settings.ffmpeg_video_transcode_cmd.strip()
    return settings.ffmpeg_cmd.strip()


def normalize_argv(argv: list[str]) -> list[str]:
    normalized: list[str] = []
    for arg in argv:
        if len(arg) >= 2 and arg[0] == arg[-1] and arg[0] in {'"', "'"}:
            normalized.append(arg[1:-1])
        else:
            normalized.append(arg)
    return normalized


def should_fallback_to_ffmpeg(request: WorkerDispatchRequest, engine: str, error: str) -> bool:
    if engine == "ffmpeg" or request.kind not in {"image_upscale", "video_upscale"}:
        return False

    normalized_error = error.lower()
    return any(
        marker in normalized_error
        for marker in [
            "not recognized as an internal or external command",
            "no such file or directory",
            "is not recognized",
            "cannot find the file specified",
        ]
    )


def ensure_ffmpeg_available(settings: Settings) -> None:
    ffmpeg_bin = settings.ffmpeg_bin.strip().strip("\"")
    if Path(ffmpeg_bin).exists():
        return

    if shutil.which(ffmpeg_bin):
        return

    raise RuntimeError(
        f"FFmpeg executable not found: {settings.ffmpeg_bin}. "
        "Set VISION_SERVICE_FFMPEG_BIN to a valid binary path."
    )


async def execute_engine(
    request: WorkerDispatchRequest,
    settings: Settings,
    engine: str,
    output_path: Path,
) -> Path:
    if engine == "ffmpeg":
        ensure_ffmpeg_available(settings)

    command = build_command(request, settings, engine, output_path)
    argv = normalize_argv(shlex.split(command, posix=os.name != "nt"))
    if not argv:
        raise RuntimeError(f"Unable to build a command for engine '{engine}'.")

    completed = await asyncio.to_thread(
        subprocess.run,
        argv,
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Worker command failed."
        raise RuntimeError(message)

    materialized_output = resolve_materialized_output(output_path)
    if materialized_output is None:
        raise RuntimeError(
            f"Worker finished without producing an output file at {output_path}."
        )

    return materialized_output


def resolve_materialized_output(expected_path: Path) -> Path | None:
    if expected_path.exists():
        return expected_path

    parent = expected_path.parent
    if not parent.exists():
        return None

    candidates = [
        path
        for path in parent.rglob("*")
        if path.is_file() and path.name != Path(expected_path.name).name
    ]
    if not candidates:
        return None

    return max(candidates, key=lambda path: path.stat().st_mtime)


async def send_callback(
    callback_url: str,
    worker_token: str,
    payload: WorkerCallbackPayload,
    settings: Settings,
) -> None:
    async with httpx.AsyncClient(timeout=settings.callback_timeout_seconds) as client:
        response = await client.post(
            callback_url,
            headers={"x-worker-token": worker_token},
            json=payload.model_dump(exclude_none=True),
        )
        response.raise_for_status()


async def run_job(request: WorkerDispatchRequest, settings: Settings) -> None:
    requested_engine = resolve_engine(request)

    try:
        await send_callback(
            request.callback_url,
            request.worker_token,
            WorkerCallbackPayload(
                status="running",
                progress=15,
                message=f"Worker started with {requested_engine.replace('_', '-')}.",
            ),
            settings,
        )

        output_path = build_output_path(request, requested_engine)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            materialized_output = await execute_engine(
                request,
                settings,
                requested_engine,
                output_path,
            )
            completed_engine = requested_engine
        except RuntimeError as exc:
            if not should_fallback_to_ffmpeg(request, requested_engine, str(exc)):
                raise

            fallback_engine = "ffmpeg"
            fallback_output_path = build_output_path(request, fallback_engine)
            fallback_output_path.parent.mkdir(parents=True, exist_ok=True)

            await send_callback(
                request.callback_url,
                request.worker_token,
                WorkerCallbackPayload(
                    status="running",
                    progress=35,
                    message=(
                        f"{requested_engine.replace('_', '-')} unavailable locally, "
                        "retrying with ffmpeg."
                    ),
                ),
                settings,
            )

            materialized_output = await execute_engine(
                request,
                settings,
                fallback_engine,
                fallback_output_path,
            )
            completed_engine = fallback_engine

        await send_callback(
            request.callback_url,
            request.worker_token,
            WorkerCallbackPayload(
                status="succeeded",
                progress=100,
                message=f"Completed with {completed_engine.replace('_', '-')}.",
                output_uri=str(materialized_output),
            ),
            settings,
        )
    except Exception as exc:
        await send_callback(
            request.callback_url,
            request.worker_token,
            WorkerCallbackPayload(
                status="failed",
                progress=100,
                message=str(exc),
                output_uri=str(output_path) if os.path.exists(output_path) else None,
            ),
            settings,
        )
