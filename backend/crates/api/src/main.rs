use std::{
    convert::Infallible,
    fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Multipart, Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;
use vision_core::{
    AppDescriptor, AssetKind, AssetRecord, AuthResponse, CapabilityCatalog, CreateJobRequest,
    CreateJobResponse, HealthResponse, JobEvent, JobKind, JobProgressUpdate, JobRecord,
    JobStatus, LoginRequest, ServiceDescriptor, UploadResponse, UserProfile,
    WorkerDispatchRequest, WorkerDispatchResponse,
};

type ApiError = (StatusCode, Json<serde_json::Value>);
type ApiResult<T> = Result<Json<T>, ApiError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredUser {
    user_id: Uuid,
    email: String,
    display_name: String,
    role: String,
    password: String,
    token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct DatabaseSnapshot {
    users: Vec<StoredUser>,
    assets: Vec<AssetRecord>,
    jobs: Vec<JobRecord>,
}

struct PersistentStore {
    path: PathBuf,
    snapshot: DatabaseSnapshot,
}

#[derive(Clone)]
struct AppState {
    ai_service_url: String,
    api_base_url: String,
    worker_token: String,
    upload_root: PathBuf,
    output_root: PathBuf,
    store: Arc<RwLock<PersistentStore>>,
    dispatch_tx: mpsc::Sender<Uuid>,
    events_tx: broadcast::Sender<JobEvent>,
    http_client: Client,
}

#[derive(Debug, Deserialize)]
struct EventQuery {
    token: Option<String>,
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "vision_api=debug,tower_http=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let port = std::env::var("VISION_API_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8080);

    let ai_service_url =
        std::env::var("VISION_AI_SERVICE_URL").unwrap_or_else(|_| "http://localhost:8001".into());
    let api_base_url =
        std::env::var("VISION_API_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".into());
    let worker_token =
        std::env::var("VISION_WORKER_TOKEN").unwrap_or_else(|_| "vision-worker-secret".into());
    let upload_root = PathBuf::from(
        std::env::var("VISION_UPLOAD_ROOT").unwrap_or_else(|_| "assets/uploads".into()),
    );
    let output_root = PathBuf::from(
        std::env::var("VISION_OUTPUT_ROOT").unwrap_or_else(|_| "assets/outputs".into()),
    );
    let data_root =
        PathBuf::from(std::env::var("VISION_DATA_ROOT").unwrap_or_else(|_| "backend/data".into()));
    let database_path = data_root.join("vision-db.json");

    ensure_directory(&upload_root).expect("failed to create upload root");
    ensure_directory(&output_root).expect("failed to create output root");
    ensure_directory(&data_root).expect("failed to create data root");

    let store = PersistentStore::load(
        &database_path,
        &std::env::var("VISION_ADMIN_EMAIL").unwrap_or_else(|_| "admin@vision.local".into()),
        &std::env::var("VISION_ADMIN_PASSWORD").unwrap_or_else(|_| "vision123".into()),
        &std::env::var("VISION_ADMIN_TOKEN").unwrap_or_else(|_| "vision-demo-token".into()),
    )
    .expect("failed to load persistent store");

    let (dispatch_tx, dispatch_rx) = mpsc::channel(128);
    let (events_tx, _) = broadcast::channel(256);

    let state = AppState {
        ai_service_url,
        api_base_url,
        worker_token,
        upload_root,
        output_root,
        store: Arc::new(RwLock::new(store)),
        dispatch_tx,
        events_tx,
        http_client: Client::new(),
    };

    spawn_dispatcher(state.clone(), dispatch_rx);
    requeue_pending_jobs(&state).await;

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/api/v1/capabilities", get(capabilities))
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/assets", get(list_assets))
        .route("/api/v1/assets/{asset_id}/download", get(download_asset))
        .route("/api/v1/uploads", post(upload_file))
        .route("/api/v1/jobs", get(list_jobs).post(create_job))
        .route("/api/v1/jobs/events", get(job_events))
        .route("/api/v1/jobs/{job_id}", get(get_job))
        .route(
            "/api/v1/internal/jobs/{job_id}/progress",
            post(update_job_progress),
        )
        .layer(
            CorsLayer::new()
                .allow_methods(Any)
                .allow_headers(Any)
                .allow_origin(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let address = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("vision-api listening on {}", address);

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("failed to bind listener");

    axum::serve(listener, app)
        .await
        .expect("vision-api server error");
}

async fn root() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "vision-api".into(),
        status: "ready".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "vision-api".into(),
        status: "healthy".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

async fn capabilities() -> Json<CapabilityCatalog> {
    Json(CapabilityCatalog {
        apps: vec![
            AppDescriptor {
                name: "frontend".into(),
                stack: "React + Vite + Tailwind".into(),
                role: "Authenticated web cockpit with uploads and live job telemetry".into(),
            },
        ],
        services: vec![
            ServiceDescriptor {
                name: "vision-api".into(),
                language: "Rust".into(),
                responsibility:
                    "Auth, uploads, persistent jobs, queue dispatch, SSE progress, callbacks"
                        .into(),
            },
            ServiceDescriptor {
                name: "vision-service".into(),
                language: "Python / FastAPI".into(),
                responsibility: "Model adapters for Real-ESRGAN, GFPGAN, RIFE, LaMa and FFmpeg"
                    .into(),
            },
        ],
        supported_jobs: vec![
            JobKind::ImageUpscale,
            JobKind::FaceEnhancement,
            JobKind::BackgroundRemoval,
            JobKind::Inpainting,
            JobKind::FaceSwap,
            JobKind::Colorization,
            JobKind::Denoise,
            JobKind::Segmentation,
            JobKind::VideoUpscale,
            JobKind::FrameInterpolation,
            JobKind::VideoTranscode,
        ],
    })
}

async fn login(State(state): State<AppState>, Json(payload): Json<LoginRequest>) -> ApiResult<AuthResponse> {
    let store = state.store.read().await;
    let maybe_user = store
        .snapshot
        .users
        .iter()
        .find(|user| user.email.eq_ignore_ascii_case(payload.email.trim()))
        .filter(|user| user.password == payload.password)
        .cloned();

    let user = maybe_user.ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "Invalid credentials"))?;

    Ok(Json(AuthResponse {
        token: user.token.clone(),
        user: user.as_profile(),
    }))
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<UserProfile> {
    let user = authorize_user(&headers, None, &state).await?;
    Ok(Json(user))
}

async fn list_assets(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Vec<AssetRecord>> {
    let _user = authorize_user(&headers, None, &state).await?;
    let store = state.store.read().await;
    let mut assets = store.snapshot.assets.clone();
    assets.sort_by(|left, right| right.uploaded_at_epoch_ms.cmp(&left.uploaded_at_epoch_ms));
    Ok(Json(assets))
}

async fn download_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
    AxumPath(asset_id): AxumPath<Uuid>,
) -> Result<(HeaderMap, Vec<u8>), ApiError> {
    let _user = authorize_user(&headers, query.token.as_deref(), &state).await?;

    let asset = {
        let store = state.store.read().await;
        store
            .snapshot
            .assets
            .iter()
            .find(|asset| asset.asset_id == asset_id)
            .cloned()
            .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Asset not found"))?
    };

    let bytes = fs::read(&asset.local_path)
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut response_headers = HeaderMap::new();
    let content_type = asset
        .content_type
        .clone()
        .unwrap_or_else(|| content_type_for_path(Path::new(&asset.local_path)).into());
    response_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );

    let file_name = sanitize_download_name(&asset.original_name);
    let content_disposition = format!("attachment; filename=\"{}\"", file_name);
    response_headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&content_disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );

    Ok((response_headers, bytes))
}

