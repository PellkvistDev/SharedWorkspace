import "dotenv/config";
import path from "node:path";
import os from "node:os";

function bool(v: string | undefined, def = false): boolean {
  if (v == null) return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(v: string | undefined, def: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : def;
}

function defaultShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function defaultWorkspace(): string {
  if (process.env.WORKSPACE_ROOT) return process.env.WORKSPACE_ROOT;
  if (process.platform === "win32") return "C:\\Workspace";
  return path.join(os.homedir(), "Workspace");
}

export const config = {
  port: num(process.env.PORT, 8443),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",

  workspaceRoot: path.resolve(defaultWorkspace()),

  passwordHash: process.env.PASSWORD_HASH || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionTtlMs: num(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,

  claudeCmd: process.env.CLAUDE_CMD || "claude",
  terminalShell: process.env.TERMINAL_SHELL || defaultShell(),
  ptyIdleTimeoutMs: num(process.env.PTY_IDLE_TIMEOUT_MS, 60 * 60 * 1000),

  tlsCert: process.env.TLS_CERT || "",
  tlsKey: process.env.TLS_KEY || "",
  forceHttps: bool(process.env.FORCE_HTTPS, true),

  logLevel: process.env.LOG_LEVEL || "info",
  logDir: process.env.LOG_DIR || "./logs",

  dataDir: process.env.DATA_DIR || "./data",
};

export type AppConfig = typeof config;
