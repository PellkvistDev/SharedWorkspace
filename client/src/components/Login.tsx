import { useState } from "react";
import { api, setCsrf } from "../lib/api";

export default function Login({ onAuth }: { onAuth: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string; csrf?: string }>("/api/auth/login", {
        password,
      });
      if (res.ok) {
        setCsrf(res.csrf || null);
        onAuth();
      } else {
        setError(res.error || "Login failed");
      }
    } catch (err: any) {
      setError(err?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="panel w-full max-w-sm p-7 space-y-5"
      >
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">WorkspaceOS</h1>
          <p className="text-sm text-secondary">Sign in to your personal workspace.</p>
        </div>
        <input
          type="password"
          className="input"
          placeholder="Password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button className="btn btn-primary w-full justify-center py-2.5" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
