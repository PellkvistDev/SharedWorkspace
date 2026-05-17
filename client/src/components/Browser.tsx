import { useEffect, useRef, useState } from "react";
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

export default function Browser() {
  const [url, setUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [proxied, setProxied] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [mode, setMode] = useState<"start" | "page" | "search">("start");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimer = useRef<number | null>(null);

  const reloadBookmarks = async () => {
    try { setBookmarks(await api.get<Bookmark[]>("/api/bookmarks")); } catch {}
  };
  useEffect(() => { reloadBookmarks(); }, []);

  const looksLikeUrl = (s: string) => {
    const t = s.trim();
    if (/^https?:\/\//i.test(t)) return true;
    if (/\s/.test(t)) return false; // any whitespace → search
    // host-ish: has a dot and no spaces, or is localhost
    return /^[^\s]+\.[^\s]+$/.test(t) || /^localhost(:\d+)?(\/|$)/.test(t);
  };

  const runSearch = async (q: string) => {
    setSearchBusy(true);
    setSearchError(null);
    setSearchResults(null);
    setSearchQuery(q);
    setMode("search");
    setInputUrl(q);
    try {
      const r = await api.get<{ results: SearchResult[] }>(
        "/api/search?q=" + encodeURIComponent(q)
      );
      setSearchResults(r.results);
    } catch (e: any) {
      setSearchError(e.message || "Search failed");
    } finally {
      setSearchBusy(false);
    }
  };

  const navigate = (next: string, pushHistory = true) => {
    const target = next.trim();
    if (!target) return;
    if (!looksLikeUrl(target)) {
      // Search via our server-side scraper. Renders results inline; no iframe.
      if (pushHistory) {
        const newHist = history.slice(0, historyIdx + 1).concat("search:" + target);
        setHistory(newHist);
        setHistoryIdx(newHist.length - 1);
      }
      runSearch(target);
      return;
    }
    const fullUrl = /^https?:\/\//i.test(target) ? target : "https://" + target;
    setUrl(fullUrl);
    setInputUrl(fullUrl);
    setProxied(false);
    setMode("page");
    if (pushHistory) {
      const newHist = history.slice(0, historyIdx + 1).concat(fullUrl);
      setHistory(newHist);
      setHistoryIdx(newHist.length - 1);
    }
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
  };

  const onIframeLoad = () => {
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
  };

  const goToHistory = (i: number) => {
    const entry = history[i];
    setHistoryIdx(i);
    setProxied(false);
    if (entry.startsWith("search:")) {
      runSearch(entry.slice("search:".length));
    } else {
      setUrl(entry);
      setInputUrl(entry);
      setMode("page");
    }
  };
  const back = () => historyIdx > 0 && goToHistory(historyIdx - 1);
  const forward = () => historyIdx < history.length - 1 && goToHistory(historyIdx + 1);
  const refresh = () => {
    if (mode === "search") runSearch(searchQuery);
    else if (iframeRef.current) iframeRef.current.src = displayedSrc();
  };

  const enableProxy = () => setProxied(true);

  const addBookmark = async () => {
    const title = prompt("Bookmark title:", url);
    if (!title) return;
    try {
      await api.post("/api/bookmarks", { title, url });
      reloadBookmarks();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const deleteBookmark = async (id: string) => {
    await api.del(`/api/bookmarks/${id}`);
    reloadBookmarks();
  };

  const saveCurrentUrl = async () => {
    const target = prompt(
      "Download URL to Workspace/downloads:",
      url
    );
    if (!target) return;
    try {
      const r = await api.post<{ ok: boolean; path?: string; size?: number; error?: string }>(
        "/api/downloads/fetch",
        { url: target }
      );
      if (r.ok) {
        alert(`Saved to /${r.path}`);
      } else {
        alert("Download failed: " + (r.error || "unknown"));
      }
    } catch (e: any) {
      alert("Download failed: " + e.message);
    }
  };

  const displayedSrc = () => {
    if (proxied) return `/api/proxy?url=${encodeURIComponent(url)}`;
    return url;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/10 px-2 py-2 flex items-center gap-1">
        <button className="btn btn-ghost text-xs" onClick={back} disabled={historyIdx <= 0}>←</button>
        <button className="btn btn-ghost text-xs" onClick={forward} disabled={historyIdx >= history.length - 1}>→</button>
        <button className="btn btn-ghost text-xs" onClick={refresh}>↻</button>
        <form
          className="flex-1 flex gap-1"
          onSubmit={(e) => { e.preventDefault(); navigate(inputUrl); }}
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
          {proxied ? "Proxied" : "Proxy"}
        </button>
        <button className="btn btn-ghost text-xs" onClick={saveCurrentUrl} title="Save URL to Workspace/downloads">
          ⬇
        </button>
        <button className="btn btn-ghost text-xs" onClick={addBookmark} title="Bookmark">★</button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex gap-1 px-2 py-1 border-b border-white/10 overflow-x-auto">
          {bookmarks.map((b) => (
            <div key={b.id} className="group flex items-center gap-1 rounded px-2 py-0.5 bg-white/10 text-xs whitespace-nowrap">
              <button onClick={() => navigate(b.url)} className="hover:underline">{b.title}</button>
              <button className="opacity-30 group-hover:opacity-100" onClick={() => deleteBookmark(b.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className={clsx("flex-1 min-h-0 relative", proxied && mode === "page" && "ring-2 ring-amber-500/40")}>
        {mode === "start" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <div className="text-2xl font-semibold tracking-tight">Search or enter URL</div>
            <div className="text-sm text-white/55 max-w-md">
              Type words to search (DuckDuckGo, rendered here). Type a URL or domain to open it
              in the embedded browser. Use the <span className="font-semibold">Proxy</span> button
              for sites that refuse to be framed.
            </div>
          </div>
        )}

        {mode === "search" && (
          <div className="h-full overflow-auto p-6 max-w-3xl mx-auto">
            <div className="text-xs text-white/55 mb-3">
              Results for <span className="text-white/90 font-semibold">{searchQuery}</span>
            </div>
            {searchBusy && <div className="text-sm text-white/55">Searching…</div>}
            {searchError && <div className="text-sm text-red-400">{searchError}</div>}
            {!searchBusy && searchResults && searchResults.length === 0 && (
              <div className="text-sm text-white/55">No results.</div>
            )}
            <ul className="space-y-4">
              {searchResults?.map((r, i) => (
                <li key={i} className="panel p-3">
                  <div className="text-[10px] text-white/40 truncate">{safeHostname(r.url)}</div>
                  <a
                    href={r.url}
                    onClick={(e) => { e.preventDefault(); navigate(r.url); }}
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

        {mode === "page" && (
          <>
            {proxied && (
              <div className="absolute top-0 left-0 right-0 z-10 bg-amber-500/20 text-amber-200 text-[10px] text-center py-0.5">
                Proxied mode — page rendered via server. Relative links may be approximate.
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={displayedSrc()}
              className="w-full h-full bg-white"
              onLoad={onIframeLoad}
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
          </>
        )}
      </div>
    </div>
  );
}
