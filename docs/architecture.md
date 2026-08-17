# Vision Suite Architecture

## Why this split works

The product has two very different concerns:

- Stable business workflows: auth, billing, job state, audit, storage, quotas
- Fast-moving model runtimes: Python packages, CUDA bindings, FFmpeg pipelines

Keeping those concerns separate is the main reason to use:

- Rust for the general backend
- FastAPI for the AI service layer

Rust owns the platform contract. FastAPI owns model execution.

## High-level topology

```text
Web
          |
          v
     Rust API Gateway
          |
          v
   Job Queue + Object Storage
          |
          v
   FastAPI Vision Service
          |
          v
Real-ESRGAN / GFPGAN / LaMa / RIFE / FFmpeg
```

## Suggested responsibilities

### Rust backend

- User authentication and permissions
- Bearer token session validation for the web client
- Billing, quotas, rate limits
- Job creation and state transitions
- Persistent uploads and file-backed metadata storage
- Signed upload and download URLs
- Queue dispatching and retry policies
- Server-sent event streaming for live progress updates
- Audit logs and notifications

### FastAPI AI services

- Validate model-specific payloads
- Select pipeline engines
- Run inference or launch worker processes
- Call the Rust API back with progress and final outputs
- Emit structured progress updates
- Normalize outputs for the Rust backend

## Service evolution path

Start with one FastAPI service:

- `services/vision/`

Split later if needed:

- `services/image/`
- `services/video/`
- `services/face/`

This lets you keep the initial developer experience simple while preserving a clean path to horizontal scaling.

## Client strategy

### Web

Use the web app as the operations cockpit:

- upload assets
- manage jobs
- inspect errors
- compare before and after results

## Recommended next backend milestones

1. Add a real database schema for assets, jobs, and users.
2. Add a queue abstraction with Redis or NATS.
3. Add presigned object storage uploads.
4. Add worker callbacks or event streaming for progress.
5. Wrap each AI engine behind a common internal service contract.

## Demo API endpoints in this scaffold

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/assets`
- `POST /api/v1/uploads`
- `GET /api/v1/capabilities`
- `GET /api/v1/jobs`
- `GET /api/v1/jobs/events`
- `GET /api/v1/jobs/{job_id}`
- `POST /api/v1/jobs`
- `POST /api/v1/internal/jobs/{job_id}/progress`

These endpoints are intentionally simple. They validate the client-to-platform contract before adding real persistence and worker execution.
