export const productSurfaces = [
  {
    name: "Web studio",
    stack: "React + Vite + Tailwind",
    summary: "Upload media, compare versions, review failures, and manage batch jobs.",
  },
];

export const serviceFlow = [
  "Client apps submit jobs and upload metadata.",
  "Rust API validates permissions, quotas, and orchestration rules.",
  "FastAPI routes the request to the right image or video pipeline.",
  "OSS engines process assets and write outputs back to storage.",
];

export const pipelines = [
  {
    title: "Image Upscale",
    engines: "FFmpeg fallback, Real-ESRGAN, RealSR, Waifu2x",
    output: "Immediate local upscale plus pluggable AI engines",
  },
  {
    title: "Face Repair",
    engines: "GFPGAN",
    output: "Face-aware restoration after upscale or denoise",
  },
  {
    title: "Inpainting",
    engines: "LaMa",
    output: "Object removal and missing region reconstruction",
  },
  {
    title: "Colorization",
    engines: "DeOldify",
    output: "Automatic colorization of black-and-white photos",
  },
  {
    title: "Denoise",
    engines: "SCUNet",
    output: "Noise and artifact removal for low-quality photos",
  },
  {
    title: "Segmentation",
    engines: "Segment Anything (SAM)",
    output: "Foreground/object masks, reusable as inpainting input",
  },
  {
    title: "Video Smoothness",
    engines: "RIFE",
    output: "Frame interpolation for higher perceived FPS",
  },
  {
    title: "Video Processing",
    engines: "FFmpeg, Video2X, Real-ESRGAN orchestration",
    output: "Decode, encode, merge, trim, and upscale orchestration",
  },
];
