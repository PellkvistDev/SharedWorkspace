import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { logger } from "./logger.js";
import "./db.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerFilesRoutes } from "./routes/files-routes.js";
import { registerBookmarksRoutes } from "./routes/bookmarks-routes.js";
import { registerProxyRoutes } from "./routes/proxy-routes.js";
import { registerSessionsRoutes } from "./routes/sessions-routes.js";
import { registerTerminalWs } from "./ws/terminal-ws.js";
import { registerClaudeWs } from "./ws/claude-ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  // Ensure workspace root exists; if not, log a warning but still start.
  if (!fs.existsSync(config.workspaceRoot)) {
    try {
      fs.mkdirSync(config.workspaceRoot, { recursive: true });
      logger.info({ workspaceRoot: config.workspaceRoot }, "created workspace root");
    } catch (err) {
      logger.warn({ err, workspaceRoot: config.workspaceRoot }, "could not create workspace root");
    }
  }

  if (!config.passwordHash) {
    logger.warn("PASSWORD_HASH is not set — login is disabled. Run `pnpm hash-password` and set it in .env.");
  }
  if (!config.sessionSecret) {
    logger.warn("SESSION_SECRET is empty — using random ephemeral secret. Set one in .env for stable sessions.");
  }

  const tlsAvailable = config.tlsCert && config.tlsKey && fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey);

  const fastifyOpts: any = {
    logger: false,
    trustProxy: true,
  };
  if (tlsAvailable) {
    fastifyOpts.https = {
      cert: fs.readFileSync(config.tlsCert),
      key: fs.readFileSync(config.tlsKey),
    };
  }
  const app: any = Fastify(fastifyOpts);

  await app.register(fastifyCookie, {
    secret: config.sessionSecret || "dev-only-insecure-secret-please-rotate",
  });
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: "1 minute",
    allowList: () => false,
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB per file
  });
  await app.register(fastifyWebsocket, {
    options: {
      verifyClient: (info: any, cb: any) => {
        // Origin check
        const origin = info.req.headers.origin;
        if (origin) {
          try {
            const u = new URL(origin);
            const host = info.req.headers.host;
            if (host && u.host !== host) {
              logger.warn({ origin, host }, "ws origin mismatch");
              return cb(false, 403, "forbidden origin");
            }
          } catch {
            return cb(false, 400, "bad origin");
          }
        }
        cb(true);
      },
    },
  });

  // Security headers
  app.addHook("onSend", async (_req: any, reply: any, payload: any) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "SAMEORIGIN");
    reply.header("referrer-policy", "no-referrer");
    if (tlsAvailable && config.isProd) {
      reply.header("strict-transport-security", "max-age=63072000; includeSubDomains");
    }
    return payload;
  });

  // API routes
  await registerAuthRoutes(app);
  await registerFilesRoutes(app);
  await registerBookmarksRoutes(app);
  await registerProxyRoutes(app);
  await registerSessionsRoutes(app);
  await registerTerminalWs(app);
  await registerClaudeWs(app);

  // Static client assets (built React app)
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback
    app.setNotFoundHandler((req: any, reply: any) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/ws/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.type("text/html").sendFile("index.html");
    });
  } else {
    logger.warn({ clientDist }, "client/dist not found — run `pnpm build:client` to build the UI.");
    app.get("/", async () => ({ message: "WorkspaceOS API up. Build the client to see the UI." }));
  }

  return app;
}

build()
  .then(async (app) => {
    try {
      await app.listen({ port: config.port, host: config.host });
      logger.info(
        { port: config.port, host: config.host, tls: !!(app.server as any).cert || false, workspaceRoot: config.workspaceRoot },
        "WorkspaceOS listening"
      );
    } catch (err) {
      logger.error({ err }, "failed to start");
      process.exit(1);
    }
  })
  .catch((err) => {
    logger.error({ err }, "boot failed");
    process.exit(1);
  });
