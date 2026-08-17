# Vision Suite

Vision Suite is an open-source, self-hostable web product for AI-powered media processing:

- Web frontend in React + Vite + Tailwind
- Core API and orchestration layer in Rust
- AI inference services in FastAPI

## Repository layout

- `frontend/`: browser dashboard and operator workspace
- `backend/`: Rust API, job orchestration, auth, storage adapters
- `services/vision/`: FastAPI service layer around AI pipelines
- `infrastructure/`: local compose stack for backend dependencies
- `docs/`: architecture notes and next steps

## Recommended system shape

The web client should never talk to model runtimes directly. The intended flow is:

1. The web app submits a job to the Rust API.
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
cargo run --manifest-path backend/Cargo.toml -p vision-api
python -m uvicorn app.main:app --reload --app-dir services/vision
```

One-command smoke test for the local Rust API + FastAPI worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\e2e-smoke.ps1
```

Unit tests:

```bash
npm run test:backend
pip install -e "services/vision[dev]"
npm run test:vision-service
```

For the web app, Vite proxies `/api/*` to `http://127.0.0.1:8080` by default in local dev.
Override that target with `VITE_VISION_API_PROXY_TARGET` if your Rust API runs elsewhere.

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
- A Rust `axum` API with auth, uploads, persistent jobs, worker dispatch, callbacks, and SSE
- A FastAPI worker service with command-template runners for common OSS engines
- Multi-input job composition for advanced lanes like face swap and inpainting
- A real FFmpeg-backed local execution path for image upscale, video upscale, and transcode
- A compose file for Redis and object storage alongside the API services

## Docker Compose

The main product stack can now be launched with Docker Compose:

```bash
docker compose -f infrastructure/docker-compose.yml up --build
```

Available endpoints once the stack is up:

- Web cockpit: `http://localhost:3000`
- Rust API: `http://localhost:8080`
- FastAPI worker: `http://localhost:8001`
- MinIO API: `http://localhost:9000`
- MinIO console: `http://localhost:9001`

The web container serves the built React app through Nginx and proxies `/api/*` requests to the
Rust API, so the browser does not need a hard-coded backend URL in Docker.

Convenience scripts from the repository root:

```bash
npm run docker:up
npm run docker:down
npm run docker:logs
npm run docker:smoke
```

End-to-end smoke test against the already-running Docker stack:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\e2e-docker-smoke.ps1
```

## Backend workflow

1. Sign in through `POST /api/v1/auth/login`.
2. Upload an asset through `POST /api/v1/uploads`.
3. Create a job through `POST /api/v1/jobs`.
4. The Rust API persists the job and dispatches it to `services/vision`.
5. The FastAPI worker executes the configured command and sends progress callbacks.
6. Successful outputs are registered as output assets and can be downloaded through the API.
7. The web client listens to `GET /api/v1/jobs/events` for live updates.

For quick local validation without extra model installs, submit an `image_upscale` job against
`assets/fixtures/sample.ppm` with engine `ffmpeg`.

Advanced job notes:

- `face_swap` now accepts a primary target asset plus a secondary source asset or URI.
- `inpainting` now accepts a primary image plus a secondary mask asset or URI.
- Worker command templates can use `{source}` and `{mask}` placeholders in addition to `{input}`.
- `colorization`, `denoise`, and `segmentation` are additional image pipelines with the same
  command-template mechanism (`deoldify_cmd`, `scunet_cmd`, `sam_cmd`).
- Worker jobs are validated (file existence, size limit, allowed extensions) before execution
  and are cancelled after `VISION_SERVICE_JOB_TIMEOUT_SECONDS` (default 600s) if they hang.

## Next implementation steps

1. Replace the file-backed store with Postgres and durable migrations.
2. Replace the in-process dispatcher with Redis, NATS, or another durable queue.
3. Add signed object storage uploads and remote asset retrieval.
4. Replace seeded credentials with real hashed users and multi-tenant auth.
5. Install and verify each model runtime so the command templates point to real executables.
