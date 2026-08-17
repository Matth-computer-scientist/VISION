import { type FormEvent, useEffect, useState } from "react";

import {
  API_BASE_LABEL,
  createJob,
  downloadAsset,
  fetchAssets,
  fetchCapabilities,
  fetchJobs,
  fetchMe,
  getStoredToken,
  login,
  setStoredToken,
  subscribeToJobEvents,
  uploadAsset,
} from "./lib/api";
import { pipelines, productSurfaces, serviceFlow } from "./lib/catalog";
import type {
  AssetRecord,
  CapabilityCatalog,
  JobEvent,
  JobKind,
  JobRecord,
  UserProfile,
} from "./lib/contracts";

type LoginForm = {
  email: string;
  password: string;
};

type JobForm = {
  kind: JobKind;
  assetId: string;
  inputUri: string;
  sourceAssetId: string;
  sourceInputUri: string;
  maskAssetId: string;
  maskUri: string;
  outputFormat: string;
  scale: string;
  fps: string;
  engine: string;
};

type JobFilter = "all" | "active" | "ready" | "failed";
type AssetFilter = "all" | "input" | "output";

const defaultLogin: LoginForm = {
  email: "admin@vision.local",
  password: "vision123",
};

const defaultJob: JobForm = {
  kind: "image_upscale",
  assetId: "",
  inputUri: "",
  sourceAssetId: "",
  sourceInputUri: "",
  maskAssetId: "",
  maskUri: "",
  outputFormat: "png",
  scale: "4",
  fps: "60",
  engine: "ffmpeg",
};

const jobKinds: Array<{
  value: JobKind;
  label: string;
  summary: string;
  engine: string;
  format: string;
  supportsScale?: boolean;
  supportsFps?: boolean;
  needsSource?: boolean;
  needsMask?: boolean;
}> = [
  {
    value: "image_upscale",
    label: "Image Upscale",
    summary: "Lanczos or AI enlargement for still imagery",
    engine: "ffmpeg",
    format: "png",
    supportsScale: true,
  },
  {
    value: "face_enhancement",
    label: "Face Enhancement",
    summary: "Portrait recovery and facial detail repair",
    engine: "gfpgan",
    format: "png",
    supportsScale: true,
  },
  {
    value: "background_removal",
    label: "Background Removal",
    summary: "Foreground extraction for products and portraits",
    engine: "u2net",
    format: "png",
  },
  {
    value: "inpainting",
    label: "Inpainting",
    summary: "Object cleanup and region reconstruction",
    engine: "lama",
    format: "png",
    needsMask: true,
  },
  {
    value: "face_swap",
    label: "Face Swap",
    summary: "Identity transfer for controlled edits",
    engine: "insightface",
    format: "png",
    needsSource: true,
  },
  {
    value: "video_upscale",
    label: "Video Upscale",
    summary: "Frame resize and clean export for footage",
    engine: "ffmpeg",
    format: "mp4",
    supportsScale: true,
  },
  {
    value: "frame_interpolation",
    label: "Frame Interpolation",
    summary: "Motion smoothing for higher perceived FPS",
    engine: "rife",
    format: "mp4",
    supportsFps: true,
  },
  {
    value: "video_transcode",
    label: "Video Transcode",
    summary: "Codec and container conversion pipeline",
    engine: "ffmpeg",
    format: "mp4",
  },
];

