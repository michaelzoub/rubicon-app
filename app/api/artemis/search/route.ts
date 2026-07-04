import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Artemis writer typeahead for the onboarding step. Proxies Artemis's public
 * profile search (the browser can't call data-svc.artemisxyz.com directly) and
 * normalizes results to the tiny shape the dropdown needs.
 */

interface Suggestion {
  handle: string;
  name: string;
  avatarUrl: string | null;
}

interface ArtemisProfileRow {
  handle?: string;
  display_name?: string;
  avatar_url?: string | null;
}

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1_000;
const MAX_SUGGESTIONS = 5;

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
  let rows: ArtemisProfileRow[];
  try {
    const response = await fetch(
      `https://data-svc.artemisxyz.com/social/profiles/?q=${encodeURIComponent(query)}&limit=${MAX_SUGGESTIONS}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } },
    );
    if (!response.ok) return [];
    const body = await response.json() as { data?: ArtemisProfileRow[] };
    rows = Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }

  const suggestions: Suggestion[] = [];
  for (const row of rows) {
    const handle = typeof row.handle === "string" ? row.handle.trim() : "";
    if (!handle || !/^[\w.-]+$/.test(handle)) continue;
    suggestions.push({
      handle,
      name: row.display_name?.trim() || handle,
      avatarUrl: /^https:\/\//.test(row.avatar_url ?? "") ? row.avatar_url! : null,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