async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UploadResponse>), ApiError> {
    let user = authorize_user(&headers, None, &state).await?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))?
    {
        let maybe_name = field.file_name().map(sanitize_file_name);
        let file_name = maybe_name.unwrap_or_else(|| "upload.bin".into());
        let stored_name = format!("{}-{}", Uuid::new_v4(), file_name);
        let bytes = field
            .bytes()
            .await
            .map_err(|error| api_error(StatusCode::BAD_REQUEST, error.to_string()))?;

        if bytes.is_empty() {
            continue;
        }

        let path = state.upload_root.join(&stored_name);
        fs::write(&path, &bytes)
            .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

        let asset = build_asset_record(
            &path,
            file_name,
            stored_name,
            user.email.clone(),
            AssetKind::Input,
            None,
        )
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;

        {
            let mut store = state.store.write().await;
            store.snapshot.assets.push(asset.clone());
            store
                .save()
                .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
        }

        return Ok((StatusCode::CREATED, Json(UploadResponse { asset })));
    }

    Err(api_error(
        StatusCode::BAD_REQUEST,
        "No multipart file field was provided",
    ))
}

async fn create_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateJobRequest>,
) -> Result<(StatusCode, Json<CreateJobResponse>), ApiError> {
    let user = authorize_user(&headers, None, &state).await?;

    let input_uri = resolve_job_input(&state, payload.asset_id, payload.input_uri.clone()).await?;
    let source_uri = resolve_optional_job_input(
        &state,
        payload.source_asset_id,
        payload.source_input_uri.clone(),
    )
    .await?;
    let mask_uri =
        resolve_optional_job_input(&state, payload.mask_asset_id, payload.mask_uri.clone()).await?;
    validate_job_inputs(&payload.kind, source_uri.as_deref(), mask_uri.as_deref())?;
    let job_id = Uuid::new_v4();
    let output_dir = state.output_root.join(job_id.to_string());
    ensure_directory(&output_dir)
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let now = now_epoch_ms();
    let job = JobRecord {
        job_id,
        kind: payload.kind,
        status: JobStatus::Queued,
        progress: 0,
        asset_id: payload.asset_id,
        source_asset_id: payload.source_asset_id,
        mask_asset_id: payload.mask_asset_id,
        input_uri,
        source_uri,
        mask_uri,
        output_format: payload.output_format,
        options: payload.options,
        dispatched_to: state.ai_service_url.clone(),
        output_uri: None,
        output_asset_id: None,
        message: Some("Queued for worker dispatch".into()),
        submitted_at_epoch_ms: now,
        updated_at_epoch_ms: now,
        created_by: user.email,
    };

    {
        let mut store = state.store.write().await;
        store.snapshot.jobs.push(job.clone());
        store
            .save()
            .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
    }

    emit_job_event(&state, "job_created", job.clone());
    state
        .dispatch_tx
        .send(job_id)
        .await
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok((StatusCode::ACCEPTED, Json(CreateJobResponse { job })))
}

