import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { ClientPtyMsg, ServerPtyMsg } from "@workspaceos/shared";

interface TabState {
  id: string;
  label: string;
  sessionId?: string;
  term: XTerm;
  fit: FitAddon;
  ws?: WebSocket;
  mounted: boolean;
}

const MOBILE_KEYS = [
  { label: "Tab", send: "\t" },
  { label: "Esc", send: "\x1b" },
  { label: "↑", send: "\x1b[A" },
  { label: "↓", send: "\x1b[B" },
  { label: "←", send: "\x1b[D" },
  { label: "→", send: "\x1b[C" },
  { label: "|", send: "|" },
  { label: "~", send: "~" },
  { label: "^C", send: "\x03" },
];

function makeTerm(): { term: XTerm; fit: FitAddon } {
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  const term = new XTerm({
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", "Geist Mono", ui-monospace, monospace',
    fontSize: isMobile ? 12 : 13,
    allowTransparency: true,
    theme: {
      background: "rgba(0,0,0,0)",
      foreground: "#f2f2f5",
      cursor: "#f2f2f5",
      black: "#0f0f11",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  return { term, fit };
}

export default function Terminal({ active }: { active: boolean }) {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const paneRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const newTab = () => {
    const { term, fit } = makeTerm();
    const id = crypto.randomUUID();
    setTabs((t) => {
      const tab: TabState = { id, label: `T${t.length + 1}`, term, fit, mounted: false };
      return [...t, tab];
    });
    setActiveId(id);
  };

  useEffect(() => {
    if (tabs.length === 0) newTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount each tab's xterm into its own DOM node — exactly once. Switching tabs
  // just toggles visibility; we never re-open() the xterm into a new node, which
  // is what was corrupting the renderer. Also: only open when the Terminal page
  // is actually visible in the Shell — otherwise xterm renders into a 0×0
  // hidden parent and its keyboard handling never recovers.
  useEffect(() => {
    if (!active) return;
    for (const tab of tabs) {
      if (tab.mounted) continue;
      const el = paneRefs.current.get(tab.id);
      if (!el) continue;
      tab.term.open(el);
      try { tab.fit.fit(); } catch {}
      tab.mounted = true;

      // Connect WS for this tab
      if (!tab.ws) {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const url = `${proto}://${location.host}/ws/terminal?cols=${tab.term.cols}&rows=${tab.term.rows}${
          tab.sessionId ? `&sessionId=${tab.sessionId}` : ""
        }`;
        const ws = new WebSocket(url);
        tab.ws = ws;
        const send = (m: ClientPtyMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

        ws.onmessage = (ev) => {
          const msg: ServerPtyMsg = JSON.parse(ev.data);
          if (msg.type === "data") tab.term.write(msg.data);
          else if (msg.type === "ready") tab.sessionId = msg.sessionId;
          else if (msg.type === "exit") tab.term.writeln(`\r\n[process exited: ${msg.code}]`);
          else if (msg.type === "error") tab.term.writeln(`\r\n[error: ${msg.message}]`);
        };
        ws.onopen = () => send({ type: "resize", cols: tab.term.cols, rows: tab.term.rows });
        tab.term.onData((d) => send({ type: "input", data: d }));
        tab.term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));
      }
    }
  }, [tabs, active]);

  // Refit + focus the active tab when it becomes visible.
  useEffect(() => {
    if (!active) return;
    const tab = tabs.find((x) => x.id === activeId);
    if (!tab || !tab.mounted) return;
    const refit = () => {
      try { tab.fit.fit(); } catch {}
      try { tab.term.refresh(0, tab.term.rows - 1); } catch {}
      try { tab.term.focus(); } catch {}
    };
    const t = setTimeout(refit, 30);
    window.addEventListener("resize", refit);
    return () => { clearTimeout(t); window.removeEventListener("resize", refit); };
  }, [active, activeId, tabs]);

  const closeTab = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (t) {
      try { t.ws?.close(); } catch {}
      try { t.term.dispose(); } catch {}
      paneRefs.current.delete(id);
    }
    const remaining = tabs.filter((x) => x.id !== id);
    setTabs(remaining);
    setActiveId(remaining.length ? remaining[remaining.length - 1].id : null);
  };

  const sendKey = (data: string) => {
    const t = tabs.find((x) => x.id === activeId);
    if (t && t.ws && t.ws.readyState === t.ws.OPEN) {
      t.ws.send(JSON.stringify({ type: "input", data }));
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-white/10 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "group flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer",
              t.id === activeId ? "bg-white/15" : "hover:bg-white/10"
            )}
            onClick={() => setActiveId(t.id)}
          >
            <span className="font-mono">{t.label}</span>
            <button
              className="opacity-50 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost text-xs ml-1" onClick={newTab}>+ New</button>
      </div>

      {/* Render every tab's xterm into its own div. Hide inactive ones. */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              if (el) paneRefs.current.set(t.id, el);
              else paneRefs.current.delete(t.id);
            }}
            className={clsx(
              "absolute inset-0 p-2 bg-black/30 backdrop-blur-sm",
              t.id !== activeId && "invisible pointer-events-none"
            )}
          />
        ))}
      </div>

      <div className="md:hidden flex gap-1 px-1 py-1 border-t border-white/10 overflow-x-auto">
        {MOBILE_KEYS.map((k) => (
          <button key={k.label} className="btn btn-ghost text-xs whitespace-nowrap" onClick={() => sendKey(k.send)}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
