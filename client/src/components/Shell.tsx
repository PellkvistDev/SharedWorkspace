import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "../lib/api";
import { toggleTheme, getTheme } from "../lib/theme";
import FileExplorer from "./FileExplorer";
import Terminal from "./Terminal";
import ClaudeChat from "./ClaudeChat";
import Browser from "./Browser";

type Tab = "files" | "claude" | "terminal" | "browser";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "files", label: "Files", icon: "📁" },
  { id: "claude", label: "Claude", icon: "✦" },
  { id: "terminal", label: "Terminal", icon: "▢" },
  { id: "browser", label: "Browser", icon: "◐" },
];

export default function Shell({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("files");
  const [theme, setTheme] = useState(getTheme());

  useEffect(() => {
    const onResize = () => {/* placeholder for future responsive logic */};
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {}
    onLogout();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar (desktop) */}
      <header className="hidden md:flex items-center justify-between border-b border-ink-800 px-4 h-12">
        <div className="flex items-center gap-1">
          <span className="font-semibold tracking-tight text-sm mr-3">WorkspaceOS</span>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "btn btn-ghost text-sm",
                tab === t.id && "bg-ink-800 dark:bg-ink-800"
              )}
            >
              <span className="opacity-70">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => {
              toggleTheme();
              setTheme(getTheme());
            }}
            title="Toggle theme"
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
          <button className="btn btn-ghost text-xs" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {/* Main pane */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={clsx("h-full", tab === "files" ? "" : "hidden")}>
          <FileExplorer />
        </div>
        <div className={clsx("h-full", tab === "claude" ? "" : "hidden")}>
          <ClaudeChat active={tab === "claude"} />
        </div>
        <div className={clsx("h-full", tab === "terminal" ? "" : "hidden")}>
          <Terminal active={tab === "terminal"} />
        </div>
        <div className={clsx("h-full", tab === "browser" ? "" : "hidden")}>
          <Browser />
        </div>
      </main>

      {/* Bottom tab bar (mobile) */}
      <nav className="md:hidden flex border-t border-ink-800 bg-ink-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex-1 py-2 text-xs flex flex-col items-center gap-0.5",
              tab === t.id ? "text-ink-100" : "text-ink-400"
            )}
          >
            <span className="text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <button
          onClick={logout}
          className="flex-1 py-2 text-xs flex flex-col items-center gap-0.5 text-ink-400"
        >
          <span className="text-base">⎋</span>
          Sign out
        </button>
      </nav>
    </div>
  );
}