async fn list_jobs(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Vec<JobRecord>> {
    let _user = authorize_user(&headers, None, &state).await?;
    let store = state.store.read().await;
    let mut jobs = store.snapshot.jobs.clone();
    jobs.sort_by(|left, right| right.submitted_at_epoch_ms.cmp(&left.submitted_at_epoch_ms));
    Ok(Json(jobs))
}

async fn get_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(job_id): AxumPath<Uuid>,
) -> ApiResult<JobRecord> {
    let _user = authorize_user(&headers, None, &state).await?;
    let store = state.store.read().await;
    let job = store
        .snapshot
        .jobs
        .iter()
        .find(|job| job.job_id == job_id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Job not found"))?;
    Ok(Json(job))
}

async fn job_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let _user = authorize_user(&headers, query.token.as_deref(), &state).await?;

    let stream = BroadcastStream::new(state.events_tx.subscribe()).map(|result| {
        let event = match result {
            Ok(job_event) => Event::default()
                .event(job_event.event.clone())
                .data(serde_json::to_string(&job_event).unwrap_or_else(|_| "{}".into())),
            Err(_) => Event::default().event("noop").data("{}"),
        };

        Ok::<Event, Infallible>(event)
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn update_job_progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(job_id): AxumPath<Uuid>,
    Json(update): Json<JobProgressUpdate>,
) -> ApiResult<JobRecord> {
    authorize_worker(&headers, &state)?;

    let updated_job = {
        let mut store = state.store.write().await;
        let position = store
            .snapshot
            .jobs
            .iter()
            .position(|job| job.job_id == job_id)
            .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "Job not found"))?;

        let output_registration = {
            let job = &mut store.snapshot.jobs[position];
            if let Some(status) = update.status {
                job.status = status;
            }
            if let Some(progress) = update.progress {
                job.progress = progress.min(100);
            }
            if let Some(message) = update.message {
                job.message = Some(message);
            }
            if let Some(output_uri) = update.output_uri {
                job.output_uri = Some(output_uri);
            }
            if matches!(job.status, JobStatus::Succeeded) {
                job.output_uri
                    .clone()
                    .map(|output_uri| (job.job_id, output_uri, job.created_by.clone()))
            } else {
                None
            }
        };

        if let Some((tracked_job_id, output_uri, created_by)) = output_registration {
            let output_asset_id = ensure_output_asset(
                &mut store.snapshot,
                tracked_job_id,
                &output_uri,
                &created_by,
            )
            .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
            store.snapshot.jobs[position].output_asset_id = output_asset_id;
        }

        let cloned = {
            let job = &mut store.snapshot.jobs[position];
            job.updated_at_epoch_ms = now_epoch_ms();
            job.clone()
        };
        store
            .save()
            .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, error))?;
        cloned
    };

    emit_job_event(&state, "job_updated", updated_job.clone());
    Ok(Json(updated_job))
}