const jobFilterOptions: Array<{ value: JobFilter; label: string }> = [
  { value: "all", label: "All lanes" },
  { value: "active", label: "Running" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
];

const assetFilterOptions: Array<{ value: AssetFilter; label: string }> = [
  { value: "all", label: "All assets" },
  { value: "input", label: "Inputs" },
  { value: "output", label: "Outputs" },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatKind(kind: JobKind) {
  return kind
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSubmittedAt(epochMs: number) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(epochMs);
}

function formatAssetKind(kind: AssetRecord["kind"]) {
  return kind === "output" ? "Output" : "Input";
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function sortJobs(items: JobRecord[]) {
  return [...items].sort((a, b) => b.submitted_at_epoch_ms - a.submitted_at_epoch_ms);
}

function mergeJob(items: JobRecord[], next: JobRecord) {
  return sortJobs([next, ...items.filter((job) => job.job_id !== next.job_id)]);
}

function jobStatusTone(status: JobRecord["status"]) {
  switch (status) {
    case "queued":
      return "border-amber-300/70 bg-amber-100/80 text-amber-950";
    case "running":
      return "border-sky-300/70 bg-sky-100/80 text-sky-950";
    case "succeeded":
      return "border-emerald-300/70 bg-emerald-100/80 text-emerald-950";
    case "failed":
      return "border-rose-300/70 bg-rose-100/80 text-rose-950";
    default:
      return "border-slate-200 bg-slate-100 text-slate-800";
  }
}

function matchesJobFilter(job: JobRecord, filter: JobFilter) {
  switch (filter) {
    case "active":
      return job.status === "queued" || job.status === "running";
    case "ready":
      return job.status === "succeeded" || Boolean(job.output_asset_id);
    case "failed":
      return job.status === "failed";
    default:
      return true;
  }
}

function matchesAssetFilter(asset: AssetRecord, filter: AssetFilter) {
  switch (filter) {
    case "input":
      return asset.kind === "input";
    case "output":
      return asset.kind === "output";
    default:
      return true;
  }
}

function App() {
  const [capabilities, setCapabilities] = useState<CapabilityCatalog | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<UserProfile | null>(null);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loginForm, setLoginForm] = useState<LoginForm>(defaultLogin);
  const [jobForm, setJobForm] = useState<JobForm>(defaultJob);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [eventsLive, setEventsLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [jobSearch, setJobSearch] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const selectedKind = jobKinds.find((item) => item.value === jobForm.kind) ?? jobKinds[0];
  const inputAssets = assets.filter((asset) => asset.kind === "input");
  const outputAssets = assets.filter((asset) => asset.kind === "output");
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running")
    .length;
  const completedJobs = jobs.filter((job) => job.status === "succeeded").length;
  const latestOutput = outputAssets[0] ?? null;
  const queueMomentum = jobs.length
    ? Math.round(jobs.reduce((total, job) => total + job.progress, 0) / jobs.length)
    : 0;
  const visibleJobs = jobs.filter((job) => {
    if (!matchesJobFilter(job, jobFilter)) {
      return false;
    }

    const normalizedQuery = jobSearch.trim().toLowerCase();
    if (!normalizedQuery) {
      return true;
    }

    return [
      formatKind(job.kind),
      job.input_uri,
      job.message ?? "",
      job.status,
      job.options.engine ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const visibleAssets = assets.filter((asset) => matchesAssetFilter(asset, assetFilter));
  const selectedJob =
    visibleJobs.find((job) => job.job_id === selectedJobId) ??
    jobs.find((job) => job.job_id === selectedJobId) ??
    visibleJobs[0] ??
    jobs[0] ??
    null;
  const selectedAsset =
    assets.find((asset) => asset.asset_id === selectedAssetId) ??
    assets.find((asset) => asset.asset_id === jobForm.assetId) ??
    inputAssets[0] ??
    assets[0] ??
    null;
  const selectedSourceAsset =
    inputAssets.find((asset) => asset.asset_id === jobForm.sourceAssetId) ?? null;
  const selectedMaskAsset =
    inputAssets.find((asset) => asset.asset_id === jobForm.maskAssetId) ?? null;
  const selectedKindSupported = capabilities?.supported_jobs.includes(jobForm.kind) ?? true;

  useEffect(() => {
    fetchCapabilities().then(setCapabilities).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setAssets([]);
      setJobs([]);
      return;
    }

    Promise.all([fetchMe(token), fetchAssets(token), fetchJobs(token)])
      .then(([nextUser, nextAssets, nextJobs]) => {
        setUser(nextUser);
        setAssets(nextAssets);
        setJobs(sortJobs(nextJobs));
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Unable to load workspace.");
        setStoredToken(null);
        setToken(null);
      });
  }, [token]);

  useEffect(() => {
    if (!token) {
      setEventsLive(false);
      return;
    }

    const unsubscribe = subscribeToJobEvents(
      token,
      (event: JobEvent) => {
        setJobs((current) => mergeJob(current, event.job));
        setSelectedJobId((current) => current ?? event.job.job_id);
        setMessage(event.job.message ?? `${formatKind(event.job.kind)} updated.`);
        setEventsLive(true);
        if (event.job.output_asset_id) {
          fetchAssets(token).then(setAssets).catch(() => undefined);
        }
      },
      () => setEventsLive(false),
    );

    return unsubscribe;
  }, [token]);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null);
      return;
    }

    if (selectedJobId && jobs.some((job) => job.job_id === selectedJobId)) {
      return;
    }

    setSelectedJobId(jobs[0].job_id);
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (assets.length === 0) {
      setSelectedAssetId(null);
      return;
    }

    if (selectedAssetId && assets.some((asset) => asset.asset_id === selectedAssetId)) {
      return;
    }

    const fallback = inputAssets[0] ?? assets[0];
    if (!fallback) {
      return;
    }

    setSelectedAssetId(fallback.asset_id);
    setJobForm((current) => ({
      ...current,
      assetId: current.assetId || fallback.asset_id,
      inputUri: current.inputUri || fallback.local_path,
    }));
  }, [assets, inputAssets, selectedAssetId]);

  function applyKind(nextKind: (typeof jobKinds)[number]) {
    setJobForm((current) => ({
      ...current,
      kind: nextKind.value,
      engine: nextKind.engine,
      outputFormat: nextKind.format,
      scale: nextKind.supportsScale ? current.scale || "4" : "",
      fps: nextKind.supportsFps ? current.fps || "60" : "",
      sourceAssetId: nextKind.needsSource ? current.sourceAssetId : "",
      sourceInputUri: nextKind.needsSource ? current.sourceInputUri : "",
      maskAssetId: nextKind.needsMask ? current.maskAssetId : "",
      maskUri: nextKind.needsMask ? current.maskUri : "",
    }));
  }

  function applyAsset(asset: AssetRecord) {
    setSelectedAssetId(asset.asset_id);
    setJobForm((current) => ({
      ...current,
      assetId: asset.asset_id,
      inputUri: asset.local_path,
    }));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await login(loginForm);
      setStoredToken(response.token);
      setToken(response.token);
      setUser(response.user);
      setMessage(`Authenticated as ${response.user.display_name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to authenticate.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !file) {
      setError("Authenticate and choose a file before uploading.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const asset = await uploadAsset(file, token);
      setAssets((current) => [asset, ...current]);
      setSelectedAssetId(asset.asset_id);
      setJobForm((current) => ({
        ...current,
        assetId: asset.asset_id,
        inputUri: asset.local_path,
      }));
      setFile(null);
      setMessage(`Uploaded ${asset.original_name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Authenticate before creating a job.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await createJob(
        {
          kind: jobForm.kind,
          asset_id: jobForm.assetId || null,
          source_asset_id: jobForm.sourceAssetId || null,
          mask_asset_id: jobForm.maskAssetId || null,
          input_uri: jobForm.assetId ? null : jobForm.inputUri || null,
          source_input_uri: jobForm.sourceAssetId ? null : jobForm.sourceInputUri || null,
          mask_uri: jobForm.maskAssetId ? null : jobForm.maskUri || null,
          output_format: jobForm.outputFormat || null,
          options: {
            engine: jobForm.engine,
            ...(jobForm.scale ? { scale: jobForm.scale } : {}),
            ...(jobForm.fps ? { fps: jobForm.fps } : {}),
          },
        },
        token,
      );
      setJobs((current) => mergeJob(current, response.job));
      setSelectedJobId(response.job.job_id);
      setMessage(`Queued ${formatKind(response.job.kind)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the job.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(assetId: string) {
    if (!token) {
      return;
    }
    try {
      await downloadAsset(assetId, token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Download failed.");
    }
  }

  function logout() {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setMessage("Session cleared.");
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="stage-orb stage-orb-one" />
      <div className="stage-orb stage-orb-two" />
      <div className="stage-grid" />

      <main className="relative mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
        <section className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
          <article className="surface animate-rise">
            <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[radial-gradient(circle,_rgba(230,105,66,0.24),_transparent_70%)] blur-3xl" />
            <div className="absolute bottom-[-4rem] left-[-2rem] h-44 w-44 rounded-full bg-[radial-gradient(circle,_rgba(24,119,107,0.18),_transparent_70%)] blur-3xl" />

            <div className="relative">
              <span className="eyebrow">Vision Suite</span>
              <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl xl:text-6xl">
                A modern operator desk for restoration, motion, and media AI delivery.
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                The workspace now behaves like a command surface: live filtering, focused job
                inspection, asset-led composition, and clearer orchestration feedback.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-4">
                <div className="metric-tile">
                  <p className="metric-label">Session</p>
                  <p className="metric-value">{user ? user.role : "Guest"}</p>
                  <p className="metric-meta">
                    {user ? "Authenticated control privileges" : "Waiting for sign-in"}
                  </p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Active jobs</p>
                  <p className="metric-value">{activeJobs}</p>
                  <p className="metric-meta">{completedJobs} successful outputs registered</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Coverage</p>
                  <p className="metric-value">
                    {capabilities?.supported_jobs.length ?? jobKinds.length}
                  </p>
                  <p className="metric-meta">Pipelines visible from the catalog</p>
                </div>
                <div className="metric-tile">
                  <p className="metric-label">Momentum</p>
                  <p className="metric-value">{queueMomentum}%</p>
                  <p className="metric-meta">Average completion across the queue</p>
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {productSurfaces.map((surface) => (
                  <div
                    key={surface.name}
                    className="rounded-full border border-white/70 bg-white/66 px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_12px_30px_rgba(16,31,42,0.06)]"
                  >
                    {surface.name}
                  </div>
                ))}
              </div>

              {message ? (
                <div className="mt-6 rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50/85 px-5 py-4 text-sm text-emerald-950">
                  {message}
                </div>
              ) : null}
              {error ? (
                <div className="mt-4 rounded-[1.5rem] border border-rose-200/80 bg-rose-50/90 px-5 py-4 text-sm text-rose-950">
                  {error}
                </div>
              ) : null}
            </div>
          </article>

          <aside className="surface-dark animate-rise" style={{ animationDelay: "80ms" }}>
            <div className="relative space-y-6">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow bg-white/10 text-white/70">Live Relay</span>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.22em] text-white/70">
                  <span
                    className={classNames(
                      "signal-dot",
                      eventsLive
                        ? "bg-emerald-300 shadow-[0_0_0_6px_rgba(110,231,183,0.14)]"
                        : "bg-white/40",
                    )}
                  />
                  {eventsLive ? "streaming" : "idle"}
                </div>
              </div>

              <div className="soft-card-dark">
                <p className="detail-label">API endpoint</p>
                <p className="detail-value break-all">{API_BASE_LABEL}</p>
              </div>
              <div className="soft-card-dark">
                <p className="detail-label">Current session</p>
                <p className="detail-value">{user ? user.email : "No active session"}</p>
              </div>
              <div className="soft-card-dark">
                <p className="detail-label">Latest output</p>
                <p className="detail-value">
                  {latestOutput ? latestOutput.original_name : "No output ready yet"}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-white/10 px-4 py-5">
                <p className="detail-label">Delivery flow</p>
                <div className="mt-4 space-y-3">
                  {serviceFlow.map((step, index) => (
                    <div key={step} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-[11px] font-semibold text-white/80">
                        {index + 1}
                      </span>
                      <p className="text-sm leading-6 text-white/76">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              {latestOutput && token ? (
                <button
                  type="button"
                  onClick={() => void handleDownload(latestOutput.asset_id)}
                  className="button-secondary border-white/20 bg-white/10 text-white hover:bg-white/18"
                >
                  Download latest render
                </button>
              ) : null}
            </div>
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.88fr,0.98fr,1.14fr]">
          <article className="surface animate-rise" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-kicker">Session</p>
                <h2 className="section-title">Operator identity</h2>
              </div>
              {user ? (
                <button type="button" onClick={logout} className="button-secondary">
                  Sign out
                </button>
              ) : null}
            </div>

            {!user ? (
              <form className="mt-6 space-y-4" onSubmit={handleLogin}>
                <input
                  className="field"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="Operator email"
                />
                <input
                  type="password"
                  className="field"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="Password"
                />
                <button type="submit" disabled={busy} className="button-primary w-full">
                  {busy ? "Authenticating..." : "Enter the control room"}
                </button>
              </form>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="soft-card">
                  <p className="detail-label">Display name</p>
                  <p className="detail-value text-slate-950">{user.display_name}</p>
                </div>
                <div className="soft-card">
                  <p className="detail-label">Identity</p>
                  <p className="detail-value text-slate-950">{user.email}</p>
                </div>
                <div className="soft-card">
                  <p className="detail-label">Scope</p>
                  <p className="detail-value text-slate-950">{user.role}</p>
                </div>
              </div>
            )}
          </article>

          <article className="surface animate-rise" style={{ animationDelay: "180ms" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-kicker">Assets</p>
                <h2 className="section-title">Asset staging</h2>
              </div>
              <span className="rounded-full border border-slate-200/80 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {assets.length} tracked
              </span>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleUpload}>
              <label className="upload-shell">
                <span className="text-sm font-semibold text-slate-900">
                  Register a source file for pipeline work
                </span>
                <input
                  type="file"
                  className="mt-4 block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-[rgba(24,119,107,0.14)] file:px-4 file:py-2 file:font-semibold file:text-[var(--accent-cool)]"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <button type="submit" disabled={!user || busy} className="button-primary w-full">
                {busy ? "Uploading..." : "Upload asset"}
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-2">
              {assetFilterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAssetFilter(option.value)}
                  className={classNames(
                    "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition duration-200",
                    assetFilter === option.value
                      ? "border-[rgba(24,119,107,0.26)] bg-[rgba(24,119,107,0.10)] text-[var(--accent-cool)] shadow-[0_12px_28px_rgba(24,119,107,0.10)]"
                      : "border-slate-200/80 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              {visibleAssets.slice(0, 4).map((asset) => (
                <button
                  key={asset.asset_id}
                  type="button"
                  onClick={() => applyAsset(asset)}
                  className={classNames(
                    "soft-card block w-full text-left transition duration-200",
                    selectedAsset?.asset_id === asset.asset_id
                      ? "border-[rgba(24,119,107,0.24)] bg-[rgba(24,119,107,0.08)] shadow-[0_18px_38px_rgba(24,119,107,0.08)]"
                      : "hover:border-slate-300 hover:bg-white/92",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-950">{asset.original_name}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                    {formatAssetKind(asset.kind)} / {formatBytes(asset.size_bytes)}
                  </p>
                  <p className="mt-3 break-all text-sm leading-6 text-slate-500">
                    {asset.local_path}
                  </p>
                </button>
              ))}
            </div>
          </article>

          <article className="surface animate-rise" style={{ animationDelay: "240ms" }}>
            <div>
              <p className="section-kicker">Composer</p>
              <h2 className="section-title">Queue a polished pipeline run</h2>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {jobKinds.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => applyKind(item)}
                  className={classNames(
                    "rounded-[1.35rem] border px-4 py-4 text-left transition duration-200",
                    item.value === jobForm.kind
                      ? "border-[rgba(24,119,107,0.34)] bg-[rgba(24,119,107,0.10)] shadow-[0_18px_36px_rgba(24,119,107,0.10)]"
                      : "border-slate-200/80 bg-white/62 hover:border-slate-300 hover:bg-white/90",
                  )}
                >
                  <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{item.summary}</p>
                </button>
              ))}
            </div>

            <form className="mt-5 space-y-4" onSubmit={handleCreateJob}>
              <div className="soft-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="detail-label">Selected pipeline</p>
                    <p className="detail-value text-slate-950">{selectedKind.label}</p>
                  </div>
                  <span
                    className={classNames(
                      "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]",
                      selectedKindSupported
                        ? "border-emerald-300/70 bg-emerald-100/80 text-emerald-950"
                        : "border-amber-300/70 bg-amber-100/80 text-amber-950",
                    )}
                  >
                    {selectedKindSupported ? "catalog ready" : "custom lane"}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{selectedKind.summary}</p>
              </div>

              <select
                className="field"
                value={jobForm.assetId}
                onChange={(event) => {
                  const nextAsset =
                    assets.find((asset) => asset.asset_id === event.target.value) ?? null;
                  setSelectedAssetId(nextAsset?.asset_id ?? null);
                  setJobForm((current) => ({
                    ...current,
                    assetId: event.target.value,
                    inputUri: nextAsset?.local_path ?? current.inputUri,
                  }));
                }}
              >
                <option value="">Manual path or URI</option>
                {assets.map((asset) => (
                  <option key={asset.asset_id} value={asset.asset_id}>
                    {asset.original_name}
                  </option>
                ))}
              </select>

              <input
                className="field"
                value={jobForm.inputUri}
                onChange={(event) =>
                  setJobForm((current) => ({ ...current, inputUri: event.target.value }))
                }
                placeholder="Fallback path or URI"
              />

              {selectedKind.needsSource ? (
                <>
                  <select
                    className="field"
                    value={jobForm.sourceAssetId}
                    onChange={(event) => {
                      const nextAsset =
                        assets.find((asset) => asset.asset_id === event.target.value) ?? null;
                      setJobForm((current) => ({
                        ...current,
                        sourceAssetId: event.target.value,
                        sourceInputUri: nextAsset?.local_path ?? current.sourceInputUri,
                      }));
                    }}
                  >
                    <option value="">Source face asset</option>
                    {inputAssets.map((asset) => (
                      <option key={asset.asset_id} value={asset.asset_id}>
                        {asset.original_name}
                      </option>
                    ))}
                  </select>

                  <input
                    className="field"
                    value={jobForm.sourceInputUri}
                    onChange={(event) =>
                      setJobForm((current) => ({
                        ...current,
                        sourceInputUri: event.target.value,
                      }))
                    }
                    placeholder="Fallback source face path or URI"
                  />
                </>
              ) : null}

              {selectedKind.needsMask ? (
                <>
                  <select
                    className="field"
                    value={jobForm.maskAssetId}
                    onChange={(event) => {
                      const nextAsset =
                        assets.find((asset) => asset.asset_id === event.target.value) ?? null;
                      setJobForm((current) => ({
                        ...current,
                        maskAssetId: event.target.value,
                        maskUri: nextAsset?.local_path ?? current.maskUri,
                      }));
                    }}
                  >
                    <option value="">Mask asset</option>
                    {inputAssets.map((asset) => (
                      <option key={asset.asset_id} value={asset.asset_id}>
                        {asset.original_name}
                      </option>
                    ))}
                  </select>

                  <input
                    className="field"
                    value={jobForm.maskUri}
                    onChange={(event) =>
                      setJobForm((current) => ({ ...current, maskUri: event.target.value }))
                    }
                    placeholder="Fallback mask path or URI"
                  />
                </>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  className="field"
                  value={jobForm.engine}
                  onChange={(event) =>
                    setJobForm((current) => ({ ...current, engine: event.target.value }))
                  }
                  placeholder="Execution engine"
                />
                {selectedKind.supportsScale ? (
                  <input
                    className="field"
                    value={jobForm.scale}
                    onChange={(event) =>
                      setJobForm((current) => ({ ...current, scale: event.target.value }))
                    }
                    placeholder="Scale"
                  />
                ) : selectedKind.supportsFps ? (
                  <input
                    className="field"
                    value={jobForm.fps}
                    onChange={(event) =>
                      setJobForm((current) => ({ ...current, fps: event.target.value }))
                    }
                    placeholder="Target FPS"
                  />
                ) : (
                  <div className="soft-card">
                    <p className="detail-label">Runtime profile</p>
                    <p className="detail-value text-slate-950">Single-pass execution</p>
                  </div>
                )}
              </div>

              {(selectedKind.needsSource || selectedKind.needsMask || selectedKind.supportsFps) ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="soft-card">
                    <p className="detail-label">Source input</p>
                    <p className="detail-value text-slate-950">
                      {selectedKind.needsSource
                        ? selectedSourceAsset?.original_name || jobForm.sourceInputUri || "Required"
                        : "Not used"}
                    </p>
                  </div>
                  <div className="soft-card">
                    <p className="detail-label">Mask input</p>
                    <p className="detail-value text-slate-950">
                      {selectedKind.needsMask
                        ? selectedMaskAsset?.original_name || jobForm.maskUri || "Required"
                        : "Not used"}
                    </p>
                  </div>
                  <div className="soft-card">
                    <p className="detail-label">Motion target</p>
                    <p className="detail-value text-slate-950">
                      {selectedKind.supportsFps ? `${jobForm.fps || "60"} FPS` : "Not used"}
                    </p>
                  </div>
                </div>
              ) : null}

              <button type="submit" disabled={!user || busy} className="button-primary w-full">
                {busy ? "Queuing..." : "Launch pipeline"}
              </button>
            </form>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.12fr,0.88fr]">
          <article className="surface animate-rise" style={{ animationDelay: "300ms" }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="section-kicker">Operations</p>
                <h2 className="section-title">Live execution queue</h2>
              </div>

              <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[24rem]">
                <div className="flex flex-wrap gap-2">
                  {jobFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setJobFilter(option.value)}
                      className={classNames(
                        "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition duration-200",
                        jobFilter === option.value
                          ? "border-[rgba(24,119,107,0.26)] bg-[rgba(24,119,107,0.10)] text-[var(--accent-cool)] shadow-[0_12px_28px_rgba(24,119,107,0.10)]"
                          : "border-slate-200/80 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <input
                  className="field"
                  value={jobSearch}
                  onChange={(event) => setJobSearch(event.target.value)}
                  placeholder="Search by lane, path, engine, or message"
                />
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {visibleJobs.length === 0 ? (
                <div className="empty-shell">
                  No jobs match the current filters. Adjust the search or launch a new pipeline.
                </div>
              ) : (
                visibleJobs.map((job) => (
                  <button
                    key={job.job_id}
                    type="button"
                    onClick={() => setSelectedJobId(job.job_id)}
                    className={classNames(
                      "job-shell block w-full text-left transition duration-200",
                      selectedJob?.job_id === job.job_id
                        ? "border-[rgba(24,119,107,0.24)] bg-[rgba(24,119,107,0.08)] shadow-[0_20px_42px_rgba(24,119,107,0.08)]"
                        : "hover:border-slate-300 hover:bg-white/90",
                    )}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                          {formatSubmittedAt(job.submitted_at_epoch_ms)}
                        </p>
                        <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
                          {formatKind(job.kind)}
                        </h3>
                        <p className="mt-3 break-all text-sm leading-7 text-slate-500">
                          {job.input_uri}
                        </p>
                      </div>

                      <div className="flex flex-col items-start gap-3 lg:items-end">
                        <span
                          className={classNames(
                            "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                            jobStatusTone(job.status),
                          )}
                        >
                          {job.status}
                        </span>
                        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          {job.options.engine ?? "default engine"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5">
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.max(6, job.progress)}%` }}
                        />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm text-slate-500">
                        <span>{job.progress}% complete</span>
                        <span>{job.output_format ?? "source format"}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </article>

          <div className="flex flex-col gap-6">
            <article className="surface animate-rise" style={{ animationDelay: "360ms" }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="section-kicker">Focus</p>
                  <h2 className="section-title">Selected job</h2>
                </div>
                {selectedJob ? (
                  <span
                    className={classNames(
                      "inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
                      jobStatusTone(selectedJob.status),
                    )}
                  >
                    {selectedJob.status}
                  </span>
                ) : null}
              </div>

              {!selectedJob ? (
                <div className="mt-5 empty-shell">
                  Pick a job in the queue to inspect its route and progress.
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <div className="soft-card">
                    <p className="detail-label">Lane</p>
                    <p className="detail-value text-slate-950">{formatKind(selectedJob.kind)}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Submitted {formatSubmittedAt(selectedJob.submitted_at_epoch_ms)}
                    </p>
                  </div>

                  <div className="soft-card">
                    <p className="detail-label">Input path</p>
                    <p className="detail-value break-all text-slate-950">{selectedJob.input_uri}</p>
                  </div>

                  {(selectedJob.source_uri || selectedJob.mask_uri || selectedJob.options.fps) ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="soft-card">
                        <p className="detail-label">Source</p>
                        <p className="detail-value break-all text-slate-950">
                          {selectedJob.source_uri ?? "Not used"}
                        </p>
                      </div>
                      <div className="soft-card">
                        <p className="detail-label">Mask</p>
                        <p className="detail-value break-all text-slate-950">
                          {selectedJob.mask_uri ?? "Not used"}
                        </p>
                      </div>
                      <div className="soft-card">
                        <p className="detail-label">Target FPS</p>
                        <p className="detail-value text-slate-950">
                          {selectedJob.options.fps ? `${selectedJob.options.fps} FPS` : "Not used"}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {selectedJob.message ? (
                    <div className="rounded-[1.35rem] border border-slate-200/80 bg-white/88 px-4 py-4 text-sm leading-7 text-slate-700">
                      {selectedJob.message}
                    </div>
                  ) : null}

                  {selectedJob.output_asset_id && token ? (
                    <button
                      type="button"
                      onClick={() => void handleDownload(selectedJob.output_asset_id!)}
                      className="button-primary w-full"
                    >
                      Download focused output
                    </button>
                  ) : null}
                </div>
              )}
            </article>

            <article className="surface animate-rise" style={{ animationDelay: "420ms" }}>
              <div>
                <p className="section-kicker">Surfaces</p>
                <h2 className="section-title">Client lanes</h2>
              </div>

              <div className="mt-5 space-y-3">
                {productSurfaces.map((surface) => (
                  <div key={surface.name} className="soft-card">
                    <p className="text-sm font-semibold text-slate-950">{surface.name}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{surface.stack}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{surface.summary}</p>
                  </div>
                ))}
                {pipelines.slice(0, 2).map((pipeline) => (
                  <div key={pipeline.title} className="soft-card">
                    <p className="text-sm font-semibold text-slate-950">{pipeline.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{pipeline.engines}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
