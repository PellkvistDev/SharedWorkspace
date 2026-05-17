import type { FastifyInstance } from "fastify";
import {
  clearSessionCookie,
  createSession,
  endSession,
  isRateLimited,
  lookupSession,
  readSessionCookie,
  recordAttempt,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { logger } from "../logger.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/status", async (req) => {
    const token = readSessionCookie(req);
    if (!token) return { authenticated: false };
    const sess = lookupSession(token);
    if (!sess) return { authenticated: false };
    return { authenticated: true, user: { id: sess.user_id }, csrf: sess.csrf };
  });

  app.post<{ Body: { password?: string } }>("/api/auth/login", async (req, reply) => {
    const ip = req.ip;
    if (isRateLimited(ip)) {
      reply.code(429);
      return { ok: false, error: "Too many attempts. Try again later." };
    }
    const password = req.body?.password ?? "";
    if (typeof password !== "string" || !password) {
      recordAttempt(ip);
      reply.code(400);
      return { ok: false, error: "Password required." };
    }
    const ok = await verifyPassword(password);
    if (!ok) {
      recordAttempt(ip);
      logger.warn({ ip }, "failed login");
      reply.code(401);
      return { ok: false, error: "Invalid password." };
    }
    const { token, csrf } = createSession("owner");
    setSessionCookie(reply, token);
    return { ok: true, csrf };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = readSessionCookie(req);
    if (token) endSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