async fn resolve_job_input(
    state: &AppState,
    asset_id: Option<Uuid>,
    input_uri: Option<String>,
) -> Result<String, ApiError> {
    if let Some(asset_id) = asset_id {
        let store = state.store.read().await;
        let asset = store
            .snapshot
            .assets
            .iter()
            .find(|asset| asset.asset_id == asset_id)
            .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Asset not found"))?;
        return Ok(asset.local_path.clone());
    }

    let input_uri = input_uri
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "Provide asset_id or input_uri"))?;

    Ok(input_uri)
}

async fn resolve_optional_job_input(
    state: &AppState,
    asset_id: Option<Uuid>,
    input_uri: Option<String>,
) -> Result<Option<String>, ApiError> {
    if asset_id.is_none() && input_uri.as_deref().unwrap_or_default().trim().is_empty() {
        return Ok(None);
    }

    resolve_job_input(state, asset_id, input_uri).await.map(Some)
}

fn validate_job_inputs(
    kind: &JobKind,
    source_uri: Option<&str>,
    mask_uri: Option<&str>,
) -> Result<(), ApiError> {
    match kind {
        JobKind::FaceSwap if source_uri.is_none() => Err(api_error(
            StatusCode::BAD_REQUEST,
            "Face swap requires source_asset_id or source_input_uri",
        )),
        JobKind::Inpainting if mask_uri.is_none() => Err(api_error(
            StatusCode::BAD_REQUEST,
            "Inpainting requires mask_asset_id or mask_uri",
        )),
        _ => Ok(()),
    }
}

fn emit_job_event(state: &AppState, event: &str, job: JobRecord) {
    let _ = state.events_tx.send(JobEvent {
        event: event.into(),
        job,
    });
}

fn spawn_dispatcher(state: AppState, mut dispatch_rx: mpsc::Receiver<Uuid>) {
    tokio::spawn(async move {
        while let Some(job_id) = dispatch_rx.recv().await {
            if let Err(error) = dispatch_job(&state, job_id).await {
                tracing::error!("dispatch failed for {}: {}", job_id, error);
            }
        }
    });
}

