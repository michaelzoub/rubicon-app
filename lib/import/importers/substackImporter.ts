/**
 * Substack importer.
 *
 * Pulls public metadata (Open Graph, JSON-LD, canonical) and the readable
 * portion of the post body, converts it to clean Markdown, and splits it into
 * heading-delimited sections. Paywalled posts only expose a preview publicly,
 * so we import what's there, flag `isPartial`, and let the creator paste the
 * gated body in the review screen.
 */
import {
  decodeEntities,
  htmlToMarkdown,
  readCanonical,
  readJsonLd,
  readMeta,
  splitSections,
  toIso,
} from "../html";
import { FetchedDocument, ImportError, ImportMedia, ImportResult, ImporterDeps } from "../types";
import { fetchDocument as defaultFetch } from "../fetch";

const PREVIEW_CHARS = 320;

/** Heuristic markers that a Substack post is (at least partly) paywalled. */
function detectPaywall(html: string): boolean {
  return (
    /class=["'][^"']*\bpaywall\b[^"']*["']/i.test(html) ||
    /"audience"\s*:\s*"only_paid"/i.test(html) ||
    /"isAccessibleForFree"\s*:\s*false/i.test(html) ||
    /for (?:paid|paying) subscribers/i.test(html) ||
    /This post is for (?:paid|paying) subscribers/i.test(html)
  );
}

/**
 * Best-effort extraction of the visible article body. Substack wraps the
 * readable portion in `.available-content` and ends real prose at the
 * `.paywall` block (gated posts), the `.post-footer`, or `</article>`.
 *
 * Crucially we do NOT stop at `.subscribe-widget`: Substack injects those
 * "Subscribe now" CTAs *inline between paragraphs* of free posts, so stopping
 * there truncates the body to the first widget. We slice to the real end and
 * strip the injected widget chrome afterwards. `htmlToMarkdown` tolerates a
 * ragged fragment because it strips every tag anyway.
 */
function extractBodyHtml(html: string): string | null {
  const start = html.search(/<div[^>]*class=["'][^"']*\bavailable-content\b[^"']*["']/i);
  if (start === -1) return null;

  const rest = html.slice(start);
  const endMarkers = [
    /<div[^>]*class=["'][^"']*\bpaywall\b/i,
    /<div[^>]*class=["'][^"']*\bpost-footer\b/i,
    /<div[^>]*data-component-name=["']DigestPostEmbed["']/i,
    /<\/article>/i,
  ];
  let end = rest.length;
  for (const marker of endMarkers) {
    const idx = rest.search(marker);
    if (idx !== -1 && idx < end) end = idx;
  }
  return rest.slice(0, end);
}

// Standalone Substack UI chrome injected into the body (subscribe CTAs, share
// bars, comment prompts). We drop lines that are *only* one of these — never
// substrings — so genuine prose like "Subscribe to the theory that…" survives.
const CHROME_LINE =
  /^(subscribe(?: now)?|share(?: this post)?|leave a comment|give a gift subscription|type your email…?|comment|like|restack)\.?$/i;

/** Remove injected widget chrome lines and collapse the gaps they leave. */
function stripChrome(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !CHROME_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAuthor(html: string): string | null {
  const meta = readMeta(html, "author");
  if (meta) return meta;
  for (const block of readJsonLd(html)) {
    const author = block.author as { name?: string } | { name?: string }[] | string | undefined;
    if (typeof author === "string") return author;
    if (Array.isArray(author) && author[0]?.name) return author[0].name ?? null;
    if (author && typeof author === "object" && "name" in author && author.name) return author.name;
  }
  return null;
}

function extractMedia(html: string, ogImage: string | null): ImportMedia[] {
  const media: ImportMedia[] = [];
  if (ogImage) media.push({ type: "image", url: ogImage, alt: null });
  return media;
}

export async function importSubstack(
  url: string,
  deps: ImporterDeps = { fetchDocument: defaultFetch },
): Promise<ImportResult> {
  let doc: FetchedDocument;
  try {
    doc = await deps.fetchDocument(url);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError("fetch_failed", "Couldn't fetch the Substack post.", 502);
  }

  return parseSubstack(url, doc.html, doc.finalUrl);
}

/** Pure parser, separated so it can be unit-tested against fixture HTML. */
export function parseSubstack(sourceUrl: string, html: string, finalUrl: string): ImportResult {
  if (!html || html.trim() === "") {
    throw new ImportError("parse_failed", "The Substack post returned no content.", 502);
  }

  const warnings: string[] = [];

  const title =
    readMeta(html, "og:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()
      ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).trim()
      : null);
  const subtitle = readMeta(html, "og:description");
  const canonical = readCanonical(html) || readMeta(html, "og:url") || finalUrl;
  const publishedAt = toIso(readMeta(html, "article:published_time")) || jsonLdDate(html);
  const authorName = extractAuthor(html);
  const ogImage = readMeta(html, "og:image");

  const paywalled = detectPaywall(html);
  const bodyHtml = extractBodyHtml(html);
  const bodyMarkdown = bodyHtml ? stripChrome(htmlToMarkdown(bodyHtml)) : "";

  // A post is partial when paywalled, when we couldn't find the body region, or
  // when the visible body is suspiciously short (preview-only).
  const looksPreviewOnly = bodyMarkdown.length > 0 && bodyMarkdown.length < 600;
  const isPartial = paywalled || !bodyMarkdown || (looksPreviewOnly && Boolean(subtitle));

  let body: string | null = bodyMarkdown || null;
  if (isPartial) {
    if (paywalled) {
      warnings.push("This Substack post appears to be paywalled. Only the public preview was imported.");
    } else if (!bodyMarkdown) {
      warnings.push("Couldn't extract the post body automatically. Paste the full content manually.");
      body = null;
    } else {
      warnings.push("Only a short preview was available. Paste the full content if more is gated.");
    }
  }

  const previewText =
    (bodyMarkdown ? bodyMarkdown.slice(0, PREVIEW_CHARS).trim() : null) || subtitle || null;

  const sections = body ? splitSections(body) : [];

  return {
    sourcePlatform: "substack",
    sourceUrl,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : null,
    authorName,
    authorHandle: substackHandle(canonical),
    canonicalUrl: canonical,
    publishedAt,
    previewText,
    body,
    sections,
    media: extractMedia(html, ogImage),
    isPartial,
    warnings,
  };
}

function jsonLdDate(html: string): string | null {
  for (const block of readJsonLd(html)) {
    const date = (block.datePublished || block.dateCreated) as string | undefined;
    const iso = toIso(date);
    if (iso) return iso;
  }
  return null;
}

/** Derive the publication's subdomain handle from a Substack URL. */
function substackHandle(canonical: string): string | null {
  try {
    const host = new URL(canonical).hostname.toLowerCase();
    const m = host.match(/^([^.]+)\.substack\.com$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
