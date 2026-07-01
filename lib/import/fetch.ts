/**
 * SSRF-hardened HTML fetcher used by every importer.
 *
 * Defences:
 *  - http/https only (enforced in `parseImportUrl`).
 *  - Per-hop DNS resolution with private/loopback/link-local IP blocking, so a
 *    public hostname can't rebind to an internal address.
 *  - Manual redirect following with a small hop limit (each hop re-validated).
 *  - A wall-clock timeout via AbortController.
 *  - A hard response-size cap, streamed so we never buffer a huge body.
 *
 * It returns clean decoded text only; callers convert to markdown and we never
 * persist the raw HTML.
 */
import { lookup } from "node:dns/promises";
import { assertHostAllowed, isPrivateIp, parseImportUrl } from "./detect";
import { FetchedDocument, ImportError } from "./types";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2_500_000; // ~2.5 MB of HTML is plenty for a post.
const TIMEOUT_MS = 8_000;

// A real browser UA — many publishers (Substack included) serve thin or
// bot-blocked HTML to obviously-automated clients.
const USER_AGENT =
  "Mozilla/5.0 (compatible; RubiconImporter/1.0; +https://rubicon.dev/import)";

/** Resolve a hostname and reject if any resolved address is private. */
async function assertResolvesPublic(hostname: string): Promise<void> {
  // Literal IPs are already covered by assertHostAllowed; only resolve names.
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (isPrivateIp(address)) {
        throw new ImportError("blocked_url", "That host resolves to a private address.");
      }
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError("fetch_failed", "Couldn't resolve that host.", 502);
  }
}

async function readCapped(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ImportError("too_large", "That page is too large to import.", 413);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Fetch a URL as text with all SSRF protections applied. Following redirects
 * manually lets us re-run the guards on every hop.
 */
export async function fetchDocument(rawUrl: string): Promise<FetchedDocument> {
  let current = parseImportUrl(rawUrl);
  const requestedUrl = current.toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertHostAllowed(current.hostname);
    await assertResolvesPublic(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      if (err instanceof ImportError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ImportError("timeout", "Timed out fetching that URL.", 504);
      }
      throw new ImportError("fetch_failed", "Couldn't reach that URL.", 502);
    } finally {
      clearTimeout(timer);
    }

    // Resolve redirects ourselves so each new host is re-validated.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new ImportError("fetch_failed", "That URL redirected without a destination.", 502);
      }
      if (hop === MAX_REDIRECTS) {
        throw new ImportError("fetch_failed", "That URL redirected too many times.", 502);
      }
      current = parseImportUrl(new URL(location, current).toString());
      continue;
    }

    if (res.status === 429) {
      throw new ImportError("rate_limited", "The source is rate-limiting requests. Try again shortly.", 429);
    }
    if (res.status === 401 || res.status === 403) {
      throw new ImportError("unavailable", "That content is private or not publicly accessible.", 422);
    }
    if (res.status === 404) {
      throw new ImportError("unavailable", "That post could not be found.", 404);
    }
    if (!res.ok) {
      throw new ImportError("fetch_failed", `The source responded with ${res.status}.`, 502);
    }

    const html = await readCapped(res);
    return { requestedUrl, finalUrl: current.toString(), html };
  }

  // Unreachable: the loop either returns or throws.
  throw new ImportError("fetch_failed", "Couldn't fetch that URL.", 502);
}