async fn dispatch_job(state: &AppState, job_id: Uuid) -> Result<(), String> {
    let job = {
        let store = state.store.read().await;
        store
            .snapshot
            .jobs
            .iter()
            .find(|job| job.job_id == job_id)
            .cloned()
            .ok_or_else(|| "job not found".to_string())?
    };

    if !matches!(job.status, JobStatus::Queued) {
        return Ok(());
    }

    let callback_url = format!(
        "{}/api/v1/internal/jobs/{}/progress",
        state.api_base_url.trim_end_matches('/'),
        job_id
    );
    let output_dir = state.output_root.join(job_id.to_string());
    ensure_directory(&output_dir).map_err(|error| error.to_string())?;

    let payload = WorkerDispatchRequest {
        job_id,
        kind: job.kind.clone(),
        input_uri: job.input_uri.clone(),
        source_uri: job.source_uri.clone(),
        mask_uri: job.mask_uri.clone(),
        output_dir: output_dir.to_string_lossy().to_string(),
        output_format: job.output_format.clone(),
        options: job.options.clone(),
        callback_url,
        worker_token: state.worker_token.clone(),
    };

    let response = state
        .http_client
        .post(format!(
            "{}/v1/worker/execute",
            state.ai_service_url.trim_end_matches('/')
        ))
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| "worker returned an error".into());
        update_job_from_dispatch_failure(state, job_id, message.clone()).await?;
        return Err(message);
    }

    let worker_response: WorkerDispatchResponse = response
        .json()
        .await
        .map_err(|error| error.to_string())?;

    let updated_job = {
        let mut store = state.store.write().await;
        let position = store
            .snapshot
            .jobs
            .iter()
            .position(|job| job.job_id == job_id)
            .ok_or_else(|| "job missing during dispatch update".to_string())?;

        let cloned = {
            let job = &mut store.snapshot.jobs[position];
            job.status = JobStatus::Running;
            job.progress = job.progress.max(5);
            job.message = Some(worker_response.message.clone());
            job.updated_at_epoch_ms = now_epoch_ms();
            job.clone()
        };
        store.save()?;
        cloned
    };

    emit_job_event(state, "job_updated", updated_job);
    Ok(())
}

async fn update_job_from_dispatch_failure(
    state: &AppState,
    job_id: Uuid,
    message: String,
) -> Result<(), String> {
    let updated_job = {
        let mut store = state.store.write().await;
        let position = store
            .snapshot
            .jobs
            .iter()
            .position(|job| job.job_id == job_id)
            .ok_or_else(|| "job missing during failure update".to_string())?;

        let cloned = {
            let job = &mut store.snapshot.jobs[position];
            job.status = JobStatus::Failed;
            job.message = Some(message);
            job.updated_at_epoch_ms = now_epoch_ms();
            job.clone()
        };
        store.save()?;
        cloned
    };

    emit_job_event(state, "job_updated", updated_job);
    Ok(())
}

async fn requeue_pending_jobs(state: &AppState) {
    let queued_jobs = {
        let store = state.store.read().await;
        store
            .snapshot
            .jobs
            .iter()
            .filter(|job| matches!(job.status, JobStatus::Queued))
            .map(|job| job.job_id)
            .collect::<Vec<_>>()
    };

    for job_id in queued_jobs {
        if let Err(error) = state.dispatch_tx.send(job_id).await {
            tracing::error!("failed to requeue job {}: {}", job_id, error);
        }
    }
}

async fn authorize_user(
    headers: &HeaderMap,
    query_token: Option<&str>,
    state: &AppState,
) -> Result<UserProfile, ApiError> {
    let token = query_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| bearer_token(headers));

    let token = token.ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "Missing bearer token"))?;
    let store = state.store.read().await;

    store
        .snapshot
        .users
        .iter()
        .find(|user| user.token == token)
        .cloned()
        .map(|user| user.as_profile())
        .ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "Invalid bearer token"))
}

