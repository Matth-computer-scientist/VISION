# Vision Suite

Vision Suite is a monorepo starter for a cross-platform media processing product:

- Web frontend in React + Vite + Tailwind
- Desktop shell in Tauri + Rust
- Mobile companion in React Native
- Core API and orchestration layer in Rust
- AI inference services in FastAPI

## Repository layout

- `frontend/`: browser dashboard and operator workspace
- `desktop/`: desktop shell for local workflows and file system access
- `mobile/`: mobile client for job tracking and quick actions
- `backend/`: Rust API, job orchestration, auth, storage adapters
- `services/vision/`: FastAPI service layer around AI pipelines
- `infrastructure/`: local compose stack for backend dependencies
- `docs/`: architecture notes and next steps

## Recommended system shape

Clients should never talk to model runtimes directly. The intended flow is:

1. The web, desktop, or mobile app submits a job to the Rust API.
2. The Rust API validates the request, stores metadata, and schedules work.
3. The FastAPI service translates the job into concrete AI pipelines.
4. The AI service calls the right engine such as Real-ESRGAN, GFPGAN, RIFE, LaMa, or FFmpeg.
5. The Rust API exposes job status, audit logs, and downloadable outputs.

This separation keeps the product layer stable while the Python inference layer can evolve quickly with model-specific dependencies.

## Local commands

From the repository root:

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm dev:mobile
cargo run --manifest-path backend/Cargo.toml -p vision-api
python -m uvicorn app.main:app --reload --app-dir services/vision
```

One-command smoke test for the local Rust API + FastAPI worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\e2e-smoke.ps1
```

For the web app, set `VITE_VISION_API_BASE_URL` if the Rust API is not exposed on `http://localhost:8080`.

Seed login defaults:

```text
email: admin@vision.local
password: vision123
```

The API persists users, uploads, and jobs into `backend/data/vision-db.json`.

For local Windows runs, copy `.env.example` to `.env` and point `VISION_SERVICE_FFMPEG_BIN`
to the installed `ffmpeg.exe` path if the shell has not picked it up on `PATH` yet.
If the binary comes from `winget`, copying it into `tools/ffmpeg/bin/ffmpeg.exe` is more reliable
than executing it directly from the protected winget package directory.

## What is scaffolded

- A connected web control desk with login, upload, job creation, and live job monitoring
- A Tauri shell that authenticates against the backend and lists jobs
- A React Native client that authenticates and reads the job queue
- A Rust `axum` API with auth, uploads, persistent jobs, worker dispatch, callbacks, and SSE
- A FastAPI worker service with command-template runners for common OSS engines
- A real FFmpeg-backed local execution path for image upscale, video upscale, and transcode
- A compose file for Redis and object storage alongside the API services

## Backend workflow

1. Sign in through `POST /api/v1/auth/login`.
2. Upload an asset through `POST /api/v1/uploads`.
3. Create a job through `POST /api/v1/jobs`.
4. The Rust API persists the job and dispatches it to `services/vision`.
5. The FastAPI worker executes the configured command and sends progress callbacks.
6. Clients listen to `GET /api/v1/jobs/events` for live updates.

For quick local validation without extra model installs, submit an `image_upscale` job against
`assets/fixtures/sample.ppm` with engine `ffmpeg`.

## Next implementation steps

1. Replace the file-backed store with Postgres and durable migrations.
2. Replace the in-process dispatcher with Redis, NATS, or another durable queue.
3. Add signed object storage uploads and remote asset retrieval.
4. Replace seeded credentials with real hashed users and multi-tenant auth.
5. Install and verify each model runtime so the command templates point to real executables.
