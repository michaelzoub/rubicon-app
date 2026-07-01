/**
 * HTML metadata extraction and HTML→Markdown conversion.
 *
 * Metadata reads stay lightweight, while Turndown handles the article DOM so
 * links, inline marks, lists, quotes, code, captions, and images survive. The
 * result is Markdown only; untrusted source HTML is never stored or rendered.
 */
import { ImportSection } from "./types";
import TurndownService from "turndown";

/** Decode the handful of HTML entities that survive tag stripping. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)));
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Read a `<meta>` value by `property=` or `name=`, attribute order-agnostic. */
export function readMeta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // property="og:title" ... content="..."  OR  content="..." ... property="og:title"
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*\\scontent=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
  }
  return null;
}

/** Read `<link rel="canonical" href="...">`. */
export function readCanonical(html: string): string | null {
  const m =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*\shref=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  return m ? decodeEntities(m[1]).trim() : null;
}

/** Parse every JSON-LD `<script>` block, tolerating malformed ones. */
export function readJsonLd(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed.filter((x) => x && typeof x === "object"));
      else if (parsed && typeof parsed === "object") blocks.push(parsed);
    } catch {
      // Ignore malformed JSON-LD — metadata extraction is best-effort.
    }
  }
  return blocks;
}

/** Strip `<script>`/`<style>`/comments — content we never want in the body. */
function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

/**
 * Convert a fragment of article HTML to clean Markdown. H1/H2 headings become
 * section markers, lower headings stay as body subheads, lists become `-`/`1.`
 * items, and all other tags are dropped. The result is plain text with
 * Markdown structure — safe to store and render.
 */
export function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    fence: "```",
    headingStyle: "atx",
    linkStyle: "inlined",
    strongDelimiter: "**",
  });
  turndown.remove(["script", "style", "noscript", "template", "button", "form"]);
  turndown.addRule("figure-caption", {
    filter: "figcaption",
    replacement: (content) => content.trim() ? `\n\n*${content.trim()}*\n\n` : "",
  });
  const markdown = turndown.turndown(stripNonContent(html));
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^(\s*\d+\.)\s{2,}/gm, "$1 ")
    .replace(/^#{3,6}\s+/gm, "## ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a Markdown body into header/subheader-delimited sections. Mirrors the
 * editor's own section convention so imported sections line up with what the
 * gateway will later parse. Leading content before the first heading becomes
 * an untitled (`heading: null`) section.
 */
export function splitSections(markdown: string): ImportSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ImportSection[] = [];
  let heading: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text || heading) sections.push({ heading, text });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^#{1,2}\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Coerce a date-ish string to an ISO timestamp, or null if unparseable. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
