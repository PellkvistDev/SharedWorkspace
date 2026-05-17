import { useEffect, useState } from "react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Bookmark } from "@workspaceos/shared";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function safeHostname(u: string): string {
  try { return new URL(u).hostname; } catch { return u; }
}

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (/^https?:\/\//i.test(t)) return true;
  if (/\s/.test(t)) return false;
  return /^[^\s]+\.[^\s]+$/.test(t) || /^localhost(:\d+)?(\/|$)/.test(t);
}

type Mode = "start" | "page" | "search";

interface TabState {
  id: string;
  url: string;
  history: string[]; // "<url>" or "search:<query>"
  historyIdx: number;
  mode: Mode;
  proxied: boolean;
  searchQuery: string;
  searchResults: SearchResult[] | null;
  searchBusy: boolean;
  searchError: string | null;
}

function emptyTab(): TabState {
  return {
    id: crypto.randomUUID(),
    url: "",
    history: [],
    historyIdx: -1,
    mode: "start",
    proxied: false,
    searchQuery: "",
    searchResults: null,
    searchBusy: false,
    searchError: null,
  };
}

function tabLabel(t: TabState): string {
  if (t.mode === "search") return t.searchQuery || "Search";
  if (t.mode === "page") return safeHostname(t.url) || "Page";
  return "New tab";
}

