export type JobKind =
  | "image_upscale"
  | "face_enhancement"
  | "background_removal"
  | "inpainting"
  | "face_swap"
  | "video_upscale"
  | "frame_interpolation"
  | "video_transcode";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type AssetKind = "input" | "output";

export type AppDescriptor = {
  name: string;
  stack: string;
  role: string;
};

export type ServiceDescriptor = {
  name: string;
  language: string;
  responsibility: string;
};

export type CapabilityCatalog = {
  apps: AppDescriptor[];
  services: ServiceDescriptor[];
  supported_jobs: JobKind[];
};

export type UserProfile = {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
};

export type AuthResponse = {
  token: string;
  user: UserProfile;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type AssetRecord = {
  asset_id: string;
  kind: AssetKind;
  job_id?: string | null;
  original_name: string;
  stored_name: string;
  local_path: string;
  content_type?: string | null;
  size_bytes: number;
  uploaded_at_epoch_ms: number;
  uploaded_by: string;
};

export type UploadResponse = {
  asset: AssetRecord;
};

export type CreateJobRequest = {
  kind: JobKind;
  asset_id?: string | null;
  source_asset_id?: string | null;
  mask_asset_id?: string | null;
  input_uri?: string | null;
  source_input_uri?: string | null;
  mask_uri?: string | null;
  output_format?: string | null;
  options: Record<string, string>;
};

export type JobRecord = {
  job_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  asset_id?: string | null;
  source_asset_id?: string | null;
  mask_asset_id?: string | null;
  input_uri: string;
  source_uri?: string | null;
  mask_uri?: string | null;
  output_format?: string | null;
  options: Record<string, string>;
  dispatched_to: string;
  output_uri?: string | null;
  output_asset_id?: string | null;
  message?: string | null;
  submitted_at_epoch_ms: number;
  updated_at_epoch_ms: number;
  created_by: string;
};

export type CreateJobResponse = {
  job: JobRecord;
};

export type JobEvent = {
  event: string;
  job: JobRecord;
};
