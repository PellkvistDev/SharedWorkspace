// Uses Node 22's built-in node:sqlite (behind --experimental-sqlite flag).
// We expose a small better-sqlite3-compatible wrapper so call sites stay
// unchanged: prepare(sql).run(...) / .get(...) / .all(...).

import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, "workspaceos.db");

const raw = new DatabaseSync(dbPath);

// PRAGMAs via exec
raw.exec("PRAGMA journal_mode = WAL");
raw.exec("PRAGMA foreign_keys = ON");

class Statement<TParams extends unknown[] = unknown[], TResult = any> {
  constructor(private stmt: StatementSync) {}
  run(...args: TParams): { changes: number; lastInsertRowid: number | bigint } {
    return this.stmt.run(...(args as any)) as any;
  }
  get(...args: TParams): TResult | undefined {
    return this.stmt.get(...(args as any)) as any;
  }
  all(...args: TParams): TResult[] {
    return this.stmt.all(...(args as any)) as any;
  }
}

export const db = {
  prepare<TParams extends unknown[] = unknown[], TResult = any>(sql: string) {
    return new Statement<TParams, TResult>(raw.prepare(sql));
  },
  exec(sql: string) {
    raw.exec(sql);
  },
  pragma(s: string) {
    raw.exec("PRAGMA " + s);
  },
  close() {
    raw.close();
  },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    csrf TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_ts ON login_attempts(ip, ts);

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claude_sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    last_activity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS claude_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES claude_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_claude_messages_session ON claude_messages(session_id, created_at);
`);
