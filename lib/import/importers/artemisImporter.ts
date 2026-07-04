/**
 * Artemis importer.
 *
 * Artemis (artemis.ai) renders articles client-side, so the page HTML only
 * carries metadata — the body streams in later from Artemis's public data
 * service. We go straight to that JSON (`data-svc.artemisxyz.com/articles/
 * <shortId>`), which returns the article as a tree of editor blocks, and
 * convert those blocks to clean Markdown so agents read exactly what the
 * article says: headings, lists, links, emphasis, image captions, and a
 * textual note for embedded charts.
 */
import { splitSections, toIso } from "../html";
import { FetchedDocument, ImportError, ImportMedia, ImportResult, ImporterDeps } from "../types";
import { fetchDocument as defaultFetch } from "../fetch";

const PREVIEW_CHARS = 320;
const DATA_SERVICE = "https://data-svc.artemisxyz.com/articles";

/** An inline node: either a text leaf with marks or an element (e.g. a link). */
interface ArtemisNode {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
  type?: string;
  url?: string;
  caption?: string;
  title?: string;
  children?: ArtemisNode[];
}

/** A top-level editor block from the Artemis body payload. */
interface ArtemisBlock {
  type?: string;
  children?: ArtemisNode[];
  url?: string;
  caption?: string;
  title?: string;
  listStyleType?: string;
  listStart?: number;
  indent?: number;
}

interface ArtemisArticle {
  short_id?: string;
  title?: string;
  subtitle?: string;
  cover_image_url?: string | null;
  body?: { blocks?: ArtemisBlock[] };
  status?: string;
  published_at?: string | null;
  author_handle?: string | null;
  author_display_name?: string | null;
}

/** Parse `/<handle>/article/<shortId>` out of an artemis.ai URL. */
function parseArticlePath(rawUrl: string): { handle: string; shortId: string } {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    throw new ImportError("invalid_url", "That doesn't look like a valid URL.");
  }
  const m = path.match(/^\/([\w.-]+)\/article\/(\d+)/);
  if (!m) {
    throw new ImportError("invalid_url", "Paste a full Artemis article URL (…/article/<id>).");
  }
  return { handle: m[1], shortId: m[2] };
}

/** Render inline nodes (text leaves, marks, links) to Markdown. */
function renderInline(nodes: ArtemisNode[] | undefined, media: ImportMedia[]): string {
  if (!nodes) return "";
  return nodes.map((node) => renderNode(node, media)).join("");
}

function renderNode(node: ArtemisNode, media: ImportMedia[]): string {
  // Artemis stores images in two shapes: as top-level `img` blocks and as
  // inline `img` children inside a paragraph. The latter is common in real
  // articles, so walking only the top-level blocks silently drops many images.
  if (node.type === "img" && node.url) {
    const alt = node.caption?.trim() || node.title?.trim() || "";
    media.push({ type: "image", url: node.url, alt: alt || null });
    return `![${alt}](${node.url})`;
  }
  if (node.type === "a" && node.url) {
    const label = renderInline(node.children, media).trim();
    return label ? `[${label}](${node.url})` : "";
  }
  if (node.children) return renderInline(node.children, media);

  const text = node.text ?? "";
  if (text.trim() === "") return text;
  // Keep whitespace outside the emphasis markers — `**text **` is not valid
  // Markdown, and Artemis leaves often carry trailing spaces inside marks.
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const trail = text.match(/\s*$/)?.[0] ?? "";
  let core = text.trim();
  if (node.code) core = `\`${core}\``;
  if (node.bold) core = `**${core}**`;
  if (node.italic) core = `*${core}*`;
  return `${lead}${core}${trail}`;
}

const HEADING_PREFIX: Record<string, string> = {
  h1: "#",
  h2: "##",
  h3: "###",
  h4: "####",
  h5: "#####",
  h6: "######",
};

/**
 * Convert the block tree to Markdown. Lists in Artemis are flat `p` blocks
 * with `listStyleType`/`listStart`/`indent`, so numbering is tracked per
 * consecutive run of list blocks rather than per nested structure.
 */
