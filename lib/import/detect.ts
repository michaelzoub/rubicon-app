/**
 * URL parsing, source detection, and the synchronous SSRF guards.
 *
 * The guards here are the *literal* checks that don't need DNS (protocol,
 * literal IP ranges, localhost-style hostnames). The fetcher layer adds DNS
 * resolution on top to defend against DNS-rebinding to private addresses.
 */
import { DetectedSource, ImportError } from "./types";

/** Parse + strictly validate a user-supplied URL. Returns a `URL` or throws. */
export function parseImportUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ImportError("invalid_url", "Enter a URL to import.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError("invalid_url", "That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportError("blocked_url", "Only http(s) URLs can be imported.");
  }
  assertHostAllowed(url.hostname);
  return url;
}

/**
 * Detect which importer (if any) handles a URL.
 *
 *  - Substack: `*.substack.com/p/...`, the apex `substack.com/...`, or a custom
 *    domain whose path looks like a Substack post (`/p/<slug>`).
 *  - X/Twitter: `x.com` / `twitter.com` (and `www.`/mobile subdomains) status
 *    URLs of the form `/<handle>/status/<id>`.
 */
export function detectImportSource(raw: string): DetectedSource {
  let url: URL;
  try {
    url = parseImportUrl(raw);
  } catch {
    return "unsupported";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;

  if (host === "substack.com" || host.endsWith(".substack.com")) return "substack";

  const xHosts = new Set(["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"]);
  if (xHosts.has(host) && /^\/[^/]+\/status(?:es)?\/\d+/.test(path)) return "x";

  // Custom domains that publish via Substack still expose `/p/<slug>` posts.
  if (/^\/p\/[\w-]+/.test(path)) return "substack";

  return "unsupported";
}

/**
 * Synchronous host guard: reject literal private/loopback IPs and
 * localhost-style hostnames before any network call. Hostnames that resolve via
 * DNS are additionally checked in the fetcher.
 */
export function assertHostAllowed(hostname: string): void {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new ImportError("blocked_url", "That host isn't allowed.");
  }

  if (isIpLiteral(host) && isPrivateIp(host)) {
    throw new ImportError("blocked_url", "That address isn't allowed.");
  }
}

/** True if the string is a bare IPv4 or IPv6 literal (not a hostname). */
export function isIpLiteral(host: string): boolean {
  return isIpv4(host) || host.includes(":");
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Block loopback, private, link-local, and other non-routable ranges for both
 * IPv4 and IPv6 (including IPv4-mapped IPv6). Used on literal hosts here and on
 * DNS-resolved addresses in the fetcher.
 */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.toLowerCase();

  if (isIpv4(addr)) return isPrivateIpv4(addr);

  // Unspecified / loopback.
  if (addr === "::" || addr === "::1") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(addr) || /^fe[89ab][0-9a-f]:/.test(addr)) return true;
  // IPv4-mapped / -compatible IPv6 (::ffff:a.b.c.d) — check the embedded v4.
  const mapped = addr.match(/(?:^::ffff:|^::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);

  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}
