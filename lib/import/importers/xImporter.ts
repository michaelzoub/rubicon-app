/**
 * X / Twitter importer.
 *
 * X aggressively gates logged-out access, so server-side extraction is
 * unreliable by design. We always derive what the URL alone guarantees (author
 * handle, status id, canonical URL) and *best-effort* enrich with public Open
 * Graph metadata when the page serves it. When the body can't be fetched we
 * fall back to a metadata-only draft and prompt the creator to paste the post
 * text — never a hard failure.
 *
 * Scope is a single tweet. The structure (URL parse → fetch → build) is kept
 * deliberately modular so thread import can be layered on later by fetching and
 * concatenating the reply chain before `buildXResult`.
 */
import { decodeEntities, readMeta, splitSections, toIso } from "../html";
import { FetchedDocument, ImportError, ImportMedia, ImportResult, ImporterDeps } from "../types";
import { fetchDocument as defaultFetch } from "../fetch";

export interface ParsedXUrl {
  handle: string;
  statusId: string;
  canonicalUrl: string;
}

/** Extract handle + status id from an x.com/twitter.com status URL. */
export function parseXUrl(raw: string): ParsedXUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError("invalid_url", "That doesn't look like a valid URL.");
  }
  const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/);
  if (!m) {
    throw new ImportError("unsupported_source", "That isn't a recognizable X/Twitter post URL.");
  }
  const [, handle, statusId] = m;
  return {
    handle,
    statusId,
    // Normalize to the canonical x.com form regardless of the host pasted.
    canonicalUrl: `https://x.com/${handle}/status/${statusId}`,
  };
}

/**
 * X's og:title is `"<Display Name> (@handle) on X"`. Strip the platform suffix
 * and the parenthesized handle so the author name doesn't duplicate the handle
 * we already surface separately.
 */
function cleanAuthorName(ogTitle: string): string | null {
  return (
    ogTitle
      .replace(/\s*(?:on X|on Twitter|\/ X|\/ Twitter)\s*$/i, "")
      .replace(/\s*\(@[A-Za-z0-9_]+\)\s*$/, "")
      .trim() || null
  );
}

export async function importX(
  url: string,
  deps: ImporterDeps = { fetchDocument: defaultFetch },
): Promise<ImportResult> {
  const parsed = parseXUrl(url);

  // Best-effort enrichment. Any failure degrades to metadata-only — fetching a
  // tweet is inherently flaky, so we never surface it as an error.
  let doc: FetchedDocument | null = null;
  try {
    doc = await deps.fetchDocument(parsed.canonicalUrl);
  } catch {
    doc = null;
  }

  const pageResult = buildXResult(url, parsed, doc?.html ?? null);
  if (!pageResult.isPartial) return pageResult;

  // Native X Articles look like media-only tweets in Open Graph metadata: the
  // description is just a t.co URL. FxTwitter's public compatibility endpoint
  // exposes X's structured article blocks, including the complete body.
  try {
    const apiDoc = await deps.fetchDocument(`https://api.fxtwitter.com/status/${parsed.statusId}`);
    return buildXApiResult(url, parsed, apiDoc.html) ?? pageResult;
  } catch {
    return pageResult;
  }
}

interface XApiBlock {
  data?: { caption?: unknown };
  entityRanges?: Array<{ key?: unknown; length?: unknown; offset?: unknown }>;
  inlineStyleRanges?: Array<{ length?: unknown; offset?: unknown; style?: unknown }>;
  text?: unknown;
  type?: unknown;
}

interface XApiMedia {
  media_id?: unknown;
  media_info?: {
    original_img_url?: unknown;
  };
}

