import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type AppInfo = {
  name: string;
  shell: string;
  transport: string;
};

type UserProfile = {
  display_name: string;
  email: string;
  role: string;
};

type JobRecord = {
  job_id: string;
  kind: string;
  status: string;
  progress: number;
  input_uri: string;
  message?: string | null;
};

const API_BASE_URL =
  import.meta.env.VITE_VISION_API_BASE_URL ?? "http://localhost:8080";

const TOKEN_KEY = "vision-desktop-token";

async function readJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}`);
  }

  return (await response.json()) as T;
}

function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [token, setToken] = useState<string | null>(() => window.localStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState("admin@vision.local");
  const [password, setPassword] = useState("vision123");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<AppInfo>("app_info").then(setAppInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setJobs([]);
      return;
    }

    Promise.all([
      readJson<UserProfile>("/api/v1/auth/me", token),
      readJson<JobRecord[]>("/api/v1/jobs", token),
    ])
      .then(([nextUser, nextJobs]) => {
        setUser(nextUser);
        setJobs(nextJobs);
      })
      .catch(() => {
        setError("Unable to reach the backend.");
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      });
  }, [token]);

  async function signIn() {
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error("Authentication failed.");
      }

      const payload = (await response.json()) as { token: string; user: UserProfile };
      window.localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setUser(payload.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    }
  }

  function signOut() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <section className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
          <div className="rounded-[2rem] border border-white/70 bg-white/85 p-7 shadow-[0_22px_70px_rgba(16,42,67,0.12)]">
            <p className="text-sm uppercase tracking-[0.24em] text-teal-700">Vision Desktop</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
              Native access to the same backend queue.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              The Tauri shell now authenticates against the Rust API and reads the persistent job
              queue instead of staying fully static.
            </p>
          </div>

          <aside className="rounded-[2rem] bg-slate-900 p-7 text-white shadow-[0_22px_70px_rgba(16,42,67,0.18)]">
            <p className="text-sm uppercase tracking-[0.24em] text-slate-300">Shell bridge</p>
            <div className="mt-5 space-y-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm text-slate-200">
                {appInfo ? `${appInfo.name} over ${appInfo.transport}` : "Waiting for Tauri bridge"}
              </p>
              <p className="text-sm text-slate-300">API: {API_BASE_URL}</p>
              <p className="text-sm text-slate-300">Session: {user ? user.email : "none"}</p>
            </div>
          </aside>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr,1.2fr]">
          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-7 shadow-[0_18px_50px_rgba(16,42,67,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Desktop Login</h2>
              {user ? (
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Sign out
                </button>
              ) : null}
            </div>
            {!user ? (
              <div className="mt-6 space-y-4">
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <input
                  type="password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={signIn}
                  className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                >
                  Connect to backend
                </button>
              </div>
            ) : (
              <div className="mt-6 rounded-[1.5rem] bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                <p className="font-semibold text-slate-900">{user.display_name}</p>
                <p>{user.email}</p>
                <p>Role: {user.role}</p>
              </div>
            )}
            {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
          </article>

          <article className="rounded-[2rem] border border-slate-200/80 bg-white/80 p-7 shadow-[0_18px_50px_rgba(16,42,67,0.08)]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-slate-900">Queued Jobs</h2>
              <span className="rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                {jobs.length} jobs
              </span>
            </div>
            <div className="mt-6 space-y-4">
              {jobs.map((job) => (
                <article key={job.job_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{job.kind}</h3>
                      <p className="mt-2 break-all text-sm text-slate-600">{job.input_uri}</p>
                    </div>
                    <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(6, job.progress)}%` }} />
                  </div>
                  {job.message ? <p className="mt-3 text-sm text-slate-700">{job.message}</p> : null}
                </article>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;
