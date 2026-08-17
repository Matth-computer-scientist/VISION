use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub service: String,
    pub status: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    ImageUpscale,
    FaceEnhancement,
    BackgroundRemoval,
    Inpainting,
    FaceSwap,
    Colorization,
    Denoise,
    Segmentation,
    VideoUpscale,
    FrameInterpolation,
    VideoTranscode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    #[default]
    Input,
    Output,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetRecord {
    pub asset_id: Uuid,
    #[serde(default)]
    pub kind: AssetKind,
    #[serde(default)]
    pub job_id: Option<Uuid>,
    pub original_name: String,
    pub stored_name: String,
    pub local_path: String,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub size_bytes: u64,
    pub uploaded_at_epoch_ms: u64,
    pub uploaded_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    pub asset: AssetRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobRequest {
    pub kind: JobKind,
    pub asset_id: Option<Uuid>,
    pub source_asset_id: Option<Uuid>,
    pub mask_asset_id: Option<Uuid>,
    pub input_uri: Option<String>,
    pub source_input_uri: Option<String>,
    pub mask_uri: Option<String>,
    pub output_format: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRecord {
    pub job_id: Uuid,
    pub kind: JobKind,
    pub status: JobStatus,
    pub progress: u8,
    pub asset_id: Option<Uuid>,
    #[serde(default)]
    pub source_asset_id: Option<Uuid>,
    #[serde(default)]
    pub mask_asset_id: Option<Uuid>,
    pub input_uri: String,
    #[serde(default)]
    pub source_uri: Option<String>,
    #[serde(default)]
    pub mask_uri: Option<String>,
    pub output_format: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    pub dispatched_to: String,
    pub output_uri: Option<String>,
    #[serde(default)]
    pub output_asset_id: Option<Uuid>,
    pub message: Option<String>,
    pub submitted_at_epoch_ms: u64,
    pub updated_at_epoch_ms: u64,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobResponse {
    pub job: JobRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgressUpdate {
    pub status: Option<JobStatus>,
    pub progress: Option<u8>,
    pub message: Option<String>,
    pub output_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDispatchRequest {
    pub job_id: Uuid,
    pub kind: JobKind,
    pub input_uri: String,
    #[serde(default)]
    pub source_uri: Option<String>,
    #[serde(default)]
    pub mask_uri: Option<String>,
    pub output_dir: String,
    pub output_format: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
    pub callback_url: String,
    pub worker_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDispatchResponse {
    pub accepted: bool,
    pub engine: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobEvent {
    pub event: String,
    pub job: JobRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppDescriptor {
    pub name: String,
    pub stack: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDescriptor {
    pub name: String,
    pub language: String,
    pub responsibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityCatalog {
    pub apps: Vec<AppDescriptor>,
    pub services: Vec<ServiceDescriptor>,
    pub supported_jobs: Vec<JobKind>,
}
