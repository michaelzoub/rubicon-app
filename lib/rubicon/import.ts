/**
 * Contract + sanitization for the browser-extension import flow.
 *
 * The "Send to Rubicon" Chrome extension extracts content from the creator's
 * current Substack or X/Twitter page and POSTs it here. This module is the
 * single source of truth for the payload shape and is shared by:
 *   - the extension (`extension/src/types.ts` mirrors `ExtensionImportPayload`)
 *   - the server route (`app/api/import/extension/route.ts`)
 *
 * Everything here is pure (no DB, no Node-only APIs) so it can be unit tested
 * and imported from either side.
 */

export type SourcePlatform = "substack" | "x";

export interface ImportSection {
  heading: string | null;
  text: string;
}

export interface ImportMedia {
  /** e.g. "image", "video". Valid images are added to the Markdown body. */
  type: string;
  url: string | null;
  alt: string | null;
}

/**
 * The exact body the extension sends to `POST /api/import/extension`.
 * Mirror any change to this in `extension/src/types.ts`.
 */
export interface ExtensionImportPayload {
  sourcePlatform: SourcePlatform;
  sourceUrl: string | null;
  title: string | null;
  subtitle: string | null;
  authorName: string | null;
  authorHandle: string | null;
  publishedAt: string | null;
  body: string | null;
  sections: ImportSection[];
  media: ImportMedia[];
  rawExtractedText: string | null;
  warnings: string[];
  /**
   * True when only a partial/preview extraction was possible (e.g. a paywalled
   * Substack post or an unreliable thread). Maps to `articles.is_partial_import`
   * so the review page can warn before publishing. Optional on the wire.
   */
  isPartial: boolean;
}

export interface ValidationOk {
  ok: true;
  value: ExtensionImportPayload;
}

export interface ValidationError {
  ok: false;
  /** Stable machine code for the response envelope. */
  code: string;
  message: string;
}

export type ValidationResult = ValidationOk | ValidationError;

// Defensive caps. The extension is a trusted-ish client (the creator's own
// browser), but the body is page-derived, so bound everything to keep one bad
// page from writing a multi-megabyte row.
export const LIMITS = {
  title: 500,
  subtitle: 1000,
  authorName: 200,
  authorHandle: 200,
  body: 500_000,
  sectionHeading: 500,
  sectionText: 200_000,
  sections: 500,
  media: 200,
  mediaType: 50,
  url: 2000,
  warning: 500,
  warnings: 50,
  rawExtractedText: 500_000,
} as const;

