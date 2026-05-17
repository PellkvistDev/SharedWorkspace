import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { ptyManager } from "../pty/pty-session-manager.js";

export async function registerSessionsRoutes(app: FastifyInstance) {
  app.get("/api/sessions", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return { sessions: ptyManager.list() };
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    ptyManager.kill(req.params.id);
    return { ok: true };
  });
}
