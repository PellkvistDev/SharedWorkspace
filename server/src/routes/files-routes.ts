import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { requireAuth } from "../auth.js";
import { PathError, resolveSafe, toRelative, workspaceRoot } from "../fs-sandbox.js";
import type { FileEntry, ListDirResponse, ReadFileResponse } from "@workspaceos/shared";

const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/javascript", "application/typescript"];
const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".log", ".json", ".jsonc", ".yaml", ".yml",
  ".toml", ".ini", ".env", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx",
  ".css", ".scss", ".less", ".html", ".htm", ".xml", ".svg", ".csv",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql", ".gitignore",
]);
const MAX_INLINE_READ = 5 * 1024 * 1024; // 5MB

function isTextual(name: string, m: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  return TEXT_MIME_PREFIXES.some((p) => m.startsWith(p));
}

export async function registerFilesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { path?: string } }>("/api/files/list", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const rel = req.query.path || "";
      const abs = await resolveSafe(rel);
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) {
        reply.code(400);
        return { error: "not a directory" };
      }
      const dirents = await fs.readdir(abs, { withFileTypes: true });
      const entries: FileEntry[] = [];
      for (const d of dirents) {
        const full = path.join(abs, d.name);
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          continue;
        }
        const m = mime.lookup(d.name) || "application/octet-stream";
        const kind = d.isDirectory() ? "directory" : d.isSymbolicLink() ? "symlink" : d.isFile() ? "file" : "other";
        entries.push({
          name: d.name,
          path: toRelative(full),
          kind,
          size: st.size,
          mtime: st.mtimeMs,
          isText: kind === "file" ? isTextual(d.name, m) : false,
        });
      }
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const relPath = toRelative(abs);
      const resp: ListDirResponse = {
        cwd: relPath,
        parent: abs === workspaceRoot() ? null : toRelative(path.dirname(abs)),
        entries,
      };
      return resp;
    } catch (err) {
      if (err instanceof PathError) {
        reply.code(400);
        return { error: err.message };
      }
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get<{ Querystring: { path?: string } }>("/api/files/read", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const rel = req.query.path || "";
      const abs = await resolveSafe(rel);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        reply.code(400);
        return { error: "not a file" };
      }
      if (stat.size > MAX_INLINE_READ) {
        reply.code(413);
        return { error: "file too large for inline read" };
      }
      const m = mime.lookup(abs) || "application/octet-stream";
      const textual = isTextual(abs, m);
      const buf = await fs.readFile(abs);
      const resp: ReadFileResponse = {
        path: toRelative(abs),
        encoding: textual ? "utf8" : "base64",
        content: textual ? buf.toString("utf8") : buf.toString("base64"),
        mime: m,
        size: stat.size,
      };
      return resp;
    } catch (err) {
      if (err instanceof PathError) {
        reply.code(400);
        return { error: err.message };
      }
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  // Stream a file (for download / large preview)
  app.get<{ Querystring: { path?: string; download?: string } }>("/api/files/raw", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const rel = req.query.path || "";
      const abs = await resolveSafe(rel);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        reply.code(400);
        return { error: "not a file" };
      }
      const m = mime.lookup(abs) || "application/octet-stream";
      reply.header("content-type", m);
      reply.header("content-length", String(stat.size));
      if (req.query.download) {
        reply.header("content-disposition", `attachment; filename="${path.basename(abs).replace(/"/g, "")}"`);
      }
      return reply.send(createReadStream(abs));
    } catch (err) {
      if (err instanceof PathError) {
        reply.code(400);
        return { error: err.message };
      }
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.post<{ Body: { path: string; content: string; encoding?: "utf8" | "base64" } }>(
    "/api/files/write",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;
      try {
        const { path: rel, content, encoding = "utf8" } = req.body || ({} as any);
        if (typeof rel !== "string" || typeof content !== "string") {
          reply.code(400);
          return { error: "path and content required" };
        }
        const abs = await resolveSafe(rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, Buffer.from(content, encoding));
        return { ok: true };
      } catch (err) {
        if (err instanceof PathError) {
          reply.code(400);
          return { error: err.message };
        }
        reply.code(500);
        return { error: (err as Error).message };
      }
    }
  );

  app.post<{ Body: { path: string } }>("/api/files/mkdir", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const abs = await resolveSafe(req.body.path);
      await fs.mkdir(abs, { recursive: true });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post<{ Body: { from: string; to: string } }>("/api/files/rename", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const from = await resolveSafe(req.body.from);
      const to = await resolveSafe(req.body.to);
      await fs.rename(from, to);
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.delete<{ Body: { path: string } }>("/api/files/delete", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const abs = await resolveSafe(req.body.path);
      if (abs === workspaceRoot()) {
        reply.code(400);
        return { error: "refusing to delete workspace root" };
      }
      await fs.rm(abs, { recursive: true, force: true });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  // Multipart upload
  app.post<{ Querystring: { path?: string } }>("/api/files/upload", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    try {
      const destDir = await resolveSafe(req.query.path || "");
      await fs.mkdir(destDir, { recursive: true });
      const parts = (req as any).files();
      const saved: string[] = [];
      for await (const part of parts) {
        // sanitize filename — drop any directory components
        const name = path.basename(part.filename || "upload.bin");
        const dest = await resolveSafe(path.join(toRelative(destDir), name));
        const stream = await fs.open(dest, "w");
        try {
          for await (const chunk of part.file) {
            await stream.write(chunk);
          }
        } finally {
          await stream.close();
        }
        saved.push(toRelative(dest));
      }
      return { ok: true, files: saved };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
