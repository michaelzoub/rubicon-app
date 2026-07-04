import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Published articles for a selected Artemis writer.
 *
 * One round trip for the client: resolves the handle to Artemis's numeric
 * author id (`/social/profile/<handle>`), then lists their published articles
 * (`/articles/?author_id=…&status=published`). Word counts are computed here
 * from the block payload so the picker can show them without shipping full
 * article bodies to the browser.
 */

interface ArticleSummary {
  shortId: string;
  title: string;
  subtitle: string | null;
  wordCount: number;
  publishedAt: string | null;
  /** Canonical artemis.ai URL, ready for the URL import pipeline. */
  url: string;
}

interface ArtemisNode {
  text?: string;
  children?: ArtemisNode[];
}

interface ArtemisArticleRow {
  short_id?: string;
  title?: string;
  subtitle?: string | null;
  published_at?: string | null;
  body?: { blocks?: ArtemisNode[] };
}

const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60 * 1000; // Writers add articles; keep this fresh-ish.
const MAX_CACHE_ENTRIES = 500;
const PAGE_SIZE = 20;

const cache = new Map<string, { at: number; payload: { articles: ArticleSummary[] } }>();

export async function GET(request: Request) {
  const handle = (new URL(request.url).searchParams.get("handle") ?? "").trim();
  if (!/^[\w.-]{1,100}$/.test(handle)) {
    return NextResponse.json({ error: { message: "Invalid Artemis handle." } }, { status: 400 });
  }

  const key = handle.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  try {
    const profileRes = await fetch(
      `https://data-svc.artemisxyz.com/social/profile/${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } },
    );
    if (profileRes.status === 404) {
      return NextResponse.json({ error: { message: "That Artemis writer wasn't found." } }, { status: 404 });
    }
    if (!profileRes.ok) throw new Error(`profile lookup ${profileRes.status}`);
    const profile = await profileRes.json() as { id?: number };
    if (typeof profile?.id !== "number") throw new Error("profile without id");

    // Artemis paginates with total/limit/offset. Fetch every advertised page;
    // a fixed first-page limit makes older posts disappear from onboarding.
    const rows: ArtemisArticleRow[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const articlesRes = await fetch(
        `https://data-svc.artemisxyz.com/articles/?author_id=${profile.id}&status=published&limit=${PAGE_SIZE}&offset=${offset}`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } },
      );
      if (!articlesRes.ok) throw new Error(`article list ${articlesRes.status}`);
      const body = await articlesRes.json() as { data?: ArtemisArticleRow[]; total?: number; limit?: number; offset?: number };
      const page = Array.isArray(body?.data) ? body.data : [];
      rows.push(...page);
      total = typeof body.total === "number" && body.total >= 0 ? body.total : rows.length;
      if (page.length === 0) break;
      offset += page.length;
    }

    const articles: ArticleSummary[] = [];
    for (const row of rows) {
      const shortId = typeof row.short_id === "string" ? row.short_id : "";
      if (!/^\d+$/.test(shortId)) continue;
      articles.push({
        shortId,
        title: row.title?.trim() || "Untitled article",
        subtitle: row.subtitle?.trim() || null,
        wordCount: countWords(row.body?.blocks ?? []),
        publishedAt: row.published_at ?? null,
        url: `https://www.artemis.ai/${handle}/article/${shortId}`,
      });
    }

    const payload = { articles };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: { message: "Couldn't load articles from Artemis. Try again." } },
      { status: 502 },
    );
  }
}

function countWords(blocks: ArtemisNode[]): number {
  let words = 0;
  const walk = (nodes: ArtemisNode[]) => {
    for (const node of nodes) {
      if (typeof node.text === "string") {
        words += node.text.split(/\s+/).filter(Boolean).length;
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(blocks);
  return words;
}
