import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ClaudeMessage, ClientClaudeMsg, ServerClaudeMsg } from "@workspaceos/shared";

export default function ClaudeChat({ active }: { active: boolean }) {
  const [messages, setMessages] = useState<ClaudeMessage[]>([]);
  const [pendingAssistant, setPendingAssistant] = useState<string>("");
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rawContainer = useRef<HTMLDivElement>(null);
  const rawTermRef = useRef<{ term: XTerm; fit: FitAddon } | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const connect = (forceNew = false) => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const id = forceNew ? "" : sessionId || "";
    const url = `${proto}://${location.host}/ws/claude?cols=100&rows=30${id ? `&sessionId=${id}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setPendingAssistant("");
    ws.onmessage = (ev) => {
      const msg: ServerClaudeMsg = JSON.parse(ev.data);
      switch (msg.type) {
        case "ready":
          setSessionId(msg.sessionId);
          break;
        case "history":
          setMessages(msg.messages);
          break;
        case "message":
          setMessages((m) => [...m, msg.message]);
          break;
        case "raw":
          // For chat view, derive cleaned text into a transient assistant bubble
          if (rawTermRef.current) rawTermRef.current.term.write(msg.data);
          setPendingAssistant((p) => p + stripAnsi(msg.data));
          break;
        case "status":
          setWorking(msg.working);
          if (msg.working === false && /* finalize */ true) {
            setPendingAssistant((p) => {
              const t = p.trim();
              if (t) {
                setMessages((m) => [
                  ...m,
                  { id: crypto.randomUUID(), role: "assistant", content: t, createdAt: Date.now() },
                ]);
              }
              return "";
            });
          }
          break;
        case "error":
          // Reconnect on session-ended
          if (msg.message === "session-ended") setTimeout(() => connect(true), 100);
          break;
      }
    };
    ws.onclose = () => { wsRef.current = null; };
  };

  useEffect(() => {
    connect();
    return () => { try { wsRef.current?.close(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raw-mode xterm
  useEffect(() => {
    if (!rawMode) {
      if (rawTermRef.current) {
        try { rawTermRef.current.term.dispose(); } catch {}
        rawTermRef.current = null;
      }
      return;
    }
    if (!rawContainer.current) return;
    const term = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: { background: "#08080a", foreground: "#ebebed" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    rawContainer.current.innerHTML = "";
    term.open(rawContainer.current);
    fit.fit();
    term.onData((d) => {
      const ws = wsRef.current;
      const msg: ClientClaudeMsg = { type: "raw-input", data: d };
      if (ws?.readyState === ws?.OPEN) ws!.send(JSON.stringify(msg));
    });
    rawTermRef.current = { term, fit };
    const onR = () => { try { fit.fit(); } catch {} };
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [rawMode]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingAssistant]);

  const send = () => {
    const text = input.trim();
    if (!text || !wsRef.current) return;
    const msg: ClientClaudeMsg = { type: "send", text };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
  };

  const interrupt = () => {
    if (!wsRef.current) return;
    const msg: ClientClaudeMsg = { type: "interrupt" };
    wsRef.current.send(JSON.stringify(msg));
  };

  const newSession = () => {
    if (!wsRef.current) return;
    const msg: ClientClaudeMsg = { type: "new-session" };
    wsRef.current.send(JSON.stringify(msg));
    setMessages([]);
    setSessionId(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">Claude Code</span>
          {working && (
            <span className="flex items-center gap-1 text-ink-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              working…
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button className="btn btn-ghost text-xs" onClick={interrupt}>Interrupt</button>
          <button className="btn btn-ghost text-xs" onClick={newSession}>New session</button>
          <button
            className={clsx("btn btn-ghost text-xs", rawMode && "bg-ink-800")}
            onClick={() => setRawMode((v) => !v)}
          >
            Raw {rawMode ? "▣" : "□"}
          </button>
        </div>
      </div>

      {rawMode ? (
        <div ref={rawContainer} className="flex-1 min-h-0 p-2 bg-ink-950" />
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-3">
            {messages.map((m) => (
              <Bubble key={m.id} role={m.role} content={m.content} />
            ))}
            {pendingAssistant && <Bubble role="assistant" content={pendingAssistant} pending />}
            <div ref={messagesEnd} />
          </div>
        </>
      )}

      <div className="border-t border-ink-800 p-2">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
            placeholder="Message Claude…  (⌘/Ctrl + Enter)"
            rows={2}
            className="input resize-none flex-1 font-mono text-xs"
          />
          <button className="btn btn-primary" onClick={send} disabled={!input.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content, pending }: { role: string; content: string; pending?: boolean }) {
  return (
    <div className={clsx("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words font-mono",
          role === "user"
            ? "bg-ink-100 text-ink-900 dark:bg-ink-100 dark:text-ink-900"
            : "bg-ink-800 text-ink-100",
          pending && "opacity-70"
        )}
      >
        {content}
      </div>
    </div>
  );
}

function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "")
    .replace(/\r(?!\n)/g, "\n");
}
