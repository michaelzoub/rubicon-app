import * as cheerio from "cheerio";
import Papa from "papaparse";
import type { AnyNode, Element } from "domhandler";

export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

export interface ExportFile {
  path: string;
  content: Buffer;
}

export interface SubstackSection {
  heading: string | null;
  text: string;
  html: string;
  wordCount: number;
  index: number;
}

export interface SubstackCandidate {
  sourcePostId: string;
  title: string;
  subtitle: string;
  publishedAt: string | null;
  audience: string | null;
  type: string | null;
  wordCount: number;
  linkCount: number;
  hasCode: boolean;
  hasTables: boolean;
  hasNumbers: boolean;
  hasCitations: boolean;
  sanitizedHtml: string;
  originalHtml: string;
  plainText: string;
  sections: SubstackSection[];
  publicIndex: Record<string, unknown>;
  recommendedPricePerWordCents: number;
  estimatedMaxPriceCents: number;
  warning: string | null;
  importable: boolean;
}

type PostRow = Record<string, string | undefined>;

export function safeExportPath(input: string): string {
  const path = input.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path || path.includes("\0") || path.split("/").some((part) => part === "..")) {
    throw new Error("The export contains an unsafe file path.");
  }
  return path;
}

export function isAllowedExportFile(path: string): boolean {
  return /\.(csv|html?|zip)$/i.test(path);
}

export function recommendPricePerWordCents(article: Pick<SubstackCandidate, "wordCount" | "sections" | "linkCount" | "hasCode" | "hasTables" | "hasNumbers" | "hasCitations" | "audience">): number {
  let centsPerWord = 0.015;
  if (article.wordCount < 500) centsPerWord = 0.02;
  if (article.wordCount > 2000) centsPerWord = 0.012;
  if (article.sections.length >= 3) centsPerWord *= 1.15;
  if (article.linkCount >= 5) centsPerWord *= 1.1;
  if (article.hasCode) centsPerWord *= 1.25;
  if (article.hasTables || article.hasNumbers || article.hasCitations) centsPerWord *= 1.25;
  if (article.audience && article.audience.toLowerCase() !== "everyone") centsPerWord *= 1.35;
  return Math.round(Math.min(0.08, Math.max(0.005, centsPerWord)) * 1000) / 1000;
}

export function parseSubstackExport(files: ExportFile[]): SubstackCandidate[] {
  const normalized = files.map((file) => ({ ...file, path: safeExportPath(file.path) }));
  const csv = normalized.find((file) => /(^|\/)posts\.csv$/i.test(file.path));
  if (!csv) throw new Error("posts.csv was not found in this export.");

  const parsed = Papa.parse<PostRow>(csv.content.toString("utf8"), { header: true, skipEmptyLines: true });
  if (parsed.errors.length && parsed.data.length === 0) throw new Error("posts.csv could not be read.");

  const htmlFiles = normalized.filter((file) => /\.html?$/i.test(file.path));
  const publishedRows = parsed.data.filter((row) => String(row.is_published ?? "").toLowerCase() === "true");

  return publishedRows.map((row) => buildCandidate(row, findPostHtml(row, htmlFiles, publishedRows)));
}

/**
 * Substack has shipped several export filename layouts. Older exports prefix
 * HTML files with the post id, while newer/custom publication exports may use
 * only the post slug. Match the strongest identifiers first and only accept a
 * slug/title match when it identifies one file and one published CSV row.
 */
function findPostHtml(row: PostRow, htmlFiles: ExportFile[], rows: PostRow[]): ExportFile | undefined {
  const postId = String(row.post_id ?? "").trim();
  if (postId) {
    const idMatches = htmlFiles.filter((file) => filenameTokens(file.path).includes(normalizeKey(postId)));
    if (idMatches.length === 1) return idMatches[0];
  }

  const rowKeys = rowMatchKeys(row);
  if (!rowKeys.length) return undefined;
  const matches = htmlFiles.filter((file) => rowKeys.includes(fileStemKey(file.path)));
  if (matches.length !== 1) return undefined;

  const matchedKey = fileStemKey(matches[0].path);
  const matchingRows = rows.filter((candidate) => rowMatchKeys(candidate).includes(matchedKey));
  return matchingRows.length === 1 ? matches[0] : undefined;
}

function rowMatchKeys(row: PostRow): string[] {
  const values = [row.slug, row.post_slug, row.canonical_url, row.url];
  const keys = values.flatMap((value) => {
    if (!value) return [];
    try {
      const pathname = new URL(value).pathname;
      return [pathname.split("/").filter(Boolean).pop() ?? ""];
    } catch {
      return [value];
    }
  });
  if (row.title) keys.push(row.title);
  return [...new Set(keys.map(normalizeKey).filter(Boolean))];
}

function fileStemKey(path: string): string {
  const stem = path.split("/").pop()?.replace(/\.html?$/i, "") ?? "";
  // Strip the numeric id prefix used by classic Substack exports.
  return normalizeKey(stem.replace(/^\d+[._-]+/, ""));
}

