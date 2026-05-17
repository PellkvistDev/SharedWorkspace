import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireAuth } from "../auth.js";
import { workspaceRoot } from "../fs-sandbox.js";
import { logger } from "../logger.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
    /^169\.254\./.test(h)
  );
}

function sanitizeFilename(name: string): string {
  // Strip path separators and control chars; collapse whitespace.
  return name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_").slice(0, 200) || "download.bin";
}

function inferFilename(u: URL, contentDisposition: string | null): string {
  if (contentDisposition) {
    const m = /filename\*?=(?:UTF-8'')?["']?([^;"'\n]+)["']?/i.exec(contentDisposition);
    if (m) return sanitizeFilename(decodeURIComponent(m[1].trim()));
  }
  const last = u.pathname.split("/").filter(Boolean).pop();
  if (last) return sanitizeFilename(decodeURIComponent(last));
  return `download-${Date.now()}.bin`;
}

export async function registerDownloadsRoutes(app: FastifyInstance) {
  // Fetch a URL server-side and save into WORKSPACE_ROOT/downloads.
  app.post<{ Body: { url?: string; filename?: string } }>(
    "/api/downloads/fetch",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;
      const target = req.body?.url;
      if (!target) {
        reply.code(400);
        return { error: "url required" };
      }
      let u: URL;
      try {
        u = new URL(target);
      } catch {
        reply.code(400);
        return { error: "invalid url" };
      }
      if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
        reply.code(400);
        return { error: "protocol not allowed" };
      }
      if (isBlockedHost(u.hostname)) {
        reply.code(400);
        return { error: "host blocked" };
      }

      const dir = path.join(workspaceRoot(), "downloads");
      await fs.mkdir(dir, { recursive: true });

      try {
        const upstream = await fetch(u.toString(), {
          redirect: "follow",
          headers: { "user-agent": "WorkspaceOS-Downloader/0.1" },
        });
        if (!upstream.ok || !upstream.body) {
          reply.code(502);
          return { error: `upstream returned ${upstream.status}` };
        }
        let name = req.body.filename
          ? sanitizeFilename(req.body.filename)
          : inferFilename(u, upstream.headers.get("content-disposition"));
        let dest = path.join(dir, name);

        // Avoid clobbering: append " (2)", " (3)", etc.
        let i = 1;
        while (true) {
          try {
            await fs.access(dest);
            i += 1;
            const parsed = path.parse(name);
            dest = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
          } catch {
            break;
          }
        }

        await pipeline(
          Readable.fromWeb(upstream.body as any),
          createWriteStream(dest)
        );

        const stat = await fs.stat(dest);
        const relPath = path.relative(workspaceRoot(), dest).split(path.sep).join("/");
        return { ok: true, path: relPath, size: stat.size };
      } catch (err) {
        logger.warn({ err: (err as Error).message, url: target }, "download failed");
        reply.code(502);
        return { error: "download failed: " + (err as Error).message };
      }
    }
  );
}
