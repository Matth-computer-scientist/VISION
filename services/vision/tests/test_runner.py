from pathlib import Path

import pytest

from app.core.settings import Settings
from app.schemas.contracts import WorkerDispatchRequest
from app.services.runner import (
    build_command,
    pipeline_for_kind,
    resolve_engine,
    should_fallback_to_ffmpeg,
    validate_request_inputs,
)


def make_request(**overrides) -> WorkerDispatchRequest:
    defaults = dict(
        job_id="11111111-1111-1111-1111-111111111111",
        kind="image_upscale",
        input_uri="input.png",
        output_dir="out",
        callback_url="http://api/callback",
        worker_token="secret",
    )
    defaults.update(overrides)
    return WorkerDispatchRequest(**defaults)


def test_resolve_engine_defaults_to_kind_mapping():
    request = make_request(kind="face_enhancement")
    assert resolve_engine(request) == "gfpgan"


def test_resolve_engine_honors_explicit_option():
    request = make_request(kind="image_upscale", options={"engine": "real-esrgan"})
    assert resolve_engine(request) == "real_esrgan"


def test_pipeline_for_kind_covers_new_pipelines():
    assert pipeline_for_kind("colorization") == "colorization"
    assert pipeline_for_kind("denoise") == "denoise"
    assert pipeline_for_kind("segmentation") == "segmentation"


def test_should_fallback_to_ffmpeg_only_for_missing_binary_on_upscale():
    request = make_request(kind="image_upscale")
    assert should_fallback_to_ffmpeg(request, "real_esrgan", "'realesrgan' is not recognized")
    assert not should_fallback_to_ffmpeg(request, "ffmpeg", "'ffmpeg' is not recognized")

    face_swap_request = make_request(kind="face_swap", source_uri="source.png")
    assert not should_fallback_to_ffmpeg(
        face_swap_request, "insightface", "'insightface' is not recognized"
    )


def test_validate_request_inputs_requires_source_for_face_swap():
    request = make_request(kind="face_swap")
    with pytest.raises(RuntimeError, match="source input"):
        validate_request_inputs(request, Settings())


def test_validate_request_inputs_requires_mask_for_inpainting():
    request = make_request(kind="inpainting")
    with pytest.raises(RuntimeError, match="mask input"):
        validate_request_inputs(request, Settings())


def test_validate_request_inputs_rejects_missing_file(tmp_path):
    missing = tmp_path / "does-not-exist.png"
    request = make_request(input_uri=str(missing))
    with pytest.raises(RuntimeError, match="was not found"):
        validate_request_inputs(request, Settings())


def test_validate_request_inputs_rejects_unsupported_extension(tmp_path):
    bad_file = tmp_path / "input.exe"
    bad_file.write_bytes(b"data")
    request = make_request(input_uri=str(bad_file))
    with pytest.raises(RuntimeError, match="Unsupported input file extension"):
        validate_request_inputs(request, Settings())


def test_validate_request_inputs_rejects_oversized_file(tmp_path):
    big_file = tmp_path / "input.png"
    big_file.write_bytes(b"0" * 1024)
    request = make_request(input_uri=str(big_file))
    settings = Settings(max_input_size_mb=0.0001)
    with pytest.raises(RuntimeError, match="exceeds the"):
        validate_request_inputs(request, settings)


def test_validate_request_inputs_accepts_valid_file(tmp_path):
    good_file = tmp_path / "input.png"
    good_file.write_bytes(b"fake-image-bytes")
    request = make_request(input_uri=str(good_file))
    validate_request_inputs(request, Settings())


def test_build_command_fills_placeholders(tmp_path):
    input_file = tmp_path / "input.png"
    request = make_request(input_uri=str(input_file), kind="face_swap", source_uri="source.png")
    settings = Settings(
        insightface_cmd='python run_faceswap.py --target "{input}" --source "{source}" --output "{output}"'
    )
    command = build_command(request, settings, "insightface", tmp_path / "output.png")
    assert str(input_file) in command
    assert "source.png" in command
    assert str(tmp_path / "output.png") in command


def test_build_command_raises_for_unconfigured_engine(tmp_path):
    request = make_request()
    settings = Settings(deoldify_cmd="")
    with pytest.raises(RuntimeError, match="No command template configured"):
        build_command(request, settings, "deoldify", tmp_path / "output.png")
