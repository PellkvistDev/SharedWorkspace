import { v4 as uuid } from "uuid";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { workspaceRoot } from "../fs-sandbox.js";
import type { PtySessionInfo } from "@workspaceos/shared";

export type SessionKind = "terminal" | "claude";

export interface PtySpawnOptions {
  kind: SessionKind;
  shell: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface PtySession {
  id: string;
  kind: SessionKind;
  pty: IPty;
  shell: string;
  cwd: string;
  createdAt: number;
  lastActivity: number;
  /** Ring buffer of recent output for reconnects. */
  scrollback: string[];
  scrollbackBytes: number;
  alive: boolean;
  listeners: Set<(data: string) => void>;
  exitListeners: Set<(code: number | null) => void>;
}

const MAX_SCROLLBACK_BYTES = 256 * 1024;

class Manager {
  private sessions = new Map<string, PtySession>();
  private sweeper?: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    if (this.sweeper.unref) this.sweeper.unref();
  }

  list(): PtySessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      kind: s.kind,
      shell: s.shell,
      cwd: s.cwd,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      alive: s.alive,
    }));
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  spawn(opts: PtySpawnOptions): PtySession {
    const id = uuid();
    const cwd = opts.cwd || workspaceRoot();
    const env = { ...process.env, ...(opts.env || {}), TERM: "xterm-256color" } as Record<string, string>;
    let pty: IPty;
    try {
      pty = ptySpawn(opts.shell, opts.args ?? [], {
        name: "xterm-256color",
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        cwd,
        env,
      });
    } catch (err) {
      logger.error({ err, shell: opts.shell }, "pty spawn failed");
      throw err;
    }

    const session: PtySession = {
      id,
      kind: opts.kind,
      pty,
      shell: opts.shell,
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      scrollback: [],
      scrollbackBytes: 0,
      alive: true,
      listeners: new Set(),
      exitListeners: new Set(),
    };

    pty.onData((data) => {
      session.lastActivity = Date.now();
      session.scrollback.push(data);
      session.scrollbackBytes += data.length;
      while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollback.length > 1) {
        const dropped = session.scrollback.shift()!;
        session.scrollbackBytes -= dropped.length;
      }
      for (const fn of session.listeners) {
        try { fn(data); } catch (e) { logger.warn({ err: e }, "listener error"); }
      }
    });

    pty.onExit(({ exitCode }) => {
      session.alive = false;
      for (const fn of session.exitListeners) {
        try { fn(exitCode ?? null); } catch (e) { logger.warn({ err: e }, "exit listener error"); }
      }
      // keep the session record briefly so reconnecting clients see the exit
      setTimeout(() => this.sessions.delete(id), 30_000);
    });

    this.sessions.set(id, session);
    logger.info({ id, kind: opts.kind, shell: opts.shell, cwd }, "pty spawned");
    return session;
  }

  write(id: string, data: string) {
    const s = this.sessions.get(id);
    if (!s || !s.alive) return;
    s.lastActivity = Date.now();
    s.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const s = this.sessions.get(id);
    if (!s || !s.alive) return;
    try { s.pty.resize(cols, rows); } catch { /* ignore */ }
  }

  interrupt(id: string) {
    this.write(id, "\x03");
  }

  kill(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    try { s.pty.kill(); } catch { /* ignore */ }
    s.alive = false;
    this.sessions.delete(id);
  }

  attach(id: string, onData: (d: string) => void, onExit: (code: number | null) => void) {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.listeners.add(onData);
    s.exitListeners.add(onExit);
    // Replay scrollback
    const replay = s.scrollback.join("");
    if (replay) onData(replay);
    return () => {
      s.listeners.delete(onData);
      s.exitListeners.delete(onExit);
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (!s.alive) continue;
      if (s.listeners.size === 0 && now - s.lastActivity > config.ptyIdleTimeoutMs) {
        logger.info({ id }, "killing idle pty session");
        this.kill(id);
      }
    }
  }
}

export const ptyManager = new Manager();
