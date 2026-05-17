import { useEffect, useState } from "react";
import { api, setCsrf } from "./lib/api";
import { initTheme } from "./lib/theme";
import Login from "./components/Login";
import Shell from "./components/Shell";

interface AuthStatus {
  authenticated: boolean;
  user?: { id: string };
  csrf?: string;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    initTheme();
    (async () => {
      try {
        const s = await api.get<AuthStatus>("/api/auth/status");
        if (s.authenticated) {
          setCsrf(s.csrf || null);
          setAuthed(true);
        }
      } catch {
        /* not auth'd */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    );
  }

  if (!authed) {
    return <Login onAuth={() => setAuthed(true)} />;
  }

  return <Shell onLogout={() => setAuthed(false)} />;
}
