/**
 * Server-only helpers for the extension import endpoint.
 *
 * These run with the Supabase *service-role* key so the endpoint can:
 *   1. resolve an extension token to its owning creator (the token table is not
 *      readable under RLS by anyone but its owner, and the request carries no
 *      creator session — only the token), and
 *   2. write the draft article + its sections, revision, and import metadata.
 *
 * The service-role key never reaches the browser; it is only read here, on the
 * server. Drafts are always created in the `draft` state — this endpoint can
 * never publish.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseSections } from "./sections";
import { hashExtensionToken } from "./extension-tokens";
import { composeArticleBody, resolveAuthor, resolveTitle, type ExtensionImportPayload } from "./import";

export class ImportServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportServerError";
  }
}

/** Build a service-role Supabase client, or throw if the server isn't configured. */
export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ImportServerError(
      500,
      "server_not_configured",
      "Imports require SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function randomId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

/**
 * Resolve a presented bearer token to the owning creator id, or throw 401.
 * Touches `last_used_at` so creators can see a token is live.
 */
export async function authenticateExtensionToken(supabase: SupabaseClient, token: string): Promise<string> {
  const tokenHash = await hashExtensionToken(token);
  const { data, error } = await supabase
    .from("extension_tokens")
    .select("id, creator_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<{ id: string; creator_id: string; revoked_at: string | null }>();

  if (error) {
    throw new ImportServerError(500, "token_lookup_failed", "Could not verify the extension token.");
  }
  if (!data || data.revoked_at) {
    throw new ImportServerError(401, "invalid_token", "This extension token is invalid or has been revoked.");
  }

  // Best-effort; a failed touch must not block the import.
  await supabase.from("extension_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);

  return data.creator_id;
}

export interface CreatedDraft {
  draftId: string;
  reviewUrl: string;
}

/**
 * Create a `draft` article (plus sections, an initial revision, and import
 * metadata) from a validated, sanitized payload. Mirrors the column shapes the
 * dashboard client writes (`lib/rubicon/client.ts`) so the draft is editable in
 * the existing UI.
 */
export async function createImportDraft(
  supabase: SupabaseClient,
  creatorId: string,
  payload: ExtensionImportPayload,
  appUrl: string,
): Promise<CreatedDraft> {
  // The creator row must exist for the FK / RLS ownership to line up. It is
  // guaranteed to: `extension_tokens.creator_id` is a NOT NULL FK to
  // `creators(id)`, so a token cannot exist without its creator, and the token
  // was just authenticated. We therefore only *verify* the row — we must not
  // upsert it. `creators.username` is NOT NULL with no default, and Postgres
  // checks NOT NULL on the candidate row *before* applying ON CONFLICT DO
  // NOTHING, so an `upsert({ id }, { ignoreDuplicates })` that omits username
  // raises 23502 even when the row already exists, breaking every import.
  const { data: creatorRow, error: creatorError } = await supabase
    .from("creators")
    .select("id")
    .eq("id", creatorId)
    .maybeSingle<{ id: string }>();
  if (creatorError) {
    throw new ImportServerError(500, "creator_lookup_failed", "Could not verify your creator account.");
  }
  if (!creatorRow) {
    throw new ImportServerError(
      404,
      "creator_not_found",
      "Open the Rubicon dashboard once to finish setting up your account, then try again.",
    );
  }

  const articleId = randomId("article");
  const now = new Date().toISOString();
  const body = composeArticleBody(payload);
  const parsed = parseSections(body);
  const totalWords = parsed.reduce((sum, section) => sum + section.wordCount, 0);

  // Provenance is stored as columns on `articles` (see supabase/import-fields.sql),
  // the same schema the dashboard "Import from URL" flow writes via
  // createArticle({ source }). Keeping one schema means imported drafts —
  // however they were created — render identically in the editor.
  const { error: articleError } = await supabase.from("articles").insert({
    id: articleId,
    creator_id: creatorId,
    title: resolveTitle(payload),
    author: resolveAuthor(payload),
    state: "draft",
    price_per_word_atomic: "0",
    max_article_price_atomic: null,
    total_words: totalWords,
    revision: 1,
    seller_agent_config: null,
    body,
    is_imported: true,
    source_platform: payload.sourcePlatform,
    source_url: payload.sourceUrl,
    source_author_name: payload.authorName,
    source_author_handle: payload.authorHandle,
    source_published_at: payload.publishedAt,
    imported_at: now,
    import_warnings: payload.warnings,
    is_partial_import: payload.isPartial,
    updated_at: now,
  });
  if (articleError) {
    throw new ImportServerError(500, "draft_create_failed", "Could not create the draft.");
  }

  // Sections + initial revision mirror createArticle() in the dashboard client.
  const sectionRows = parsed.map((section, index) => {
    const wordStart = parsed.slice(0, index).reduce((sum, s) => sum + s.wordCount, 0);
    return {
      id: randomId("section"),
      article_id: articleId,
      section_id: `section-${index + 1}`,
      heading: section.title,
      level: 1,
      word_start: wordStart,
      word_count: section.wordCount,
      ordinal: index,
    };
  });
  if (sectionRows.length > 0) {
    await supabase.from("article_sections").insert(sectionRows);
  }

  await supabase.from("article_revisions").insert({
    id: randomId("revision"),
    article_id: articleId,
    revision: 1,
    body,
  });

  return {
    draftId: articleId,
    reviewUrl: `${appUrl.replace(/\/$/, "")}/dashboard/imports/${articleId}`,
  };
}
