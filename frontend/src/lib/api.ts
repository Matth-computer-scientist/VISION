import type {
  AssetRecord,
  AuthResponse,
  CapabilityCatalog,
  CreateJobRequest,
  CreateJobResponse,
  JobEvent,
  JobRecord,
  LoginRequest,
  UserProfile,
} from "./contracts";

const configuredApiBaseUrl = (import.meta.env.VITE_VISION_API_BASE_URL ?? "").trim();

export const API_BASE_URL = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/$/, "")
  : "";
export const API_BASE_LABEL = API_BASE_URL || "same-origin / proxied";

const TOKEN_KEY = "vision-suite-token";

export function getStoredToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (!token) {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }

  window.localStorage.setItem(TOKEN_KEY, token);
}

function buildHeaders(init?: HeadersInit, token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init ?? {}),
  };
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.headers, token),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function login(payload: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMe(token: string): Promise<UserProfile> {
  return request<UserProfile>("/api/v1/auth/me", undefined, token);
}

export function fetchCapabilities(): Promise<CapabilityCatalog> {
  return request<CapabilityCatalog>("/api/v1/capabilities");
}

export function fetchAssets(token: string): Promise<AssetRecord[]> {
  return request<AssetRecord[]>("/api/v1/assets", undefined, token);
}

function extractFileName(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) {
    return fallback;
  }
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1] ?? fallback;
}

export async function downloadAsset(assetId: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/assets/${assetId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const fileName = extractFileName(response.headers.get("content-disposition"), assetId);
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function fetchJobs(token: string): Promise<JobRecord[]> {
  return request<JobRecord[]>("/api/v1/jobs", undefined, token);
}

export function createJob(
  payload: CreateJobRequest,
  token: string,
): Promise<CreateJobResponse> {
  return request<CreateJobResponse>(
    "/api/v1/jobs",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function uploadAsset(file: File, token: string): Promise<AssetRecord> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/v1/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Upload failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { asset: AssetRecord };
  return payload.asset;
}

export function subscribeToJobEvents(
  token: string,
  onEvent: (event: JobEvent) => void,
  onError?: () => void,
) {
  const source = new EventSource(
    `${API_BASE_URL}/api/v1/jobs/events?token=${encodeURIComponent(token)}`,
  );

  const listener = (event: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(event.data) as JobEvent;
      onEvent(parsed);
    } catch {
      onError?.();
    }
  };

  source.addEventListener("job_created", listener as EventListener);
  source.addEventListener("job_updated", listener as EventListener);
  source.onerror = () => {
    onError?.();
  };

  return () => {
    source.close();
  };
}
