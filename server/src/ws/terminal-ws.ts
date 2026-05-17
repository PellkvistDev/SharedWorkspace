import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { authForWs } from "../auth.js";
import { ptyManager } from "../pty/pty-session-manager.js";
import { config } from "../config.js";
import { workspaceRoot } from "../fs-sandbox.js";
import { logger } from "../logger.js";
import type { ClientPtyMsg, ServerPtyMsg } from "@workspaceos/shared";

function send(ws: WebSocket, msg: ServerPtyMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export async function registerTerminalWs(app: FastifyInstance) {
  app.get("/ws/terminal", { websocket: true }, (conn, req) => {
    const ws = conn as unknown as WebSocket;
    const sess = authForWs(req);
    if (!sess) {
      send(ws, { type: "error", message: "unauthenticated" });
      ws.close(1008, "unauthenticated");
      return;
    }
    const url = new URL(req.url, "http://x");
    const sessionId = url.searchParams.get("sessionId") || undefined;
    const cols = Number(url.searchParams.get("cols")) || 80;
    const rows = Number(url.searchParams.get("rows")) || 24;

    let pty = sessionId ? ptyManager.get(sessionId) : undefined;
    if (!pty || pty.kind !== "terminal") {
      pty = ptyManager.spawn({
        kind: "terminal",
        shell: config.terminalShell,
        cwd: workspaceRoot(),
        cols,
        rows,
      });
    }

    send(ws, { type: "ready", sessionId: pty.id, cwd: pty.cwd, shell: pty.shell });

    const detach = ptyManager.attach(
      pty.id,
      (data) => send(ws, { type: "data", data }),
      (code) => send(ws, { type: "exit", code })
    );

    ws.on("message", (raw) => {
      let msg: ClientPtyMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case "input":
          ptyManager.write(pty!.id, msg.data);
          break;
        case "resize":
          ptyManager.resize(pty!.id, msg.cols, msg.rows);
          break;
        case "interrupt":
          ptyManager.interrupt(pty!.id);
          break;
        case "ping":
          send(ws, { type: "pong" });
          break;
      }
    });

    ws.on("close", () => {
      if (detach) detach();
      logger.debug({ id: pty!.id }, "terminal ws closed");
    });
  });
}