function filenameTokens(path: string): string[] {
  const stem = path.split("/").pop()?.replace(/\.html?$/i, "") ?? "";
  return stem.split(/[._-]+/).map(normalizeKey).filter(Boolean);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildCandidate(row: PostRow, htmlFile?: ExportFile): SubstackCandidate {
  const sourcePostId = String(row.post_id ?? "").trim();
  if (!htmlFile) {
    return {
      sourcePostId,
      title: row.title?.trim() || sourcePostId || "Untitled post",
      subtitle: row.subtitle?.trim() || "",
      publishedAt: validDate(row.post_date), audience: row.audience || null, type: row.type || null,
      wordCount: 0, linkCount: 0, hasCode: false, hasTables: false, hasNumbers: false, hasCitations: false,
      sanitizedHtml: "", originalHtml: "", plainText: "", sections: [], publicIndex: {},
      recommendedPricePerWordCents: 0.015, estimatedMaxPriceCents: 0,
      warning: "Missing HTML file", importable: false,
    };
  }

  const originalHtml = htmlFile.content.toString("utf8");
  const $ = cheerio.load(originalHtml);
  $("script,style,iframe,noscript,form,object,embed,svg,canvas,video,audio").remove();
  $("img").each((_, element) => {
    const img = $(element);
    const label = img.attr("alt")?.trim() || img.attr("title")?.trim();
    if (label) img.replaceWith(`<p>${escapeHtml(label)}</p>`); else img.remove();
  });
  $("*").each((_, element) => {
    const node = $(element);
    for (const attr of Object.keys(element.type === "tag" ? (element as Element).attribs : {})) {
      if (attr !== "href") node.removeAttr(attr);
    }
    const href = node.attr("href");
    if (href && !/^https?:\/\//i.test(href)) node.removeAttr("href");
  });

  const root = $("article").first().length ? $("article").first() : $("body");
  const allowed = "h1,h2,h3,h4,p,blockquote,ol,ul,li,a,pre,code,table,thead,tbody,tr,th,td";
  root.find("*").not(allowed).each((_, element) => { $(element).replaceWith($(element).contents()); });
  const sanitizedHtml = root.html()?.trim() ?? "";
  const plainText = normalizeText(root.text());
  const linkCount = root.find("a[href]").length;
  const hasCode = root.find("pre,code").length > 0;
  const hasTables = root.find("table").length > 0;
  const hasNumbers = /\b\d+(?:[.,]\d+)?%?\b/.test(plainText);
  const hasCitations = linkCount > 0 || /\[[0-9]+\]|\b(source|references?|citation)\b/i.test(plainText);
  const sections = extractSections(root, $);
  const wordCount = countWords(plainText);
  const title = row.title?.trim() || root.find("h1").first().text().trim() || slugTitle(htmlFile.path);
  const publicIndex = {
    title,
    subtitle: row.subtitle?.trim() || "",
    headings: sections.map((section) => section.heading).filter(Boolean),
    sectionSummaries: sections.map((section) => section.text.slice(0, 180)),
    wordCount,
    audience: row.audience || null,
  };
  const draft = {
    sourcePostId, title, subtitle: row.subtitle?.trim() || "", publishedAt: validDate(row.post_date),
    audience: row.audience || null, type: row.type || null, wordCount, linkCount, hasCode, hasTables,
    hasNumbers, hasCitations, sanitizedHtml, originalHtml, plainText, sections, publicIndex,
  };
  const recommendedPricePerWordCents = recommendPricePerWordCents(draft);
  return { ...draft, recommendedPricePerWordCents, estimatedMaxPriceCents: wordCount * recommendedPricePerWordCents, warning: null, importable: true };
}

function extractSections(root: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): SubstackSection[] {
  const sections: Array<{ heading: string | null; nodes: AnyNode[] }> = [];
  let current = { heading: null as string | null, nodes: [] as AnyNode[] };
  root.children().each((_, node) => {
    if (/^h[1-4]$/i.test(node.type === "tag" ? node.name : "")) {
      if (current.nodes.length) sections.push(current);
      current = { heading: $(node).text().trim() || null, nodes: [] };
    } else current.nodes.push(node);
  });
  if (current.nodes.length) sections.push(current);
  if (sections.length === 0) sections.push({ heading: null, nodes: root.children().toArray() });

  const expanded = sections.flatMap((section) => {
    const text = normalizeText(section.nodes.map((node) => $(node).text()).join(" "));
    if (section.heading || countWords(text) <= 700) return [section];
    const chunks: typeof sections = [];
    let nodes: AnyNode[] = [];
    let words = 0;
    for (const node of section.nodes) {
      nodes.push(node); words += countWords($(node).text());
      if (words >= 300) { chunks.push({ heading: null, nodes }); nodes = []; words = 0; }
    }
    if (nodes.length) chunks.push({ heading: null, nodes });
    return chunks;
  });
  return expanded.map((section, index) => {
    const text = normalizeText(section.nodes.map((node) => $(node).text()).join(" "));
    return { heading: section.heading, text, html: section.nodes.map((node) => $.html(node)).join(""), wordCount: countWords(text), index };
  }).filter((section) => section.wordCount > 0);
}

function countWords(value: string) { return value.trim() ? value.trim().split(/\s+/).length : 0; }
function normalizeText(value: string) { return value.replace(/\s+/g, " ").trim(); }
function validDate(value?: string) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null; }
function slugTitle(path: string) { return (path.split("/").pop() ?? "Untitled").replace(/^\d+[.-]?/, "").replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled post"; }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