export default function Browser() {
  const [tabs, setTabs] = useState<TabState[]>(() => [emptyTab()]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? "");
  const [inputUrl, setInputUrl] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const updateTab = (id: string, patch: Partial<TabState>) =>
    setTabs((arr) => arr.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Sync the address-bar input to the active tab whenever it changes.
  useEffect(() => {
    if (!active) return;
    if (active.mode === "search") setInputUrl(active.searchQuery);
    else if (active.mode === "page") setInputUrl(active.url);
    else setInputUrl("");
  }, [activeId, active?.mode, active?.url, active?.searchQuery]);

  useEffect(() => {
    (async () => {
      try { setBookmarks(await api.get<Bookmark[]>("/api/bookmarks")); } catch {}
    })();
  }, []);
  const reloadBookmarks = async () => {
    try { setBookmarks(await api.get<Bookmark[]>("/api/bookmarks")); } catch {}
  };

  const runSearchOn = async (tabId: string, q: string) => {
    updateTab(tabId, {
      mode: "search",
      searchQuery: q,
      searchBusy: true,
      searchError: null,
      searchResults: null,
      proxied: false,
    });
    try {
      const r = await api.get<{ results: SearchResult[] }>(
        "/api/search?q=" + encodeURIComponent(q)
      );
      updateTab(tabId, { searchResults: r.results, searchBusy: false });
    } catch (e: any) {
      updateTab(tabId, { searchError: e.message || "Search failed", searchBusy: false });
    }
  };

  const navigateIn = (tabId: string, next: string, pushHistory = true) => {
    const target = next.trim();
    if (!target) return;
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    if (!looksLikeUrl(target)) {
      const newHist = pushHistory
        ? t.history.slice(0, t.historyIdx + 1).concat("search:" + target)
        : t.history;
      updateTab(tabId, {
        history: newHist,
        historyIdx: pushHistory ? newHist.length - 1 : t.historyIdx,
      });
      runSearchOn(tabId, target);
      return;
    }
    const fullUrl = /^https?:\/\//i.test(target) ? target : "https://" + target;
    const newHist = pushHistory
      ? t.history.slice(0, t.historyIdx + 1).concat(fullUrl)
      : t.history;
    updateTab(tabId, {
      url: fullUrl,
      mode: "page",
      proxied: false,
      history: newHist,
      historyIdx: pushHistory ? newHist.length - 1 : t.historyIdx,
    });
  };

  const goToHistory = (tabId: string, i: number) => {
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    const entry = t.history[i];
    if (!entry) return;
    if (entry.startsWith("search:")) {
      updateTab(tabId, { historyIdx: i, proxied: false });
      runSearchOn(tabId, entry.slice("search:".length));
    } else {
      updateTab(tabId, { historyIdx: i, url: entry, mode: "page", proxied: false });
    }
  };

  const back    = () => active && active.historyIdx > 0 && goToHistory(active.id, active.historyIdx - 1);
  const forward = () => active && active.historyIdx < active.history.length - 1 && goToHistory(active.id, active.historyIdx + 1);
  const refresh = () => {
    if (!active) return;
    if (active.mode === "search") runSearchOn(active.id, active.searchQuery);
    else if (active.mode === "page") updateTab(active.id, { url: active.url + "" }); // trigger remount? not needed since iframe key handles it
  };

  const newTab = () => {
    const t = emptyTab();
    setTabs((arr) => [...arr, t]);
    setActiveId(t.id);
  };
  const closeTab = (id: string) => {
    setTabs((arr) => {
      const filtered = arr.filter((t) => t.id !== id);
      const next = filtered.length ? filtered : [emptyTab()];
      if (id === activeId) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
  };

  const enableProxy = () => active && updateTab(active.id, { proxied: true });

  const addBookmark = async () => {
    if (!active || active.mode !== "page" || !active.url) return;
    const title = prompt("Bookmark title:", active.url);
    if (!title) return;
    try {
      await api.post("/api/bookmarks", { title, url: active.url });
      reloadBookmarks();
    } catch (e: any) { alert(e.message); }
  };
  const deleteBookmark = async (id: string) => {
    await api.del(`/api/bookmarks/${id}`);
    reloadBookmarks();
  };

  const saveCurrentUrl = async () => {
    if (!active) return;
    const target = prompt("Download URL to Workspace/downloads:", active.url || "");
    if (!target) return;
    try {
      const r = await api.post<{ ok: boolean; path?: string; error?: string }>(
        "/api/downloads/fetch", { url: target }
      );
      if (r.ok) alert(`Saved to /${r.path}`);
      else alert("Download failed: " + (r.error || "unknown"));
    } catch (e: any) {
      alert("Download failed: " + e.message);
    }
  };

  const displayedSrc = (t: TabState) => t.proxied ? `/api/proxy?url=${encodeURIComponent(t.url)}` : t.url;

  return (
    <div className="h-full flex flex-col">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-2 pt-1.5 pb-0 border-b border-white/10 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={clsx(
              "group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs cursor-pointer max-w-[200px]",
              t.id === activeId ? "bg-white/15 border-t border-x border-white/10" : "hover:bg-white/8 text-white/70"
            )}
          >
            <span className="truncate">{tabLabel(t)}</span>
            <button
              className="text-white/40 hover:text-white/90 leading-none"
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost text-xs ml-1" onClick={newTab} title="New tab">+</button>
      </div>

      {/* Address bar */}
      <div className="border-b border-white/10 px-2 py-2 flex items-center gap-1">
        <button className="btn btn-ghost text-xs" onClick={back} disabled={!active || active.historyIdx <= 0}>←</button>
        <button className="btn btn-ghost text-xs" onClick={forward} disabled={!active || active.historyIdx >= active.history.length - 1}>→</button>
        <button className="btn btn-ghost text-xs" onClick={refresh}>↻</button>
        <form
          className="flex-1 flex gap-1"
          onSubmit={(e) => { e.preventDefault(); if (active) navigateIn(active.id, inputUrl); }}
        >
          <input
            className="input flex-1 text-xs"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Search or enter URL"
          />
          <button className="btn btn-primary text-xs">Go</button>
        </form>
        <button className="btn btn-ghost text-xs" onClick={enableProxy} title="Use server-side proxy">
          {active?.proxied ? "Proxied" : "Proxy"}
        </button>
        <button className="btn btn-ghost text-xs" onClick={saveCurrentUrl} title="Save URL to Workspace/downloads">⬇</button>
        <button className="btn btn-ghost text-xs" onClick={addBookmark} title="Bookmark">★</button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex gap-1 px-2 py-1 border-b border-white/10 overflow-x-auto">
          {bookmarks.map((b) => (
            <div key={b.id} className="group flex items-center gap-1 rounded px-2 py-0.5 bg-white/10 text-xs whitespace-nowrap">
              <button onClick={() => active && navigateIn(active.id, b.url)} className="hover:underline">{b.title}</button>
              <button className="opacity-30 group-hover:opacity-100" onClick={() => deleteBookmark(b.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Tab content area: render all tabs, show only active */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "absolute inset-0",
              t.id !== activeId && "invisible pointer-events-none",
              t.proxied && t.mode === "page" && "ring-2 ring-amber-500/40 ring-inset"
            )}
          >
            {t.mode === "start" && (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
                <div className="text-2xl font-semibold tracking-tight">Search or enter URL</div>
                <div className="text-sm text-white/55 max-w-md">
                  Type words to search (DuckDuckGo, rendered here). Type a URL or domain to open
                  it in the embedded browser. Use the <span className="font-semibold">Proxy</span>
                  {" "}button for sites that refuse to be framed.
                </div>
              </div>
            )}

            {t.mode === "search" && (
              <div className="h-full overflow-auto p-6 max-w-3xl mx-auto">
                <div className="text-xs text-white/55 mb-3">
                  Results for <span className="text-white/90 font-semibold">{t.searchQuery}</span>
                </div>
                {t.searchBusy && <div className="text-sm text-white/55">Searching…</div>}
                {t.searchError && <div className="text-sm text-red-400">{t.searchError}</div>}
                {!t.searchBusy && t.searchResults && t.searchResults.length === 0 && (
                  <div className="text-sm text-white/55">No results.</div>
                )}
                <ul className="space-y-4">
                  {t.searchResults?.map((r, i) => (
                    <li key={i} className="panel p-3">
                      <div className="text-[10px] text-white/40 truncate">{safeHostname(r.url)}</div>
                      <a
                        href={r.url}
                        onClick={(e) => { e.preventDefault(); navigateIn(t.id, r.url); }}
                        className="text-sky-300 hover:text-sky-200 hover:underline text-base font-medium"
                      >
                        {r.title}
                      </a>
                      <div className="text-xs text-white/70 mt-1">{r.snippet}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {t.mode === "page" && (
              <>
                {t.proxied && (
                  <div className="absolute top-0 left-0 right-0 z-10 bg-amber-500/20 text-amber-200 text-[10px] text-center py-0.5">
                    Proxied mode — page rendered via server. Relative links may be approximate.
                  </div>
                )}
                <iframe
                  src={displayedSrc(t)}
                  className="w-full h-full bg-white"
                  sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
