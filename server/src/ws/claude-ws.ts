import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { v4 as uuid } from "uuid";
import { authForWs } from "../auth.js";
import { ptyManager, type PtySession } from "../pty/pty-session-manager.js";
import { config } from "../config.js";
import { workspaceRoot } from "../fs-sandbox.js";
import { db } from "../db.js";
import { logger } from "../logger.js";
import type { ClaudeMessage, ClientClaudeMsg, ServerClaudeMsg } from "@workspaceos/shared";

const insertClaudeSession = db.prepare(
  "INSERT OR IGNORE INTO claude_sessions (id, created_at, last_activity) VALUES (?, ?, ?)"
);
const touchClaudeSession = db.prepare("UPDATE claude_sessions SET last_activity = ? WHERE id = ?");
const insertClaudeMsg = db.prepare(
  "INSERT INTO claude_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
);
const listClaudeMsgs = db.prepare<[string], any>(
  "SELECT id, role, content, created_at FROM claude_messages WHERE session_id = ? ORDER BY created_at ASC"
);

function send(ws: WebSocket, msg: ServerClaudeMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// Strip ANSI escape sequences for the "clean" chat view while keeping plain text.
// We deliberately keep this conservative — the raw stream is still available via raw mode.
function stripAnsi(s: string): string {
  // Remove CSI sequences
  return s
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*\x07/g, "") // OSC
    .replace(/\x1B[=>]/g, "")
    .replace(/\r(?!\n)/g, "\n");
}

interface ChatState {
  pty: PtySession;
  buffer: string;
  workingTimer?: NodeJS.Timeout;
  isWorking: boolean;
}

function spawnClaude(cols: number, rows: number): PtySession {
  // Important: pass claude as the bare argv[0] — never interpolate user text.
  return ptyManager.spawn({
    kind: "claude",
    shell: config.claudeCmd,
    args: [],
    cwd: workspaceRoot(),
    cols,
    rows,
  });
}

export async function registerClaudeWs(app: FastifyInstance) {
  app.get("/ws/claude", { websocket: true }, (conn, req) => {
    const ws = conn as unknown as WebSocket;
    const sess = authForWs(req);
    if (!sess) {
      send(ws, { type: "error", message: "unauthenticated" });
      ws.close(1008, "unauthenticated");
      return;
    }
    const url = new URL(req.url, "http://x");
    const requested = url.searchParams.get("sessionId") || undefined;
    const cols = Number(url.searchParams.get("cols")) || 100;
    const rows = Number(url.searchParams.get("rows")) || 30;

    let existing = requested ? ptyManager.get(requested) : undefined;
    if (existing && existing.kind !== "claude") existing = undefined;
    const pty = existing || spawnClaude(cols, rows);

    insertClaudeSession.run(pty.id, Date.now(), Date.now());

    const state: ChatState = { pty, buffer: "", isWorking: false };

    const markWorking = (v: boolean) => {
      if (state.isWorking === v) return;
      state.isWorking = v;
      send(ws, { type: "status", working: v });
    };

    const onData = (raw: string) => {
      send(ws, { type: "raw", data: raw });
      // accumulate cleaned text for chat view
      state.buffer += stripAnsi(raw);
      // any output means claude is "working/responding"
      markWorking(true);
      if (state.workingTimer) clearTimeout(state.workingTimer);
      state.workingTimer = setTimeout(() => markWorking(false), 800);
    };

    const onExit = (code: number | null) => {
      send(ws, { type: "error", message: `claude process exited (code ${code ?? "?"})` });
    };

    send(ws, { type: "ready", sessionId: pty.id });

    // Replay stored chat history
    const rows_ = listClaudeMsgs.all(pty.id) as Array<any>;
    const history: ClaudeMessage[] = rows_.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    }));
    send(ws, { type: "history", messages: history });

    const detach = ptyManager.attach(pty.id, onData, onExit);

    ws.on("message", (rawMsg) => {
      let msg: ClientClaudeMsg;
      try {
        msg = JSON.parse(rawMsg.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "send": {
          // Persist user message
          const m: ClaudeMessage = {
            id: uuid(),
            role: "user",
            content: msg.text,
            createdAt: Date.now(),
          };
          insertClaudeMsg.run(m.id, pty.id, m.role, m.content, m.createdAt);
          touchClaudeSession.run(Date.now(), pty.id);
          send(ws, { type: "message", message: m });
          // Reset buffer so the next captured chunk represents assistant reply
          state.buffer = "";
          // Write text + newline. node-pty handles encoding.
          ptyManager.write(pty.id, msg.text + "\r");
          markWorking(true);
          break;
        }
        case "raw-input":
          ptyManager.write(pty.id, msg.data);
          break;
        case "resize":
          ptyManager.resize(pty.id, msg.cols, msg.rows);
          break;
        case "interrupt":
          ptyManager.interrupt(pty.id);
          break;
        case "new-session": {
          ptyManager.kill(pty.id);
          // We can't easily swap the pty inside the closure; instruct client to reconnect.
          send(ws, { type: "error", message: "session-ended" });
          ws.close(1000, "new-session");
          break;
        }
      }
    });

    ws.on("close", () => {
      if (detach) detach();
      // Flush any pending assistant buffer to history
      const txt = state.buffer.trim();
      if (txt) {
        const m: ClaudeMessage = {
          id: uuid(),
          role: "assistant",
          content: txt,
          createdAt: Date.now(),
        };
        insertClaudeMsg.run(m.id, pty.id, m.role, m.content, m.createdAt);
      }
      logger.debug({ id: pty.id }, "claude ws closed");
    });
  });
}