const SUPPORTED_PLATFORMS: SourcePlatform[] = ["substack", "x"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Strip anything that could become active markup or break storage. Imported
 * content is plain text / Markdown (the extractors never send raw HTML), so we
 * can be aggressive: remove tags, control characters, and trim. This runs
 * server-side on every field before it touches the database.
 */
export function sanitizeText(input: string | null, maxLength: number): string | null {
  if (input == null) return null;
  let text = input;
  // Remove HTML/script/style tags wholesale — body is meant to be plain text.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  // Drop control characters except tab (\t), newline (\n) and carriage return.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Normalise newlines and collapse runs of >2 blank lines.
  text = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  text = text.trim();
  if (text.length > maxLength) text = text.slice(0, maxLength);
  return text.length === 0 ? null : text;
}

/** Only allow http(s) URLs; everything else (javascript:, data:) becomes null. */
export function sanitizeUrl(input: string | null): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > LIMITS.url) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Accepts an ISO-8601-ish date string and returns a normalised ISO string. */
export function sanitizeDate(input: string | null): string | null {
  if (input == null) return null;
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Validate the raw JSON body and return a fully-sanitized payload. Validation
 * is permissive about *missing* optional fields (the extension may not find a
 * subtitle) but strict about types and the few hard requirements.
 */
export function validateImportPayload(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { ok: false, code: "invalid_body", message: "Request body must be a JSON object." };
  }

  const platform = raw.sourcePlatform;
  if (typeof platform !== "string" || !SUPPORTED_PLATFORMS.includes(platform as SourcePlatform)) {
    return {
      ok: false,
      code: "invalid_platform",
      message: `sourcePlatform must be one of: ${SUPPORTED_PLATFORMS.join(", ")}.`,
    };
  }

  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: ImportSection[] = [];
  for (const entry of rawSections.slice(0, LIMITS.sections)) {
    if (!isObject(entry)) continue;
    const text = sanitizeText(asStringOrNull(entry.text), LIMITS.sectionText);
    const heading = sanitizeText(asStringOrNull(entry.heading), LIMITS.sectionHeading);
    if (!text && !heading) continue;
    sections.push({ heading, text: text ?? "" });
  }

  const rawMedia = Array.isArray(raw.media) ? raw.media : [];
  const media: ImportMedia[] = [];
  for (const entry of rawMedia.slice(0, LIMITS.media)) {
    if (!isObject(entry)) continue;
    const url = sanitizeUrl(asStringOrNull(entry.url));
    const type = sanitizeText(asStringOrNull(entry.type), LIMITS.mediaType) ?? "image";
    const alt = sanitizeText(asStringOrNull(entry.alt), LIMITS.sectionHeading);
    media.push({ type, url, alt });
  }

  const rawWarnings = Array.isArray(raw.warnings) ? raw.warnings : [];
  const warnings: string[] = [];
  for (const entry of rawWarnings.slice(0, LIMITS.warnings)) {
    const warning = sanitizeText(asStringOrNull(entry), LIMITS.warning);
    if (warning) warnings.push(warning);
  }

  const body = sanitizeText(asStringOrNull(raw.body), LIMITS.body);
  const rawExtractedText = sanitizeText(asStringOrNull(raw.rawExtractedText), LIMITS.rawExtractedText);

  // A draft is only useful if it has *some* text to review. Sections without a
  // body still count, since the server composes a body from them below.
  const hasContent = Boolean(body) || Boolean(rawExtractedText) || sections.some((s) => s.text || s.heading);
  if (!hasContent) {
    return {
      ok: false,
      code: "empty_content",
      message: "No readable content was found on the page. Open the post and try again.",
    };
  }

  return {
    ok: true,
    value: {
      sourcePlatform: platform as SourcePlatform,
      sourceUrl: sanitizeUrl(asStringOrNull(raw.sourceUrl)),
      title: sanitizeText(asStringOrNull(raw.title), LIMITS.title),
      subtitle: sanitizeText(asStringOrNull(raw.subtitle), LIMITS.subtitle),
      authorName: sanitizeText(asStringOrNull(raw.authorName), LIMITS.authorName),
      authorHandle: sanitizeText(asStringOrNull(raw.authorHandle), LIMITS.authorHandle),
      publishedAt: sanitizeDate(asStringOrNull(raw.publishedAt)),
      body,
      sections,
      media,
      rawExtractedText,
      warnings,
      isPartial: raw.isPartial === true,
    },
  };
}

/**
 * Compose the Markdown body Rubicon stores from a validated payload. Prefers an
 * explicit body; otherwise reconstructs one from sections; otherwise falls back
 * to the raw extracted text. Headings become Markdown `##` so `parseSections`
 * (the gateway's section parser) recovers the same outline.
 */
export function composeArticleBody(payload: ExtensionImportPayload): string {
  let body = payload.body?.trim() ?? "";

  if (!body && payload.sections.length > 0) {
    const parts = payload.sections.map((section) => {
      const heading = section.heading ? `## ${section.heading}\n\n` : "";
      return `${heading}${section.text}`.trim();
    });
    body = parts.filter(Boolean).join("\n\n").trim();
  }

  if (!body) body = (payload.rawExtractedText ?? "").trim();

  // Extractors put images in their original position when possible. Media is
  // also sent separately, so append any valid image that was not represented
  // in the body instead of silently dropping it during draft creation.
  const missingImages = payload.media
    .filter((item) => item.type.toLowerCase() === "image" && item.url && !body.includes(item.url))
    .map((item) => {
      const alt = (item.alt ?? "").replace(/([\\[\]])/g, "\\$1").replace(/\s+/g, " ").trim();
      const url = item.url?.replace(/\(/g, "%28").replace(/\)/g, "%29");
      return `![${alt}](${url})`;
    });

  return [body, ...missingImages].filter(Boolean).join("\n\n").trim();
}

/** Title shown in the dashboard when the page had no detectable title. */
export function resolveTitle(payload: ExtensionImportPayload): string {
  if (payload.title && payload.title.trim()) return payload.title.trim();
  if (payload.sourcePlatform === "x") return "Imported post";
  return "Imported draft";
}

/** Author string for the article row (schema requires a non-null author). */
export function resolveAuthor(payload: ExtensionImportPayload): string {
  return (
    payload.authorName?.trim() ||
    (payload.authorHandle ? `@${payload.authorHandle.replace(/^@/, "")}` : "") ||
    "Unknown author"
  );
}
