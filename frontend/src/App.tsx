import { type FormEvent, useEffect, useState } from "react";

import {
  API_BASE_URL,
  createJob,
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
import { pipelines } from "./lib/catalog";
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
  outputFormat: string;
  scale: string;
  engine: string;
};

const defaultLogin: LoginForm = {
  email: "admin@vision.local",
  password: "vision123",
};

const defaultJob: JobForm = {
  kind: "image_upscale",
  assetId: "",
  inputUri: "",
  outputFormat: "png",
  scale: "4",
  engine: "ffmpeg",
};

const jobKinds: Array<{ value: JobKind; label: string; engine: string; format: string }> = [
  { value: "image_upscale", label: "Image Upscale", engine: "ffmpeg", format: "png" },
  { value: "face_enhancement", label: "Face Enhancement", engine: "gfpgan", format: "png" },
  { value: "background_removal", label: "Background Removal", engine: "u2net", format: "png" },
  { value: "inpainting", label: "Inpainting", engine: "lama", format: "png" },
  { value: "face_swap", label: "Face Swap", engine: "insightface", format: "png" },
  { value: "video_upscale", label: "Video Upscale", engine: "ffmpeg", format: "mp4" },
  { value: "frame_interpolation", label: "Frame Interpolation", engine: "rife", format: "mp4" },
  { value: "video_transcode", label: "Video Transcode", engine: "ffmpeg", format: "mp4" },
];

