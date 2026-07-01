/**
 * Substack subdomain parsing shared by the onboarding dialog (client) and the
 * lookup/connect endpoints (server).
 */

/**
 * Server-side gate before any outbound fetch: lowercase, `[a-z0-9-]` only.
 * Rejecting everything else prevents SSRF via crafted "subdomains".
 */
export function sanitizeSubstackSubdomain(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,63}$/.test(candidate) ? candidate : null;
}

/**
 * Extract a subdomain candidate from anything a writer might paste: a bare
 * handle, `@handle`, `name.substack.com`, a full https URL, or any post URL —
 * with `www.`, trailing slashes, and stray whitespace tolerated. Returns null
 * when there is no plausible candidate yet (e.g. mid-keystroke, or a custom
 * domain that cannot resolve via `{name}.substack.com`).
 */
export function parseSubstackSubdomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, "").replace(/^@/, "").replace(/^www\./, "");
  const host = value.split(/[/?#]/, 1)[0].trim();
  if (!host) return null;
  if (host.includes(".")) {
    const match = host.match(/^([a-z0-9-]+)\.substack\.com$/);
    return match ? sanitizeSubstackSubdomain(match[1]) : null;
  }
  return sanitizeSubstackSubdomain(host);
}
