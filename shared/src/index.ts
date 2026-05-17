// Shared types between server and client.

export interface AuthStatus {
  authenticated: boolean;
  user?: { id: string };
}

export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  ok: boolean;
  error?: string;
}

// ----- Files -----

export type FileKind = "file" | "directory" | "symlink" | "other";

export interface FileEntry {
  name: string;
  path: string; // relative to workspace root, posix-style
  kind: FileKind;
  size: number;
  mtime: number;
  isText?: boolean;
}

export interface ListDirResponse {
  cwd: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface ReadFileResponse {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
  mime: string;
  size: number;
}

// ----- Bookmarks -----

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  createdAt: number;
}

// ----- PTY / WS protocol -----

export type ClientPtyMsg =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "ping" };

export type ServerPtyMsg =
  | { type: "data"; data: string }
  | { type: "exit"; code: number | null }
  | { type: "ready"; sessionId: string; cwd: string; shell: string }
  | { type: "error"; message: string }
  | { type: "pong" };

// Claude chat protocol (parsed/rendered messages, not raw pty)
export interface ClaudeMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export type ClientClaudeMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "new-session" }
  | { type: "raw-input"; data: string }
  | { type: "resize"; cols: number; rows: number };

export type ServerClaudeMsg =
  | { type: "ready"; sessionId: string }
  | { type: "raw"; data: string } // raw pty output (for raw mode + parser)
  | { type: "history"; messages: ClaudeMessage[] }
  | { type: "message"; message: ClaudeMessage }
  | { type: "status"; working: boolean }
  | { type: "error"; message: string };

// ----- Sessions -----

export interface PtySessionInfo {
  id: string;
  kind: "terminal" | "claude";
  shell: string;
  cwd: string;
  createdAt: number;
  lastActivity: number;
  alive: boolean;
}
