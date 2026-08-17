from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "vision-service"
    service_version: str = "0.1.0"
    environment: str = "development"
    api_prefix: str = "/v1"
    callback_timeout_seconds: float = 10.0
    job_timeout_seconds: float = 600.0
    max_input_size_mb: float = 512.0
    allowed_image_extensions: str = "png,jpg,jpeg,webp,bmp,tiff,ppm"
    allowed_video_extensions: str = "mp4,mov,mkv,avi,webm"

    ffmpeg_bin: str = "ffmpeg"
    real_esrgan_cmd: str = "realesrgan-ncnn-vulkan -i \"{input}\" -o \"{output}\" -s {scale}"
    realsr_cmd: str = "realsr-ncnn-vulkan -i \"{input}\" -o \"{output}\""
    waifu2x_cmd: str = "waifu2x-ncnn-vulkan -i \"{input}\" -o \"{output}\" -s {scale}"
    gfpgan_cmd: str = "python inference_gfpgan.py -i \"{input}\" -o \"{output_dir}\""
    lama_cmd: str = "python run_inpainting.py --image \"{input}\" --mask \"{mask}\" --output \"{output}\""
    u2net_cmd: str = "rembg i \"{input}\" \"{output}\""
    insightface_cmd: str = (
        "python run_faceswap.py --target \"{input}\" --source \"{source}\" --output \"{output}\""
    )
    rife_cmd: str = "python inference_video.py --video \"{input}\" --output \"{output}\""
    deoldify_cmd: str = "python run_colorization.py --input \"{input}\" --output \"{output}\""
    scunet_cmd: str = "python run_denoise.py --input \"{input}\" --output \"{output}\""
    sam_cmd: str = "python run_segmentation.py --input \"{input}\" --output \"{output}\""
    ffmpeg_cmd: str = "\"{ffmpeg_bin}\" -y -i \"{input}\" \"{output}\""
    ffmpeg_image_upscale_cmd: str = (
        "\"{ffmpeg_bin}\" -y -i \"{input}\" "
        "-vf \"scale=iw*{scale}:ih*{scale}:flags=lanczos\" "
        "\"{output}\""
    )
    ffmpeg_video_upscale_cmd: str = (
        "\"{ffmpeg_bin}\" -y -i \"{input}\" "
        "-vf \"scale=iw*{scale}:ih*{scale}:flags=lanczos\" "
        "-c:v libx264 -pix_fmt yuv420p "
        "\"{output}\""
    )
    ffmpeg_video_transcode_cmd: str = (
        "\"{ffmpeg_bin}\" -y -i \"{input}\" -c:v libx264 -pix_fmt yuv420p \"{output}\""
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="VISION_SERVICE_",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
