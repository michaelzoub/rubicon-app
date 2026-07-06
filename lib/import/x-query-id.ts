const X_PAGES = ["https://x.com/home", "https://x.com/explore"];
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_SCRIPTS = 16;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const cache = new Map<string, { id: string; at: number }>();

/** Discover an operation's current GraphQL query ID from X's web bundles. */
export async function getXQueryId(operation: string, fallback: string, force = false): Promise<string> {
  if (!/^[A-Za-z][A-Za-z0-9_]+$/.test(operation)) return fallback;
  const cached = cache.get(operation);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.id;

  const pattern = new RegExp(`([A-Za-z0-9_-]{20,})/${operation}\\b`);
  try {
    const scriptUrls = await findScriptUrls();
    for (let offset = 0; offset < scriptUrls.length; offset += 4) {
      const scripts = await Promise.all(scriptUrls.slice(offset, offset + 4).map(fetchText));
      for (const script of scripts) {
        const id = script?.match(pattern)?.[1];
        if (!id) continue;
        cache.set(operation, { id, at: Date.now() });
        return id;
      }
    }
  } catch (cause) {
    console.warn("X query-ID discovery failed:", cause instanceof Error ? cause.message : cause);
  }
  return fallback;
}

async function findScriptUrls(): Promise<string[]> {
  const pages = await Promise.all(X_PAGES.map(fetchText));
  const urls = new Set<string>();
  const pattern = /https:\/\/abs\.twimg\.com\/[^"' )]+\.js/g;
  for (const page of pages) {
    for (const url of page?.match(pattern) ?? []) {
      urls.add(url.replaceAll("&amp;", "&"));
      if (urls.size >= MAX_SCRIPTS) return [...urls];
    }
  }
  return [...urls];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/javascript",
        "user-agent": USER_AGENT,
        // X's main bundle is large and occasionally stalls on an unbounded
        // transfer. Operation descriptors live near the beginning.
        ...(url.includes("abs.twimg.com") ? { range: "bytes=0-3000000" } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return response.ok ? response.text() : null;
  } catch {
    return null;
  }
}

export function resetXQueryIdCache(): void {
  cache.clear();
}
