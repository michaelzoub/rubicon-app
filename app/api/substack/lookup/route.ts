import * as cheerio from "cheerio";
import { NextResponse } from "next/server";
import { sanitizeSubstackSubdomain } from "@/lib/import/substack-subdomain";

export const runtime = "nodejs";

/**
 * Validates that a Substack publication exists. The browser cannot call
 * `*.substack.com` directly (CORS), so this proxies the check server-side.
 * Only sanitized `[a-z0-9-]` subdomains are ever fetched.
 */

interface LookupResult {
  exists: boolean;
  subdomain?: string;
  name?: string;
  logoUrl?: string;
  postCount?: number;
}

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;

const cache = new Map<string, { at: number; result: LookupResult }>();

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("subdomain") ?? "";
  const subdomain = sanitizeSubstackSubdomain(raw);
  if (!subdomain) return NextResponse.json({ exists: false }, { status: 400 });

  const cached = cache.get(subdomain);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.result);
  }

  const result = await lookup(subdomain);
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(subdomain, { at: Date.now(), result });
  return NextResponse.json(result);
}

async function lookup(subdomain: string): Promise<LookupResult> {
  const base = `https://${subdomain}.substack.com`;
  let posts: unknown;
  try {
    const response = await fetch(`${base}/api/v1/posts?limit=1`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return lookupPlatformIdentity(subdomain);
    posts = await response.json();
  } catch {
    return lookupPlatformIdentity(subdomain);
  }
  if (!Array.isArray(posts)) return lookupPlatformIdentity(subdomain);

  const result: LookupResult = { exists: true, subdomain };

  // Publication name and logo come from the homepage's OpenGraph tags —
  // best-effort only; the lookup already succeeded without them.
  try {
    const response = await fetch(base, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
    if (response.ok) {
      const $ = cheerio.load(await response.text());
      const name = $('meta[property="og:site_name"]').attr("content") || $('meta[property="og:title"]').attr("content");
      const logoUrl = $('link[rel="apple-touch-icon"]').attr("href") || $('meta[property="og:image"]').attr("content");
      if (name) result.name = name.trim();
      if (logoUrl && /^https:\/\//.test(logoUrl)) result.logoUrl = logoUrl;
    }
  } catch {
    // Metadata is optional.
  }

  return result;
}

/**
 * Some profile-first Substack accounts are discoverable by handle before
 * their publication posts endpoint is available. Confirm the exact handle via
 * Substack's own platform search instead of rejecting a valid user profile.
 */
async function lookupPlatformIdentity(handle: string): Promise<LookupResult> {
  try {
    const response = await fetch(`https://substack.com/api/v1/platform/search?query=${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { exists: false };
    const body = await response.json() as {
      results?: Array<{
        type?: string;
        publication?: { subdomain?: string; name?: string; logo_url?: string };
        user?: { handle?: string; name?: string; publication_name?: string; photo_url?: string };
      }>;
    };
    for (const row of body.results ?? []) {
      const candidate = sanitizeSubstackSubdomain(
        row.type === "publication" ? row.publication?.subdomain ?? "" : row.type === "user" ? row.user?.handle ?? "" : "",
      );
      if (candidate !== handle) continue;
      const name = row.publication?.name?.trim() || row.user?.publication_name?.trim() || row.user?.name?.trim();
      const logoUrl = row.publication?.logo_url || row.user?.photo_url;
      return {
        exists: true,
        subdomain: handle,
        ...(name ? { name } : {}),
        ...(logoUrl && /^https:\/\//.test(logoUrl) ? { logoUrl } : {}),
      };
    }
  } catch {
    // A failed secondary lookup is simply a miss.
  }
  return { exists: false };
}
