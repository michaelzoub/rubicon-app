/**
 * Write side of the semantic-search embeddings contract.
 *
 * The Rubicon gateway reads per-section vectors from `article_section_embeddings`
 * (via the `search_article_sections` RPC) to power /v1/search, but it is
 * READ-ONLY on that index — this repo owns the writes. See the gateway's
 * docs/embeddings-contract.md for the authoritative contract; this module is the
 * single-article, lifecycle-driven counterpart to the gateway's batch
 * `backfill-embeddings.ts`, and mirrors its section slicing, hashing, upsert, and
 * adaptive truncation exactly so the vectors line up with what search scores.
 *
 * Writes require the Supabase *service role* (RLS grants anon SELECT only) and
 * `OPENAI_API_KEY`. Callers pass a service-role client (see
 * `import-server.ts#serviceClient`). When `OPENAI_API_KEY` is unset the sync
 * degrades to deletes only — the gateway tolerates missing rows and falls back
 * to lexical scoring — so a publish never fails just because the key is absent.
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
/** OpenAI accepts array input; keep batches modest to stay within token limits. */
const EMBED_BATCH_SIZE = 64;

/**
 * The atomic content unit is one word: a maximal run of non-whitespace. This is
 * byte-for-byte the gateway's `tokenizeWords` (apps/gateway/src/words.ts) — the
 * embedded slice MUST come from the same tokenization the gateway serves and
 * scores against, or semantic hits point at the wrong text.
 */
function tokenizeWords(content: string): string[] {
  return content.trim().split(/\s+/).filter(Boolean);
}

/**
 * Reconcile a stored section range against the actual tokenized body, matching
 * the gateway's `clampSectionsToWords`. Stored `word_start`/`word_count` can
 * drift from the body (e.g. an edit shortened the text but the section rows were
 * recomputed differently); clamping keeps the embedded slice a subset of the
 * sliceable words, so it equals exactly what the gateway delivers.
 */
function clampRange(wordStart: number, wordCount: number, total: number): { wordStart: number; wordCount: number } {
  const start = Math.max(0, Math.min(wordStart, total));
  return { wordStart: start, wordCount: Math.max(0, Math.min(wordCount, total - start)) };
}

