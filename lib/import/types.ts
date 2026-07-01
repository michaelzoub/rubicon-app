/**
 * Normalized contract for URL-based content import.
 *
 * Every source-specific importer (Substack, X, and future ones) returns the
 * same `ImportResult` shape so the API route, the dashboard UI, and the draft
 * editor never have to special-case a platform. Add a new platform by writing
 * an importer that fulfils this contract and registering it in the detector.
 */

/** Platforms we can import from today. */
export type ImportSource = "substack" | "x";

/** Result of source detection — `"unsupported"` for anything we can't import. */
export type DetectedSource = ImportSource | "unsupported";

/** A heading-delimited chunk of imported body content. */
export interface ImportSection {
  heading: string | null;
  text: string;
}

/** Media referenced by the imported post. We store metadata, never the bytes. */
export interface ImportMedia {
  type: string;
  url: string | null;
  alt: string | null;
}

/**
 * The normalized import payload. Mirrors the documented `POST /api/import/url`
 * response body exactly. Fields the source doesn't expose are `null` (or empty
 * arrays) rather than omitted, so the client can rely on a stable shape.
 */
export interface ImportResult {
  sourcePlatform: ImportSource;
  sourceUrl: string;
  title: string | null;
  subtitle: string | null;
  authorName: string | null;
  authorHandle: string | null;
  canonicalUrl: string;
  publishedAt: string | null;
  previewText: string | null;
  /** Full importable body as clean markdown, or null when only a preview exists. */
  body: string | null;
  sections: ImportSection[];
  media: ImportMedia[];
  /** True when only public preview/metadata was imported (e.g. paywalled). */
  isPartial: boolean;
  /** Human-readable notes about what couldn't be imported. */
  warnings: string[];
}

/** A fetched HTML document, after SSRF-safe retrieval and redirect resolution. */
export interface FetchedDocument {
  /** The URL we were asked to fetch. */
  requestedUrl: string;
  /** The URL we actually landed on after following redirects. */
  finalUrl: string;
  html: string;
}

/**
 * Injectable dependencies for importers. Production passes the SSRF-safe
 * fetcher; tests pass a stub that returns fixture HTML, so importer parsing can
 * be tested without any network access.
 */
export interface ImporterDeps {
  fetchDocument: (url: string) => Promise<FetchedDocument>;
}

/** Thrown by importers/fetcher for conditions the API maps to HTTP statuses. */
export type ImportErrorCode =
  | "invalid_url"
  | "unsupported_source"
  | "blocked_url"
  | "fetch_failed"
  | "timeout"
  | "too_large"
  | "rate_limited"
  | "parse_failed"
  | "unavailable";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ImportError";
  }
}