export function artemisBlocksToMarkdown(blocks: ArtemisBlock[]): {
  markdown: string;
  media: ImportMedia[];
  chartCount: number;
} {
  const out: string[] = [];
  const media: ImportMedia[] = [];
  let chartCount = 0;
  let listCounter = 0;

  for (const block of blocks) {
    const type = block.type ?? "p";

    if (type !== "p" || !block.listStyleType) listCounter = 0;

    if (HEADING_PREFIX[type]) {
      const text = renderInline(block.children, media).trim();
      if (text) out.push(`${HEADING_PREFIX[type]} ${text}`);
      continue;
    }

    if (type === "img") {
      const caption = block.caption?.trim() ?? "";
      if (block.url) {
        media.push({ type: "image", url: block.url, alt: caption || null });
        out.push(`![${caption}](${block.url})`);
        if (caption) out.push(`*${caption}*`);
      }
      continue;
    }

    if (type === "chart") {
      // Charts are interactive widgets we can't embed; keep a textual marker
      // so agents know a visual lived here and what it showed.
      chartCount += 1;
      const title = block.title?.trim() || "Untitled chart";
      media.push({ type: "chart", url: null, alt: title });
      out.push(`*[Chart: ${title}]*`);
      continue;
    }

    if (type === "blockquote") {
      const text = renderInline(block.children, media).trim();
      if (text) out.push(`> ${text}`);
      continue;
    }

    if (type === "hr") {
      out.push("---");
      continue;
    }

    // Paragraphs — possibly list items in disguise.
    const text = renderInline(block.children, media).trim();
    if (!text) continue;
    if (type === "p" && block.listStyleType) {
      const indent = "  ".repeat(Math.max(0, (block.indent ?? 1) - 1));
      if (block.listStyleType === "decimal") {
        listCounter = block.listStart ?? listCounter + 1;
        out.push(`${indent}${listCounter}. ${text}`);
      } else {
        out.push(`${indent}- ${text}`);
      }
      continue;
    }
    out.push(text);
  }

  return { markdown: out.join("\n\n").trim(), media, chartCount };
}

export async function importArtemis(
  url: string,
  deps: ImporterDeps = { fetchDocument: defaultFetch },
): Promise<ImportResult> {
  const { handle, shortId } = parseArticlePath(url);

  let doc: FetchedDocument;
  try {
    doc = await deps.fetchDocument(`${DATA_SERVICE}/${shortId}`);
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError("fetch_failed", "Couldn't fetch the Artemis article.", 502);
  }

  return parseArtemis(url, doc.html, handle, shortId);
}

/** Pure parser, separated so it can be unit-tested against fixture JSON. */
export function parseArtemis(
  sourceUrl: string,
  json: string,
  handle: string,
  shortId: string,
): ImportResult {
  let article: ArtemisArticle;
  try {
    article = JSON.parse(json) as ArtemisArticle;
  } catch {
    throw new ImportError("parse_failed", "The Artemis article returned unreadable content.", 502);
  }
  if (!article || typeof article !== "object" || (!article.title && !article.body)) {
    throw new ImportError("parse_failed", "The Artemis article returned no content.", 502);
  }

  const warnings: string[] = [];
  const blocks = article.body?.blocks ?? [];
  const { markdown, media: bodyMedia, chartCount } = artemisBlocksToMarkdown(blocks);

  if (chartCount > 0) {
    warnings.push(
      `${chartCount === 1 ? "An embedded chart was" : `${chartCount} embedded charts were`} imported as a text note — interactive Artemis charts can't be embedded.`,
    );
  }

  const isPartial = markdown === "";
  if (isPartial) {
    warnings.push("Couldn't extract the article body automatically. Paste the full content manually.");
  }

  const media: ImportMedia[] = [];
  if (article.cover_image_url) {
    media.push({ type: "image", url: article.cover_image_url, alt: null });
  }
  media.push(...bodyMedia);

  const title = article.title?.trim() || null;
  const subtitle = article.subtitle?.trim() || null;
  const body = markdown || null;

  return {
    sourcePlatform: "artemis",
    sourceUrl,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : null,
    authorName: article.author_display_name?.trim() || null,
    authorHandle: article.author_handle?.trim() || handle,
    canonicalUrl: `https://www.artemis.ai/${article.author_handle?.trim() || handle}/article/${article.short_id || shortId}`,
    publishedAt: toIso(article.published_at),
    previewText: (markdown ? markdown.slice(0, PREVIEW_CHARS).trim() : null) || subtitle || null,
    body,
    sections: body ? splitSections(body) : [],
    media,
    isPartial,
    warnings,
  };
}