/** sha256 of the exact text that gets embedded, per the contract. */
function hashInput(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Raised when OpenAI rejects an input for exceeding the 8192-token limit. */
class InputTooLongError extends Error {}

/** One raw call to the embeddings API for a batch of strings, in order. */
async function callEmbeddings(apiKey: string, inputs: string[]): Promise<number[][]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    // Never pass `dimensions`: the vector(1536) column rejects anything else,
    // and the contract mandates the model's native 1536-dim output.
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && /maximum input length/i.test(text)) {
      throw new InputTooLongError(text);
    }
    throw new Error(`OpenAI embeddings failed: ${response.status} ${text}`);
  }
  const body = (await response.json()) as { data?: Array<{ embedding?: number[]; index?: number }> };
  const data = body.data ?? [];
  if (data.length !== inputs.length) {
    throw new Error(`OpenAI returned ${data.length} embeddings for ${inputs.length} inputs`);
  }
  // Reorder defensively by `index` — the API returns in-order, but do not assume.
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((row) => {
    const embedding = row.embedding ?? [];
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding has ${embedding.length} dims, expected ${EMBEDDING_DIMENSIONS}`);
    }
    return embedding;
  });
}

/**
 * Embed a single oversized input by halving its characters until it fits under
 * the 8192-token limit. Token density varies wildly (CJK/code can be >1
 * token/char), so we probe by retrying rather than guessing a fixed cap.
 */
async function embedTruncated(apiKey: string, input: string): Promise<number[]> {
  let text = input;
  while (text.length > 0) {
    try {
      const [embedding] = await callEmbeddings(apiKey, [text]);
      return embedding!;
    } catch (error) {
      if (!(error instanceof InputTooLongError)) throw error;
      text = text.slice(0, Math.floor(text.length / 2));
    }
  }
  throw new Error("Unable to embed input even after truncation to empty.");
}

/**
 * Embed a batch, returning vectors in order. On a length rejection, recursively
 * split the batch to isolate the oversized input, then truncate just that one —
 * so one long section never fails the whole run or penalizes its neighbours.
 */
async function embedBatch(apiKey: string, inputs: string[]): Promise<number[][]> {
  try {
    return await callEmbeddings(apiKey, inputs);
  } catch (error) {
    if (!(error instanceof InputTooLongError)) throw error;
    if (inputs.length === 1) {
      return [await embedTruncated(apiKey, inputs[0]!)];
    }
    const mid = Math.floor(inputs.length / 2);
    const left = await embedBatch(apiKey, inputs.slice(0, mid));
    const right = await embedBatch(apiKey, inputs.slice(mid));
    return [...left, ...right];
  }
}

/** pgvector literal: "[v1,v2,...]". PostgREST accepts this string for a vector column. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

interface ArticleRow {
  id: string;
  title: string;
  state: string;
  revision: number;
  body: string;
}

interface SectionRow {
  section_id: string;
  heading: string;
  word_start: number;
  word_count: number;
}

interface SectionWork {
  sectionId: string;
  contentHash: string;
  input: string;
}

export interface EmbeddingSyncResult {
  /**
   * - `embedded`: the article is live and its vectors were reconciled.
   * - `deleted`: the article is absent or not live; all its rows were removed.
   * - `skipped`: live but `OPENAI_API_KEY` is unset; no vectors written.
   */
  status: "embedded" | "deleted" | "skipped";
  embedded: number;
  unchanged: number;
  deleted: number;
}

/**
 * Reconcile `article_section_embeddings` for a single article against its
 * current DB state. Idempotent and safe to call from any lifecycle transition:
 *
 * - Article missing or `state !== 'live'` → delete all of its embedding rows so
 *   stale/unpublished content never surfaces (hard deletes are already covered
 *   by the FK's `on delete cascade`; this handles soft state changes).
 * - Live → embed each section's `${title}\n${heading}\n${bodyText}` (skipping
 *   sections whose `content_hash` is unchanged), upsert on
 *   `(article_id, section_id)`, and delete rows for sections that no longer
 *   exist.
 *
 * `supabase` MUST be a service-role client. Errors propagate to the caller,
 * which treats the sync as best-effort — the gateway tolerates lag.
 */
export async function syncArticleEmbeddings(
  supabase: SupabaseClient,
  articleId: string,
): Promise<EmbeddingSyncResult> {
  const { data: article, error: articleError } = await supabase
    .from("articles")
    .select("id, title, state, revision, body")
    .eq("id", articleId)
    .maybeSingle<ArticleRow>();
  if (articleError) {
    throw new Error(`Failed to load article ${articleId}: ${articleError.message}`);
  }

  // Not live (or gone) ⇒ purge. Deletes need no OpenAI key.
  if (!article || article.state !== "live") {
    const deleted = await deleteAllRows(supabase, articleId);
    return { status: "deleted", embedded: 0, unchanged: 0, deleted };
  }

  const { data: sectionData, error: sectionError } = await supabase
    .from("article_sections")
    .select("section_id, heading, word_start, word_count")
    .eq("article_id", articleId)
    .order("word_start", { ascending: true });
  if (sectionError) {
    throw new Error(`Failed to load sections for ${articleId}: ${sectionError.message}`);
  }
  const sections = (sectionData ?? []) as SectionRow[];

  const { data: existingRows, error: existingError } = await supabase
    .from("article_section_embeddings")
    .select("section_id, content_hash")
    .eq("article_id", articleId);
  if (existingError) {
    throw new Error(`Failed to read existing embeddings for ${articleId}: ${existingError.message}`);
  }
  const existingHashes = new Map<string, string>(
    (existingRows ?? []).map((row) => [row.section_id as string, row.content_hash as string]),
  );

  const words = tokenizeWords(article.body);
  const currentSectionIds = new Set(sections.map((section) => section.section_id));
  const pending: SectionWork[] = [];
  let unchanged = 0;

  for (const section of sections) {
    const { wordStart, wordCount } = clampRange(section.word_start, section.word_count, words.length);
    const bodyText = words.slice(wordStart, wordStart + wordCount).join(" ");
    const input = `${article.title}\n${section.heading}\n${bodyText}`;
    const contentHash = hashInput(input);
    if (existingHashes.get(section.section_id) === contentHash) {
      unchanged += 1;
      continue;
    }
    pending.push({ sectionId: section.section_id, contentHash, input });
  }

  // Rows for sections that no longer exist are stale regardless of the key.
  const staleSectionIds = [...existingHashes.keys()].filter((id) => !currentSectionIds.has(id));
  let deleted = 0;
  if (staleSectionIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("article_section_embeddings")
      .delete()
      .eq("article_id", articleId)
      .in("section_id", staleSectionIds);
    if (deleteError) {
      throw new Error(`Stale delete failed for ${articleId}: ${deleteError.message}`);
    }
    deleted = staleSectionIds.length;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Live but no key: leave existing rows in place and skip new embeds. The
    // gateway scores this article lexically until a run with a key catches up.
    return { status: pending.length > 0 ? "skipped" : "embedded", embedded: 0, unchanged, deleted };
  }

  let embedded = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedBatch(apiKey, batch.map((work) => work.input));
    const rows = batch.map((work, index) => ({
      article_id: articleId,
      section_id: work.sectionId,
      revision: article.revision,
      embedding: toVectorLiteral(vectors[index]!),
      content_hash: work.contentHash,
      model: EMBEDDING_MODEL,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabase
      .from("article_section_embeddings")
      .upsert(rows, { onConflict: "article_id,section_id" });
    if (upsertError) {
      throw new Error(`Upsert failed for ${articleId}: ${upsertError.message}`);
    }
    embedded += rows.length;
  }

  return { status: "embedded", embedded, unchanged, deleted };
}

/**
 * Best-effort embeddings sync for a batch of articles (bulk publish/import).
 * Runs with bounded concurrency and never throws: a failed sync just leaves the
 * gateway scoring that article lexically until the next lifecycle event or
 * backfill. Intended for server routes that already hold a service-role client.
 */
export async function syncArticleEmbeddingsBestEffort(
  supabase: SupabaseClient,
  articleIds: string[],
  concurrency = 4,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, articleIds.length) }, async () => {
    while (next < articleIds.length) {
      const articleId = articleIds[next++]!;
      try {
        await syncArticleEmbeddings(supabase, articleId);
      } catch (error) {
        console.error(`[embeddings] sync failed for ${articleId}`, error instanceof Error ? error.message : error);
      }
    }
  });
  await Promise.all(runners);
}

/** Delete every embedding row for an article; returns the count removed. */
async function deleteAllRows(supabase: SupabaseClient, articleId: string): Promise<number> {
  const { data, error } = await supabase
    .from("article_section_embeddings")
    .delete()
    .eq("article_id", articleId)
    .select("section_id");
  if (error) {
    throw new Error(`Failed to delete embeddings for ${articleId}: ${error.message}`);
  }
  return (data ?? []).length;
}