function formatKind(kind: JobKind) {
  return kind
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function sortJobs(items: JobRecord[]) {
  return [...items].sort((a, b) => b.submitted_at_epoch_ms - a.submitted_at_epoch_ms);
}

function mergeJob(items: JobRecord[], next: JobRecord) {
  return sortJobs([next, ...items.filter((job) => job.job_id !== next.job_id)]);
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
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [eventsLive, setEventsLive] = useState(false);
  const [busy, setBusy] = useState(false);

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
        setMessage(event.job.message ?? `${formatKind(event.job.kind)} updated.`);
        setEventsLive(true);
      },
      () => setEventsLive(false),
    );

    return unsubscribe;
  }, [token]);

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
          input_uri: jobForm.assetId ? null : jobForm.inputUri || null,
          output_format: jobForm.outputFormat || null,
          options: {
            scale: jobForm.scale || "4",
            engine: jobForm.engine,
          },
        },
        token,
      );
      setJobs((current) => mergeJob(current, response.job));
      setMessage(`Queued ${formatKind(response.job.kind)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the job.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setMessage("Session cleared.");
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="grid gap-6 rounded-[2rem] border border-white/70 bg-white/85 p-7 shadow-[0_24px_80px_rgba(20,33,61,0.12)] lg:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4">
            <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-orange-700">
              Vision Suite
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900 lg:text-5xl">
              Login, upload, queue, stream.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-slate-600">
              The web cockpit is now connected to the Rust backend for authentication, persistent
              uploads, job creation, and live progress streaming.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl bg-slate-900 p-4 text-white">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Session</p>
                <p className="mt-3 text-2xl font-semibold">{user ? user.role : "guest"}</p>
              </div>
              <div className="rounded-3xl bg-cyan-100 p-4 text-slate-900">
                <p className="text-xs uppercase tracking-[0.16em] text-cyan-700">Assets</p>
                <p className="mt-3 text-2xl font-semibold">{assets.length}</p>
              </div>
              <div className="rounded-3xl bg-amber-100 p-4 text-slate-900">
                <p className="text-xs uppercase tracking-[0.16em] text-amber-700">Jobs</p>
                <p className="mt-3 text-2xl font-semibold">{jobs.length}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] bg-slate-900 p-6 text-white">
            <p className="text-sm uppercase tracking-[0.2em] text-slate-300">Live state</p>
            <p className="mt-4 text-lg text-slate-200">API: {API_BASE_URL}</p>
            <p className="mt-3 text-lg text-slate-200">Events: {eventsLive ? "connected" : "idle"}</p>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              {capabilities
                ? `${capabilities.supported_jobs.length} supported job types available.`
                : "Capabilities are loading."}
            </p>
            {message ? (
              <div className="mt-5 rounded-2xl bg-white/10 px-4 py-3 text-sm text-slate-100">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="mt-4 rounded-2xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Auth</h2>
              {user ? (
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Sign out
                </button>
              ) : null}
            </div>
            {!user ? (
              <form className="mt-6 space-y-4" onSubmit={handleLogin}>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
                <input
                  type="password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                >
                  {busy ? "Working..." : "Sign in"}
                </button>
              </form>
            ) : (
              <div className="mt-6 rounded-[1.5rem] bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                <p className="font-semibold text-slate-900">{user.display_name}</p>
                <p>{user.email}</p>
                <p>Role: {user.role}</p>
              </div>
            )}
          </article>

          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <h2 className="text-2xl font-semibold text-slate-900">Upload</h2>
            <form className="mt-6 space-y-4" onSubmit={handleUpload}>
              <input
                type="file"
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <button
                type="submit"
                disabled={!user || busy}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-400"
              >
                Upload asset
              </button>
            </form>
            <div className="mt-6 space-y-3">
              {assets.slice(0, 3).map((asset) => (
                <div key={asset.asset_id} className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">{asset.original_name}</p>
                  <p className="mt-2 break-all text-sm text-slate-600">{asset.local_path}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <h2 className="text-2xl font-semibold text-slate-900">Queue Job</h2>
            <form className="mt-6 space-y-4" onSubmit={handleCreateJob}>
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                value={jobForm.kind}
                onChange={(event) => {
                  const next = jobKinds.find(
                    (item) => item.value === (event.target.value as JobKind),
                  );
                  setJobForm((current) => ({
                    ...current,
                    kind: event.target.value as JobKind,
                    engine: next?.engine ?? current.engine,
                    outputFormat: next?.format ?? current.outputFormat,
                  }));
                }}
              >
                {jobKinds.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                value={jobForm.assetId}
                onChange={(event) =>
                  setJobForm((current) => ({
                    ...current,
                    assetId: event.target.value,
                    inputUri:
                      assets.find((asset) => asset.asset_id === event.target.value)?.local_path ??
                      current.inputUri,
                  }))
                }
              >
                <option value="">Manual path / URI</option>
                {assets.map((asset) => (
                  <option key={asset.asset_id} value={asset.asset_id}>
                    {asset.original_name}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                value={jobForm.inputUri}
                onChange={(event) =>
                  setJobForm((current) => ({ ...current, inputUri: event.target.value }))
                }
                placeholder="Fallback path or URI"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={jobForm.engine}
                  onChange={(event) =>
                    setJobForm((current) => ({ ...current, engine: event.target.value }))
                  }
                  placeholder="engine"
                />
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={jobForm.scale}
                  onChange={(event) =>
                    setJobForm((current) => ({ ...current, scale: event.target.value }))
                  }
                  placeholder="scale"
                />
              </div>
              <button
                type="submit"
                disabled={!user || busy}
                className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-400"
              >
                Create job
              </button>
            </form>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Job Monitor</h2>
              <span className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                {jobs.length} jobs
              </span>
            </div>
            <div className="mt-6 space-y-4">
              {jobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                  No jobs yet.
                </div>
              ) : (
                jobs.map((job) => (
                  <article key={job.job_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {formatSubmittedAt(job.submitted_at_epoch_ms)}
                        </p>
                        <h3 className="mt-3 text-xl font-semibold text-slate-900">
                          {formatKind(job.kind)}
                        </h3>
                        <p className="mt-2 break-all text-sm text-slate-600">{job.input_uri}</p>
                      </div>
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                        {job.status}
                      </span>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-slate-900"
                        style={{ width: `${Math.max(6, job.progress)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {job.progress}% - {job.options.engine ?? "default"}
                    </p>
                    {job.message ? (
                      <div className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700">
                        {job.message}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </article>

          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
            <h2 className="text-2xl font-semibold text-slate-900">Model Services</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              FastAPI accepts worker dispatches and can call command templates for Real-ESRGAN,
              GFPGAN, LaMa, RIFE, InsightFace, U2Net, and FFmpeg.
            </p>
            <div className="mt-6 space-y-3">
              {pipelines.map((pipeline) => (
                <div key={pipeline.title} className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold text-slate-900">{pipeline.title}</p>
                  <p className="mt-2 text-sm text-slate-600">{pipeline.engines}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;
