import { NextResponse } from "next/server";
import { getXHeaders } from "@/lib/import/x-internal-auth";

export const runtime = "nodejs";

/**
 * X writer lookup for the onboarding step. Exact handles resolve through the
 * public FxTwitter profile API; broader name queries use FxTwitter's public v2
 * typeahead endpoint (no auth needed) when no X_COOKIE is configured, or X's
 * session-gated `search/typeahead.json` when one is. Both normalize to the tiny
 * dropdown shape, carrying `userId` because article listing keys on it rather
 * than the handle.
 */

interface Suggestion {
  handle: string;
  name: string;
  avatarUrl: string | null;
  userId: string;
}

interface XUserRow {
  id_str?: string;
  screen_name?: string;
  name?: string;
  profile_image_url_https?: string | null;
}

const TYPEAHEAD_URL = "https://x.com/i/api/1.1/search/typeahead.json";
const FXTWITTER_API_BASE = "https://api.fxtwitter.com";
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
  const handle = exactHandle(query);
  if (handle) {
    const profile = await resolveExactHandle(handle);
    if (profile) return [profile];
  }

  // Without a configured X session, use FxTwitter's public v2 typeahead API
  // instead of X's session-gated typeahead (which returns 404 with guest auth).
  if (!process.env.X_COOKIE?.trim()) {
    return searchViaFxTwitter(query);
  }

  let rows: XUserRow[];
  try {
    const url = new URL(TYPEAHEAD_URL);
    url.searchParams.set("include_ext_is_blue_verified", "1");
    url.searchParams.set("include_ext_verified_type", "1");
    url.searchParams.set("include_ext_profile_image_shape", "1");
    url.searchParams.set("q", query);
    url.searchParams.set("src", "search_box");
    // Onboarding only needs writers, so ask for users (the endpoint accepts the
    // broader list too, but we discard everything else below).
    url.searchParams.set("result_type", "users");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: await getXHeaders(),
    });
    if (!response.ok) {
      console.warn(`X typeahead upstream ${response.status}`);
      return [];
    }
    const body = (await response.json()) as { users?: XUserRow[] };
    rows = Array.isArray(body?.users) ? body.users : [];
  } catch (cause) {
    // Best-effort: the writer can still type their handle or paste a link.
    console.warn("X typeahead request failed:", cause instanceof Error ? cause.message : cause);
    return [];
  }

  const suggestions: Suggestion[] = [];
  for (const row of rows) {
    const handle = typeof row.screen_name === "string" ? row.screen_name.trim() : "";
    const userId = typeof row.id_str === "string" ? row.id_str.trim() : "";
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || !/^\d+$/.test(userId)) continue;
    suggestions.push({
      handle,
      name: row.name?.trim() || handle,
      // Typeahead serves a `_normal` thumbnail; request the larger crop so the
      // dropdown avatar isn't blurry.
      avatarUrl: normalizeAvatar(row.profile_image_url_https),
      userId,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

/** FxTwitter v2 typeahead — public, no X session required. */
async function searchViaFxTwitter(query: string): Promise<Suggestion[]> {
  try {
    const url = new URL(`${FXTWITTER_API_BASE}/2/typeahead`);
    url.searchParams.set("q", query);
    url.searchParams.set("result_type", "users");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "Rubicon/1.0 (https://rubiconpay.xyz)" },
    });
    if (!response.ok) return [];

    const body = (await response.json()) as {
      code?: number;
      users?: Array<{
        id?: string | number;
        screen_name?: string;
        name?: string;
        avatar_url?: string | null;
      }>;
    };

    const rows = Array.isArray(body?.users) ? body.users : [];
    const suggestions: Suggestion[] = [];
    for (const row of rows) {
      const handle = typeof row.screen_name === "string" ? row.screen_name.trim() : "";
      const userId = String(row.id ?? "").trim();
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || !/^\d+$/.test(userId)) continue;
      suggestions.push({
        handle,
        name: row.name?.trim() || handle,
        avatarUrl: normalizeAvatar(row.avatar_url),
        userId,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  } catch (cause) {
    console.warn("FxTwitter typeahead failed:", cause instanceof Error ? cause.message : cause);
    return [];
  }
}

function exactHandle(query: string): string | null {
  const value = query.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(value) ? value : null;
}

/** Resolve an exact public handle without requiring a logged-in X session. */
async function resolveExactHandle(handle: string): Promise<Suggestion | null> {
  try {
    const response = await fetch(`${FXTWITTER_API_BASE}/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "Rubicon/1.0 (https://rubiconpay.xyz)" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      user?: { screen_name?: unknown; id?: unknown; name?: unknown; avatar_url?: unknown };
    };
    const user = body?.user;
    const resolvedHandle = typeof user?.screen_name === "string" ? user.screen_name.trim() : "";
    const userId = typeof user?.id === "string" ? user.id.trim() : String(user?.id ?? "").trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(resolvedHandle) || !/^\d+$/.test(userId)) return null;
    return {
      handle: resolvedHandle,
      userId,
      name: typeof user?.name === "string" && user.name.trim() ? user.name.trim() : resolvedHandle,
      avatarUrl: normalizeAvatar(typeof user?.avatar_url === "string" ? user.avatar_url : null),
    };
  } catch (cause) {
    console.warn("X exact-handle lookup failed:", cause instanceof Error ? cause.message : cause);
    return null;
  }
}

function normalizeAvatar(url: string | null | undefined): string | null {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return null;
  return url.replace(/_normal(\.\w+)$/, "_400x400$1");
}