fn authorize_worker(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    let token = headers
        .get("x-worker-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "Missing worker token"))?;

    if token != state.worker_token {
        return Err(api_error(StatusCode::UNAUTHORIZED, "Invalid worker token"));
    }

    Ok(())
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn api_error(status: StatusCode, message: impl Into<String>) -> ApiError {
    (status, Json(json!({ "error": message.into() })))
}

fn ensure_directory(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

fn build_asset_record(
    path: &Path,
    original_name: String,
    stored_name: String,
    uploaded_by: String,
    kind: AssetKind,
    job_id: Option<Uuid>,
) -> Result<AssetRecord, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;

    Ok(AssetRecord {
        asset_id: Uuid::new_v4(),
        kind,
        job_id,
        original_name,
        stored_name,
        local_path: path.to_string_lossy().to_string(),
        content_type: Some(content_type_for_path(path).into()),
        size_bytes: metadata.len(),
        uploaded_at_epoch_ms: now_epoch_ms(),
        uploaded_by,
    })
}

fn ensure_output_asset(
    snapshot: &mut DatabaseSnapshot,
    job_id: Uuid,
    output_uri: &str,
    uploaded_by: &str,
) -> Result<Option<Uuid>, String> {
    if let Some(existing) = snapshot.assets.iter().find(|asset| {
        matches!(asset.kind, AssetKind::Output)
            && asset.job_id == Some(job_id)
            && asset.local_path == output_uri
    }) {
        return Ok(Some(existing.asset_id));
    }

    let path = PathBuf::from(output_uri);
    if !path.exists() {
        return Ok(None);
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Invalid output path: {output_uri}"))?
        .to_string();

    let asset = build_asset_record(
        &path,
        file_name.clone(),
        file_name,
        uploaded_by.into(),
        AssetKind::Output,
        Some(job_id),
    )?;
    let asset_id = asset.asset_id;
    snapshot.assets.push(asset);
    Ok(Some(asset_id))
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ppm") => "image/x-portable-pixmap",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("avi") => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

fn sanitize_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("upload.bin")
        .replace(' ', "-")
}

fn sanitize_download_name(file_name: &str) -> String {
    sanitize_file_name(file_name).replace('"', "")
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

impl PersistentStore {
    fn load(
        path: &Path,
        admin_email: &str,
        admin_password: &str,
        admin_token: &str,
    ) -> Result<Self, String> {
        let snapshot = if path.exists() {
            let bytes = fs::read(path).map_err(|error| error.to_string())?;
            serde_json::from_slice::<DatabaseSnapshot>(&bytes).map_err(|error| error.to_string())?
        } else {
            DatabaseSnapshot::default()
        };

        let mut store = Self {
            path: path.to_path_buf(),
            snapshot,
        };

        if store.snapshot.users.is_empty() {
            store.snapshot.users.push(StoredUser {
                user_id: Uuid::new_v4(),
                email: admin_email.into(),
                display_name: "Vision Admin".into(),
                role: "admin".into(),
                password: admin_password.into(),
                token: admin_token.into(),
            });
        }

        for job in &mut store.snapshot.jobs {
            if matches!(job.status, JobStatus::Running) {
                job.status = JobStatus::Queued;
                job.message = Some("Recovered after API restart".into());
                job.updated_at_epoch_ms = now_epoch_ms();
            }
        }

        store.save()?;
        Ok(store)
    }

    fn save(&self) -> Result<(), String> {
        let bytes =
            serde_json::to_vec_pretty(&self.snapshot).map_err(|error| error.to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&self.path, bytes).map_err(|error| error.to_string())
    }
}

impl StoredUser {
    fn as_profile(&self) -> UserProfile {
        UserProfile {
            user_id: self.user_id,
            email: self.email.clone(),
            display_name: self.display_name.clone(),
            role: self.role.clone(),
        }
    }
}