interface XApiEntity {
  key?: unknown;
  value?: { data?: { caption?: unknown; url?: unknown; mediaItems?: Array<{ mediaId?: unknown }> }; type?: unknown };
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

/** Preserve Draft.js inline marks and links while converting an X block. */
function inlineBlockToMarkdown(block: XApiBlock, entities: Map<string, XApiEntity["value"]>): string {
  if (typeof block.text !== "string") return "";
  const text = block.text;
  const styles = Array.isArray(block.inlineStyleRanges) ? block.inlineStyleRanges : [];
  const entityRanges = Array.isArray(block.entityRanges) ? block.entityRanges : [];
  const boundaries = new Set([0, text.length]);
  for (const range of [...styles, ...entityRanges]) {
    if (typeof range.offset !== "number" || typeof range.length !== "number") continue;
    boundaries.add(Math.max(0, range.offset));
    boundaries.add(Math.min(text.length, range.offset + range.length));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const pieces: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    let value = escapeMarkdown(text.slice(start, end));
    const activeStyles = styles
      .filter((range) => typeof range.offset === "number" && typeof range.length === "number" && range.offset <= start && range.offset + range.length >= end)
      .map((range) => (typeof range.style === "string" ? range.style.toLowerCase() : ""));
    if (activeStyles.includes("code") || activeStyles.includes("monospace")) value = `\`${value.replace(/`/g, "\\`")}\``;
    const bold = activeStyles.includes("bold");
    const italic = activeStyles.includes("italic");
    if (bold && italic) value = `***${value}***`;
    else if (bold) value = `**${value}**`;
    else if (italic) value = `*${value}*`;
    if (activeStyles.includes("strikethrough")) value = `~~${value}~~`;

    const entityRange = entityRanges.find(
      (range) => typeof range.offset === "number" && typeof range.length === "number" && range.offset <= start && range.offset + range.length >= end,
    );
    const entity = entityRange && (typeof entityRange.key === "string" || typeof entityRange.key === "number")
      ? entities.get(String(entityRange.key))
      : null;
    const href = entity?.type === "LINK" && typeof entity.data?.url === "string" ? entity.data.url : null;
    if (href) value = `[${value}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
    pieces.push(value);
  }
  return pieces.join("");
}

/** Convert X Article editor blocks into Markdown, including inline media. */
function articleBlocksToMarkdown(
  blocks: XApiBlock[],
  entityMap: XApiEntity[],
  mediaById: Map<string, XApiMedia>,
): string {
  const entities = new Map(
    entityMap
      .filter((entry) => typeof entry.key === "string" || typeof entry.key === "number")
      .map((entry) => [String(entry.key), entry.value] as const),
  );
  return blocks
    .map((block) => {
      if (block.type === "atomic") {
        const range = block.entityRanges?.[0];
        const entity = range && (typeof range.key === "string" || typeof range.key === "number")
          ? entities.get(String(range.key))
          : null;
        const mediaItems = Array.isArray(entity?.data?.mediaItems) ? entity.data.mediaItems : [];
        const images = mediaItems.flatMap((item) => {
          const media = typeof item.mediaId === "string" ? mediaById.get(item.mediaId) : null;
          const url = media?.media_info?.original_img_url;
          return typeof url === "string" ? [`![](${url})`] : [];
        });
        const rawCaption = block.data?.caption ?? entity?.data?.caption;
        const caption = typeof rawCaption === "string" && rawCaption.trim()
          ? `*${escapeMarkdown(rawCaption.trim())}*`
          : null;
        return [...images, caption].filter(Boolean).join("\n\n") || null;
      }
      if (typeof block.text !== "string" || !block.text.trim()) return null;
      const text = inlineBlockToMarkdown(block, entities).trim();
      if (block.type === "header-one") return `# ${text}`;
      if (block.type === "header-two") return `## ${text}`;
      if (block.type === "header-three") return `### ${text}`;
      if (block.type === "blockquote") {
        return text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
      }
      return text;
    })
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

