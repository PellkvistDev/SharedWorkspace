import type { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";

const listBookmarks = db.prepare("SELECT id, title, url, created_at AS createdAt FROM bookmarks ORDER BY created_at DESC");
const insertBookmark = db.prepare("INSERT INTO bookmarks (id, title, url, created_at) VALUES (?, ?, ?, ?)");
const deleteBookmark = db.prepare("DELETE FROM bookmarks WHERE id = ?");

export async function registerBookmarksRoutes(app: FastifyInstance) {
  app.get("/api/bookmarks", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return listBookmarks.all();
  });

  app.post<{ Body: { title: string; url: string } }>("/api/bookmarks", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { title, url } = req.body || ({} as any);
    if (!title || !url) {
      reply.code(400);
      return { error: "title and url required" };
    }
    try {
      new URL(url);
    } catch {
      reply.code(400);
      return { error: "invalid url" };
    }
    const id = uuid();
    insertBookmark.run(id, title, url, Date.now());
    return { id };
  });

  app.delete<{ Params: { id: string } }>("/api/bookmarks/:id", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    deleteBookmark.run(req.params.id);
    return { ok: true };
  });
}
