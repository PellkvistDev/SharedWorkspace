import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { logger } from "../logger.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

// DDG's HTML endpoint wraps result links through /l/?uddg=<encoded>.
// Unwrap those to the real destination.
function unwrapDdgRedirect(raw: string): string {
  try {
    let u: URL;
    if (raw.startsWith("//")) u = new URL("https:" + raw);
    else if (raw.startsWith("/")) u = new URL("https://duckduckgo.com" + raw);
    else u = new URL(raw);
    const wrapped = u.searchParams.get("uddg");
    if (wrapped) return decodeURIComponent(wrapped);
    return u.toString();
  } catch {
    return raw;
  }
}

function parseDdgHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Each result is wrapped in <div class="result ..."> ... </div>. The order is
  // important: title link, snippet link. We pull them both with non-greedy regex.
  const blockRe = /<div class="result (?:results_links )?results_links_deep[^"]*">([\s\S]*?)<div class="clear">/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const block = m[1];
    const titleM = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!titleM) continue;
    const snippetM = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const url = unwrapDdgRedirect(decodeEntities(titleM[1]));
    const title = stripTags(titleM[2]);
    const snippet = snippetM ? stripTags(snippetM[1]) : "";
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>("/api/search", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const q = (req.query.q || "").trim();
    if (!q) {
      reply.code(400);
      return { error: "q required" };
    }
    try {
      const upstream = await fetch(
        "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q),
        {
          headers: {
            // Plausible browser UA so DDG returns full HTML, not their lite redirect.
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        }
      );
      const html = await upstream.text();
      const results = parseDdgHtml(html);
      return { q, results };
    } catch (err) {
      logger.warn({ err: (err as Error).message, q }, "search failed");
      reply.code(502);
      return { error: "search failed" };
    }
  });
}
