import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { db } from "./db.js";
import { config } from "./config.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_NAME = "wos_session";
const CSRF_HEADER = "x-csrf-token";

interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  csrf: string;
}

const insertSession = db.prepare(
  "INSERT INTO sessions (token, user_id, created_at, expires_at, csrf) VALUES (?, ?, ?, ?, ?)"
);
const getSession = db.prepare<[string], SessionRow>("SELECT * FROM sessions WHERE token = ?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const touchSession = db.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?");
const purgeExpired = db.prepare("DELETE FROM sessions WHERE expires_at < ?");

const insertAttempt = db.prepare("INSERT INTO login_attempts (ip, ts) VALUES (?, ?)");
const countAttempts = db.prepare<[string, number], { c: number }>(
  "SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND ts > ?"
);
const purgeAttempts = db.prepare("DELETE FROM login_attempts WHERE ts < ?");

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export async function verifyPassword(password: string): Promise<boolean> {
  if (!config.passwordHash) return false;
  return bcrypt.compare(password, config.passwordHash);
}

export function isRateLimited(ip: string): boolean {
  const since = Date.now() - ATTEMPT_WINDOW_MS;
  purgeAttempts.run(since);
  const row = countAttempts.get(ip, since);
  return (row?.c ?? 0) >= MAX_ATTEMPTS;
}

export function recordAttempt(ip: string) {
  insertAttempt.run(ip, Date.now());
}

export function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const csrf = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  insertSession.run(token, userId, now, now + config.sessionTtlMs, csrf);
  return { token, csrf };
}

export function endSession(token: string) {
  deleteSession.run(token);
}

export function lookupSession(token: string): SessionRow | null {
  purgeExpired.run(Date.now());
  const row = getSession.get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession.run(token);
    return null;
  }
  // Slide expiry
  touchSession.run(Date.now() + config.sessionTtlMs, token);
  return row;
}

export function readSessionCookie(req: FastifyRequest): string | null {
  // @fastify/cookie populates req.cookies
  const cookies = (req as any).cookies as Record<string, string> | undefined;
  return cookies?.[COOKIE_NAME] ?? null;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): SessionRow | null {
  const token = readSessionCookie(req);
  if (!token) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  const session = lookupSession(token);
  if (!session) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  // CSRF check on state-changing methods
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const headerToken = req.headers[CSRF_HEADER];
    if (!headerToken || headerToken !== session.csrf) {
      reply.code(403).send({ error: "csrf-failed" });
      return null;
    }
  }
  return session;
}

export function authForWs(req: FastifyRequest): SessionRow | null {
  const token = readSessionCookie(req);
  if (!token) return null;
  return lookupSession(token);
}

export { COOKIE_NAME, CSRF_HEADER };