/** Build a complete tweet or native X Article import from structured JSON. */
export function buildXApiResult(
  sourceUrl: string,
  parsed: ParsedXUrl,
  rawJson: string,
): ImportResult | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const tweet = (payload as { tweet?: unknown }).tweet;
  if (!tweet || typeof tweet !== "object") return null;
  const data = tweet as {
    text?: unknown;
    author?: { name?: unknown; screen_name?: unknown };
    created_at?: unknown;
    article?: {
      title?: unknown;
      content?: { blocks?: unknown; entityMap?: unknown };
      cover_media?: XApiMedia;
      media_entities?: unknown;
    };
    media?: { all?: unknown };
  };

  const article = data.article;
  const blocks = Array.isArray(article?.content?.blocks)
    ? (article.content.blocks as XApiBlock[])
    : [];
  const entityMap = Array.isArray(article?.content?.entityMap)
    ? (article.content.entityMap as XApiEntity[])
    : [];
  const articleMedia = Array.isArray(article?.media_entities) ? (article.media_entities as XApiMedia[]) : [];
  const mediaById = new Map(
    articleMedia.flatMap((item) =>
      typeof item.media_id === "string" ? [[item.media_id, item] as const] : [],
    ),
  );
  const articleBody = articleBlocksToMarkdown(blocks, entityMap, mediaById);
  const tweetBody = typeof data.text === "string" ? data.text.trim() : "";
  const body = articleBody || tweetBody;
  if (!body) return null;

  const apiHandle = typeof data.author?.screen_name === "string" ? data.author.screen_name : parsed.handle;
  const authorName = typeof data.author?.name === "string" ? data.author.name.trim() || null : null;
  const articleTitle = typeof article?.title === "string" ? article.title.trim() || null : null;
  const media: ImportMedia[] = [];
  const seenMedia = new Set<string>();
  const addImage = (item: XApiMedia | null | undefined) => {
    const imageUrl = item?.media_info?.original_img_url;
    if (typeof imageUrl !== "string" || seenMedia.has(imageUrl)) return;
    seenMedia.add(imageUrl);
    media.push({ type: "image", url: imageUrl, alt: null });
  };
  addImage(article?.cover_media);
  if (Array.isArray(article?.media_entities)) {
    for (const item of article.media_entities) addImage(item as XApiMedia);
  }
  if (Array.isArray(data.media?.all)) {
    for (const item of data.media.all) addImage(item as XApiMedia);
  }

  return {
    sourcePlatform: "x",
    sourceUrl,
    title: articleTitle ?? (authorName ? `${authorName} on X` : `@${apiHandle} on X`),
    subtitle: null,
    authorName,
    authorHandle: `@${apiHandle}`,
    canonicalUrl: parsed.canonicalUrl,
    publishedAt: typeof data.created_at === "string" ? toIso(data.created_at) : null,
    previewText: body,
    body,
    sections: splitSections(body),
    media,
    isPartial: false,
    warnings: [],
  };
}

/** Pure builder, separated for unit testing both the enriched and fallback paths. */
export function buildXResult(sourceUrl: string, parsed: ParsedXUrl, html: string | null): ImportResult {
  const warnings: string[] = [];
  const media: ImportMedia[] = [];

  let authorName: string | null = null;
  let body: string | null = null;
  let publishedAt: string | null = null;

  if (html) {
    const ogTitle = readMeta(html, "og:title") || readMeta(html, "twitter:title");
    if (ogTitle) authorName = cleanAuthorName(ogTitle);

    const text = readMeta(html, "og:description") || readMeta(html, "twitter:description");
    if (text) body = decodeEntities(text).trim() || null;

    const image = readMeta(html, "og:image") || readMeta(html, "twitter:image");
    if (image) media.push({ type: "image", url: image, alt: null });

    publishedAt = toIso(readMeta(html, "article:published_time"));
  }

  // Media-only tweets expose just a t.co link as their og:description. Treat a
  // body that's only a URL (or empty) as not really imported, so the creator is
  // prompted to paste the real text rather than publishing a bare link.
  const meaningfulText = body ? body.replace(/https?:\/\/\S+/g, "").trim() : "";
  const isPartial = meaningfulText.length === 0;
  if (isPartial) {
    warnings.push(
      "X post text couldn't be imported automatically. Paste the post or thread content below to make it available to agents.",
    );
  }

  // A bare t.co URL represents attached media, not readable post text. Keep it
  // out of the editor so the creator has a genuinely empty body to replace.
  const importedBody = isPartial ? null : body;

  return {
    sourcePlatform: "x",
    sourceUrl,
    // A tweet has no real title; use the handle so the draft isn't blank.
    title: authorName ? `${authorName} on X` : `@${parsed.handle} on X`,
    subtitle: null,
    authorName,
    authorHandle: `@${parsed.handle}`,
    canonicalUrl: parsed.canonicalUrl,
    publishedAt,
    previewText: importedBody,
    body: importedBody,
    sections: importedBody ? splitSections(importedBody) : [],
    media,
    isPartial,
    warnings,
  };
}
