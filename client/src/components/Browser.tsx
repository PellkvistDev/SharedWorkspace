import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Bookmark } from "@workspaceos/shared";

export default function Browser() {
  const [url, setUrl] = useState("https://www.duckduckgo.com");
  const [inputUrl, setInputUrl] = useState("https://www.duckduckgo.com");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [proxied, setProxied] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimer = useRef<number | null>(null);

  const reloadBookmarks = async () => {
    try { setBookmarks(await api.get<Bookmark[]>("/api/bookmarks")); } catch {}
  };
  useEffect(() => { reloadBookmarks(); }, []);

  const navigate = (next: string, pushHistory = true) => {
    let target = next.trim();
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    setUrl(target);
    setInputUrl(target);
    setProxied(false);
    if (pushHistory) {
      const newHist = history.slice(0, historyIdx + 1).concat(target);
      setHistory(newHist);
      setHistoryIdx(newHist.length - 1);
    }
    // Auto-fallback to proxy if iframe doesn't load in time.
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => {
      // We can't reliably read iframe contents (cross-origin), so we offer a button.
      // Don't auto-proxy — the user opts in.
    }, 3000);
  };

  const onIframeLoad = () => {
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
  };

  const back = () => {
    if (historyIdx <= 0) return;
    const i = historyIdx - 1;
    setHistoryIdx(i);
    setUrl(history[i]);
    setInputUrl(history[i]);
    setProxied(false);
  };
  const forward = () => {
    if (historyIdx >= history.length - 1) return;
    const i = historyIdx + 1;
    setHistoryIdx(i);
    setUrl(history[i]);
    setInputUrl(history[i]);
    setProxied(false);
  };
  const refresh = () => {
    if (iframeRef.current) iframeRef.current.src = displayedSrc();
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

  const displayedSrc = () => {
    if (proxied) return `/api/proxy?url=${encodeURIComponent(url)}`;
    return url;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-ink-800 px-2 py-2 flex items-center gap-1">
        <button className="btn btn-ghost text-xs" onClick={back} disabled={historyIdx <= 0}>←</button>
        <button className="btn btn-ghost text-xs" onClick={forward} disabled={historyIdx >= history.length - 1}>→</button>
        <button className="btn btn-ghost text-xs" onClick={refresh}>↻</button>
        <form
          className="flex-1 flex gap-1"
          onSubmit={(e) => { e.preventDefault(); navigate(inputUrl); }}
        >
          <input
            className="input flex-1 text-xs font-mono"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="URL"
          />
          <button className="btn btn-primary text-xs">Go</button>
        </form>
        <button className="btn btn-ghost text-xs" onClick={enableProxy} title="Use server-side proxy">
          {proxied ? "Proxied" : "Proxy"}
        </button>
        <button className="btn btn-ghost text-xs" onClick={addBookmark}>★</button>
      </div>

      {bookmarks.length > 0 && (
        <div className="flex gap-1 px-2 py-1 border-b border-ink-800 overflow-x-auto">
          {bookmarks.map((b) => (
            <div key={b.id} className="group flex items-center gap-1 rounded px-2 py-0.5 bg-ink-800/60 text-xs whitespace-nowrap">
              <button onClick={() => navigate(b.url)} className="hover:underline">{b.title}</button>
              <button className="opacity-30 group-hover:opacity-100" onClick={() => deleteBookmark(b.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className={clsx("flex-1 min-h-0 relative", proxied && "ring-2 ring-amber-500/40")}>
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
      </div>
    </div>
  );
}
