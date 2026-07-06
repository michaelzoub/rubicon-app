/**
 * Auth headers for X's internal web APIs (`x.com/i/api/...`).
 *
 * The onboarding search (`typeahead.json`) and article listing
 * (`UserArticlesTweets`) are X's *internal* endpoints — the browser can't call
 * them cross-origin, and they require an X authorization context. We use X's
 * publicly-known web Bearer token plus a server-activated **guest token**, so no
 * personal session is needed. If the deployment later supplies a real logged-in
 * session via `X_COOKIE` (containing `auth_token` and `ct0`), we forward it and
 * derive the `x-csrf-token` from `ct0`, which unlocks endpoints X gates behind
 * login. Callers treat any failure as "no results" and fall back to the
 * paste-a-link import path, so onboarding never hard-fails on X being flaky.
 */

/** X's public web app Bearer token. Overridable via `X_AUTH_BEARER`. */
const X_WEB_BEARER =
  process.env.X_AUTH_BEARER?.trim() ||
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const GUEST_ACTIVATE_URL = "https://api.x.com/1.1/guest/activate.json";
const GUEST_TTL_MS = 2.5 * 60 * 60 * 1000; // Guest tokens outlive this comfortably.
const ACTIVATE_TIMEOUT_MS = 5_000;
const X_WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let guestToken: { value: string; at: number } | null = null;

/** Thrown when we can't assemble usable X auth; routes map it to empty results. */
export class XAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XAuthError";
  }
}

/** Read `ct0` (the CSRF cookie) out of an `X_COOKIE` session string, if present. */
function csrfFromCookie(cookie: string): string | null {
  return cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] ?? null;
}

/** Activate (and cache) a guest token using the web Bearer token. */
async function getGuestToken(): Promise<string> {
  if (guestToken && Date.now() - guestToken.at < GUEST_TTL_MS) return guestToken.value;
  const response = await fetch(GUEST_ACTIVATE_URL, {
    method: "POST",
    headers: {
      authorization: X_WEB_BEARER,
      "user-agent": X_WEB_USER_AGENT,
      origin: "https://x.com",
      referer: "https://x.com/",
    },
    signal: AbortSignal.timeout(ACTIVATE_TIMEOUT_MS),
  });
  if (!response.ok) throw new XAuthError(`guest activation failed (${response.status})`);
  const body = (await response.json()) as { guest_token?: unknown };
  if (typeof body?.guest_token !== "string" || !body.guest_token) {
    throw new XAuthError("guest activation returned no token");
  }
  guestToken = { value: body.guest_token, at: Date.now() };
  return guestToken.value;
}

/**
 * Headers for an authenticated request to `x.com/i/api`. Prefers a real session
 * (`X_COOKIE`) when configured; otherwise falls back to guest auth. Throws
 * `XAuthError` if neither can be assembled.
 */
export async function getXHeaders(): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    authorization: X_WEB_BEARER,
    accept: "application/json",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "user-agent": X_WEB_USER_AGENT,
    origin: "https://x.com",
    referer: "https://x.com/",
  };

  const cookie = process.env.X_COOKIE?.trim();
  if (cookie) {
    const csrf = csrfFromCookie(cookie);
    if (!csrf) throw new XAuthError("X_COOKIE is missing the ct0 (csrf) cookie");
    return { ...base, cookie, "x-csrf-token": csrf, "x-twitter-auth-type": "OAuth2Session" };
  }

  return { ...base, "x-guest-token": await getGuestToken() };
}

/** Reset cached auth (used by tests). */
export function resetXAuthCache(): void {
  guestToken = null;
}
