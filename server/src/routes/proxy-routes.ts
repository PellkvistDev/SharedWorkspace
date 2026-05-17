import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { logger } from "../logger.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isBlockedHost(hostname: string): boolean {
  // Block obviously-internal targets to avoid being a network egress proxy.
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

export async function registerProxyRoutes(app: FastifyInstance) {
  // GET /api/proxy?url=...
  // Server-side fetch + minimal HTML rewrite. Marked clearly in the UI; only for
  // pages that refuse to embed via iframe.
  app.get<{ Querystring: { url?: string } }>("/api/proxy", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const target = req.query.url;
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
    try {
      const upstream = await fetch(u.toString(), {
        redirect: "follow",
        headers: { "user-agent": "WorkspaceOS-Proxy/0.1" },
      });
      const ct = upstream.headers.get("content-type") || "application/octet-stream";
      reply.header("content-type", ct);
      // Strip frame-busting headers from upstream
      reply.removeHeader("x-frame-options");
      reply.removeHeader("content-security-policy");
      if (ct.includes("text/html")) {
        let body = await upstream.text();
        // Inject <base> so relative URLs resolve, and rewrite a few absolute refs through proxy.
        const baseTag = `<base href="${u.toString()}">`;
        body = body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
        return reply.send(body);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      return reply.send(buf);
    } catch (err) {
      logger.warn({ err: (err as Error).message, url: target }, "proxy fetch failed");
      reply.code(502);
      return { error: "proxy fetch failed" };
    }
  });
}
