import { NextResponse } from "next/server";
import { sanitizeSubstackSubdomain } from "@/lib/import/substack-subdomain";

export const runtime = "nodejs";

/**
 * Profile/publication typeahead for the connect step. The browser cannot call
 * `substack.com` directly (CORS), so this proxies Substack's platform search
 * and normalizes both result types to the handle used by `*.substack.com`.
 */

interface Suggestion {
  subdomain: string;
  name: string;
  authorName: string | null;
  logoUrl: string | null;
  subscribers: string | null;
}

interface PlatformSearchResult {
  type?: string;
  publication?: {
    name?: string;
    author_name?: string;
    logo_url?: string;
    subdomain?: string;
    subscriber_count_string?: string;
  };
  user?: {
    handle?: string;
    name?: string;
    photo_url?: string;
    publication_name?: string;
    subscriber_count_string?: string;
  };
}

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_SUGGESTIONS = 6;

const cache = new Map<string, { at: number; suggestions: Suggestion[] }>();

export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("query") ?? "").trim();
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ suggestions: [] });
  }

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ suggestions: cached.suggestions });
  }

  const suggestions = await search(query);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), suggestions });
  return NextResponse.json({ suggestions });
}

async function search(query: string): Promise<Suggestion[]> {
  let results: PlatformSearchResult[];
  try {
    const response = await fetch(`https://substack.com/api/v1/platform/search?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return [];
    const body = await response.json() as { results?: PlatformSearchResult[] };
    results = Array.isArray(body?.results) ? body.results : [];
  } catch {
    return [];
  }

  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const publication = result.type === "publication" ? result.publication : undefined;
    const user = result.type === "user" ? result.user : undefined;
    if (!publication && !user) continue;
    const subdomain = sanitizeSubstackSubdomain(publication?.subdomain ?? user?.handle ?? "");
    const name = publication?.name?.trim() || user?.publication_name?.trim() || user?.name?.trim();
    if (!subdomain || !name || seen.has(subdomain)) continue;
    seen.add(subdomain);
    suggestions.push({
      subdomain,
      name,
      authorName: publication?.author_name?.trim() || user?.name?.trim() || null,
      logoUrl: /^https:\/\//.test(publication?.logo_url ?? user?.photo_url ?? "")
        ? (publication?.logo_url ?? user?.photo_url ?? null)
        : null,
      subscribers: publication?.subscriber_count_string?.trim() || user?.subscriber_count_string?.trim() || null,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
