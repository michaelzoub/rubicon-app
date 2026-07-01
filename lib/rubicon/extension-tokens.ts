/**
 * Extension auth tokens.
 *
 * The "Send to Rubicon" browser extension authenticates with a long-lived
 * bearer token the creator generates in Settings. We never store the token
 * itself: the browser generates it, shows it once, and persists only a SHA-256
 * hash (plus a short prefix for display). The server hashes the presented token
 * the same way and looks up the owning creator.
 *
 * Hashing uses the Web Crypto API (`globalThis.crypto.subtle`), which exists in
 * both the browser and Node 20+, so this one function is the single source of
 * truth on both sides.
 */

export const TOKEN_PREFIX = "rbx_";
const RANDOM_BYTES = 24;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = (typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64"));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a fresh `rbx_...` token. Only the creator's browser ever sees this. */
export function generateExtensionToken(): string {
  const bytes = new Uint8Array(RANDOM_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${toBase64Url(bytes)}`;
}

/** SHA-256 hex digest of the exact token string. Stored, never reversible. */
export async function hashExtensionToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/** First 10 chars (`rbx_xxxxxx`), shown in Settings so a token is recognisable. */
export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 6);
}

/** Pull the bearer token out of an Authorization header, or null. */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  return token;
}
