/**
 * Supabase-backed dashboard client.
 *
 * The marketing app owns creator-facing CRUD and talks to the shared database
 * directly. The x402 streaming endpoint should read the same tables for live
 * article, pricing, and wallet data.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RECEIVING_NETWORK } from "../chain";
import { accessModeOf, canPublishPaid } from "./access";
import { AGENTCASH_BASE_NETWORK, isAgentCashEnabled, isEvmAddress } from "./agentcash";
import { parseSections } from "./sections";
import { generateExtensionToken, hashExtensionToken, tokenPrefix } from "./extension-tokens";
import type {
  Article,
  ArticleAccessMode,
  ArticleDetail,
  ArticleImportMeta,
  ArticleSection,
  ArticleSourcePlatform,
  AgentCashWallet,
  CreateArticleInput,
  Creator,
  ExtensionTokenSummary,
  UpdateArticleInput,
  UpdateCreatorInput,
  UpdateAgentCashWalletInput,
  UpdateWalletInput,
  Wallet,
} from "./types";

export type RubiconErrorKind = "auth" | "network" | "backend" | "validation" | "not_found";

export class RubiconError extends Error {
  constructor(
    readonly kind: RubiconErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RubiconError";
  }
}

const NETWORK_ERROR_MESSAGE = "Network request failed. Check your connection and try again.";

function isNetworkFailureMessage(message: string) {
  return /load failed|failed to fetch|networkerror|network request failed|fetch failed/i.test(message);
}

export interface CreatorIdentity {
  id: string;
  username: string;
  displayName: string;
}

export interface RubiconClientOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  getToken: () => Promise<string | null>;
  getIdentity: () => CreatorIdentity | null;
  /**
   * Raw Privy access token, used to authenticate the server-only embeddings
   * sync route (`/api/embeddings/sync`). Optional: when absent, the semantic
   * index is simply not refreshed from the browser (the gateway tolerates lag),
   * so tests and unconfigured environments still work.
   */
  getPrivyToken?: () => Promise<string | null>;
}

type CreatorRow = {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
};

type CreatorProfileRow = {
  creator_id: string;
  bio: string | null;
  avatar_url: string | null;
};

type WalletRow = {
  creator_id: string;
  address: string;
  network: string;
  verified: boolean;
};

type AgentCashWalletRow = WalletRow;

type ArticleRow = {
  id: string;
  creator_id: string;
  title: string;
  author: string;
  state: Article["state"];
  // Nullable to tolerate legacy rows written before the column existed.
  access_mode: ArticleAccessMode | null;
  price_per_word_atomic: string;
  max_article_price_atomic: string | null;
  total_words: number;
  revision: number;
  seller_agent_config: Record<string, unknown> | null;
  body: string;
  is_imported: boolean | null;
  source_platform: ArticleSourcePlatform | null;
  source_url: string | null;
  source_author_name: string | null;
  source_author_handle: string | null;
  source_published_at: string | null;
  imported_at: string | null;
  import_warnings: string[] | null;
  is_partial_import: boolean | null;
  created_at: string;
  updated_at: string;
};

// Single source of truth for the article column projection, so every query that
// hydrates an ArticleRow stays in sync (including the import provenance fields).
const ARTICLE_COLUMNS =
  "id, creator_id, title, author, state, access_mode, price_per_word_atomic, max_article_price_atomic, total_words, revision, seller_agent_config, body, is_imported, source_platform, source_url, source_author_name, source_author_handle, source_published_at, imported_at, import_warnings, is_partial_import, created_at, updated_at";

type ArticleSectionRow = {
  id: string;
  article_id: string;
  section_id: string;
  heading: string;
  level: number;
  word_start: number;
  word_count: number;
  ordinal: number;
};

type ExtensionTokenRow = {
  id: string;
  token_prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};


function toRubiconError(error: { code?: string; message?: string } | null, fallback = "Supabase request failed."): RubiconError {
  const code = error?.code ?? "supabase_error";
  const message = error?.message ?? fallback;
  if (isNetworkFailureMessage(message)) {
    return new RubiconError("network", 0, "network_error", NETWORK_ERROR_MESSAGE);
  }
  const kind: RubiconErrorKind = code === "PGRST116" ? "not_found" : code.startsWith("23") ? "validation" : "backend";
  return new RubiconError(kind, 0, code, message);
}

export function toUserFacingRubiconError(err: unknown, fallback = "Unexpected error."): RubiconError {
  if (err instanceof RubiconError) return err;
  if (err instanceof TypeError && isNetworkFailureMessage(err.message)) {
    return new RubiconError("network", 0, "network_error", NETWORK_ERROR_MESSAGE);
  }
  if (err instanceof Error && isNetworkFailureMessage(err.message)) {
    return new RubiconError("network", 0, "network_error", NETWORK_ERROR_MESSAGE);
  }
  return new RubiconError("backend", 0, "unknown", fallback);
}

function requireIdentity(getIdentity: () => CreatorIdentity | null): CreatorIdentity {
  const identity = getIdentity();
  if (!identity) {
    throw new RubiconError("auth", 401, "no_session", "Your session has expired. Sign in again.");
  }
  return identity;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function mapSection(row: ArticleSectionRow): ArticleSection {
  return {
    id: row.id,
    sectionId: row.section_id,
    heading: row.heading,
    level: row.level,
    wordStart: row.word_start,
    wordCount: row.word_count,
    ordinal: row.ordinal,
  };
}

function mapImportMeta(row: ArticleRow): ArticleImportMeta | null {
  if (!row.is_imported) return null;
  return {
    isImported: true,
    sourcePlatform: row.source_platform,
    sourceUrl: row.source_url,
    sourceAuthorName: row.source_author_name,
    sourceAuthorHandle: row.source_author_handle,
    sourcePublishedAt: row.source_published_at,
    importedAt: row.imported_at,
    importWarnings: row.import_warnings ?? [],
    isPartialImport: row.is_partial_import ?? false,
  };
}

function mapArticle(
  row: ArticleRow,
  sections: ArticleSectionRow[],
): Article {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    state: row.state,
    accessMode: accessModeOf(row),
    importMeta: mapImportMeta(row),
    pricePerWordAtomic: row.price_per_word_atomic,
    maxArticlePriceAtomic: row.max_article_price_atomic,
    totalWords: row.total_words,
    revision: row.revision,
    sellerAgentConfig: row.seller_agent_config,
    sections: sections.filter((section) => section.article_id === row.id).sort((a, b) => a.ordinal - b.ordinal).map(mapSection),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function must<T>(promise: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await Promise.resolve(promise).catch((err: unknown) => {
    throw toUserFacingRubiconError(err, "Supabase request failed.");
  });
  if (error) throw toRubiconError(error);
  if (data === null) throw new RubiconError("not_found", 404, "not_found", "Requested data was not found.");
  return data as NonNullable<T>;
}

async function maybe<T>(promise: PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>): Promise<T | null> {
  const { data, error } = await Promise.resolve(promise).catch((err: unknown) => {
    throw toUserFacingRubiconError(err, "Supabase request failed.");
  });
  if (error && error.code !== "PGRST116") throw toRubiconError(error);
  return data;
}

export function createRubiconClient({ supabaseUrl, supabaseAnonKey, getToken, getIdentity, getPrivyToken }: RubiconClientOptions) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: getToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient;

  // Reconcile the semantic-search index after a lifecycle change. Embedding
  // writes need the service role + OPENAI_API_KEY, so the actual work happens
  // server-side; here we just notify that route. Best-effort by design: the
  // gateway falls back to lexical scoring when rows lag, so a failed or skipped
  // sync must never surface as a mutation error.
  async function syncEmbeddings(articleId: string): Promise<void> {
    if (!getPrivyToken) return;
    try {
      const token = await getPrivyToken();
      if (!token) return;
      await fetch("/api/embeddings/sync", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ articleId }),
        keepalive: true,
      });
    } catch {
      // Swallow — the index will catch up on the next lifecycle event or backfill.
    }
  }

  async function ensureCreator(): Promise<Creator> {
    const identity = requireIdentity(getIdentity);
    const creator = await must(
      supabase
        .from("creators")
        .upsert(
          {
            id: identity.id,
            username: identity.username,
            display_name: identity.displayName,
          },
          { onConflict: "id" },
        )
        .select("id, username, display_name, created_at")
        .single<CreatorRow>(),
    );

    const profile = await maybe(
      supabase
        .from("creator_profiles")
        .select("creator_id, bio, avatar_url")
        .eq("creator_id", identity.id)
        .maybeSingle<CreatorProfileRow>(),
    );

    return {
      id: creator.id,
      username: creator.username,
      displayName: creator.display_name,
      bio: profile?.bio ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      createdAt: creator.created_at,
    };
  }

  async function articleContext(creatorId: string, articleId?: string) {
    let articleQuery = supabase
      .from("articles")
      .select(ARTICLE_COLUMNS)
      .eq("creator_id", creatorId)
      .neq("state", "deleted")
      .order("updated_at", { ascending: false });

    if (articleId) articleQuery = articleQuery.eq("id", articleId);

    const articles = await must(articleQuery.returns<ArticleRow[]>());
    const articleIds = articles.map((article) => article.id);

    if (articleIds.length === 0) {
      return { articles, sections: [] };
    }

    const sections = await must(
      supabase
        .from("article_sections")
        .select("id, article_id, section_id, heading, level, word_start, word_count, ordinal")
        .in("article_id", articleIds)
        .order("ordinal", { ascending: true })
        .returns<ArticleSectionRow[]>(),
    );

    return { articles, sections };
  }

  async function replaceSections(articleId: string, body: string, inputSections: CreateArticleInput["sections"] = []) {
    const parsed = parseSections(body);
    const ordered = parsed.map((section, index) => ({
      ...section,
      heading: inputSections[index]?.heading?.trim() || section.title,
      ordinal: inputSections[index]?.ordinal ?? index,
    }));

    const rows = ordered
      .sort((a, b) => a.ordinal - b.ordinal)
      .reduce<Array<Omit<ArticleSectionRow, "article_id"> & { article_id: string }>>((acc, section, index) => {
        const wordStart = acc.reduce((sum, row) => sum + row.word_count, 0);
        acc.push({
          id: randomId("section"),
          article_id: articleId,
          section_id: `section-${index + 1}`,
          heading: section.heading,
          level: 1,
          word_start: wordStart,
          word_count: section.wordCount,
          ordinal: index,
        });
        return acc;
      }, []);

    await must(supabase.from("article_sections").delete().eq("article_id", articleId).select("id").returns<Array<{ id: string }>>());
    if (rows.length > 0) {
      await must(supabase.from("article_sections").insert(rows).select("id").returns<Array<{ id: string }>>());
    }

    return rows.reduce((sum, row) => sum + row.word_count, 0);
  }

  return {
    async getCreator() {
      return ensureCreator();
    },

    async updateCreator(input: UpdateCreatorInput) {
      const identity = requireIdentity(getIdentity);
      if (input.displayName !== undefined) {
        await must(
          supabase
            .from("creators")
            .update({ display_name: input.displayName })
            .eq("id", identity.id)
            .select("id")
            .single<{ id: string }>(),
        );
      }
      if (input.bio !== undefined || input.avatarUrl !== undefined) {
        await must(
          supabase
            .from("creator_profiles")
            .upsert(
              {
                creator_id: identity.id,
                ...(input.bio !== undefined ? { bio: input.bio } : {}),
                ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
              },
              { onConflict: "creator_id" },
            )
            .select("creator_id")
            .single<{ creator_id: string }>(),
        );
      }
      return ensureCreator();
    },

    async getWallet(): Promise<Wallet> {
      const identity = requireIdentity(getIdentity);
      const wallet = await maybe(
        supabase
          .from("creator_wallets")
          .select("creator_id, address, network, verified")
          .eq("creator_id", identity.id)
          .eq("network", RECEIVING_NETWORK)
          .maybeSingle<WalletRow>(),
      );
      return {
        address: wallet?.address ?? null,
        network: wallet?.network ?? null,
        verified: wallet?.verified ?? false,
      };
    },

    async updateWallet(input: UpdateWalletInput): Promise<Wallet> {
      const identity = requireIdentity(getIdentity);
      const wallet = await must(
        supabase
          .from("creator_wallets")
          .upsert(
            {
              creator_id: identity.id,
              address: input.address,
              network: input.network,
              verified: input.verified ?? false,
            },
            { onConflict: "creator_id,network" },
          )
          .select("creator_id, address, network, verified")
          .single<WalletRow>(),
      );
      return {
        address: wallet.address,
        network: wallet.network,
        verified: wallet.verified,
      };
    },

    async getAgentCashWallet(): Promise<AgentCashWallet> {
      if (!isAgentCashEnabled()) {
        return { address: null, network: null, verified: false };
      }
      const identity = requireIdentity(getIdentity);
      const wallet = await maybe(
        supabase
          .from("creator_wallets")
          .select("creator_id, address, network, verified")
          .eq("creator_id", identity.id)
          .eq("network", AGENTCASH_BASE_NETWORK)
          .maybeSingle<AgentCashWalletRow>(),
      );
      return {
        address: wallet?.address ?? null,
        network: wallet?.network ?? null,
        verified: wallet?.verified ?? false,
      };
    },

    async updateAgentCashWallet(input: UpdateAgentCashWalletInput): Promise<AgentCashWallet> {
      if (!isAgentCashEnabled()) {
        throw new RubiconError("not_found", 404, "not_found", "AgentCash is not available.");
      }
      if (!isEvmAddress(input.address)) {
        throw new RubiconError("validation", 0, "invalid_wallet_address", "Connect a valid EVM wallet before saving it for AgentCash.");
      }
      const token = await getPrivyToken?.();
      if (!token) {
        throw new RubiconError("auth", 401, "wallet_verification_required", "Sign in again before connecting a Base wallet.");
      }
      const response = await fetch("/api/agentcash/wallet", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ address: input.address }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        wallet?: Pick<AgentCashWallet, "address" | "network" | "verified">;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || !body.wallet?.address || !body.wallet.network) {
        throw new RubiconError(
          response.status === 401 ? "auth" : response.status < 500 ? "validation" : "backend",
          response.status,
          body.error?.code ?? "wallet_save_failed",
          body.error?.message ?? "Could not save this Base wallet.",
        );
      }
      return {
        address: body.wallet.address,
        network: body.wallet.network,
        verified: body.wallet.verified,
      };
    },

    async listArticles(): Promise<Article[]> {
      const identity = requireIdentity(getIdentity);
      const { articles, sections } = await articleContext(identity.id);
      return articles.map((article) => mapArticle(article, sections));
    },

    async createArticle(input: CreateArticleInput): Promise<Article> {
      const identity = requireIdentity(getIdentity);
      await ensureCreator();

      const id = randomId("article");
      const now = new Date().toISOString();
      const totalWords = parseSections(input.body).reduce((sum, section) => sum + section.wordCount, 0);

      const source = input.source ?? null;
      const article = await must(
        supabase
          .from("articles")
          .insert({
            id,
            creator_id: identity.id,
            title: input.title,
            author: input.author,
            state: "draft",
            access_mode: input.accessMode ?? "paid",
            price_per_word_atomic: input.pricePerWordAtomic,
            max_article_price_atomic: input.maxArticlePriceAtomic ?? null,
            total_words: totalWords,
            revision: 1,
            seller_agent_config: input.sellerAgentConfig ?? null,
            body: input.body,
            is_imported: source !== null,
            source_platform: source?.platform ?? null,
            source_url: source?.url ?? null,
            source_author_name: source?.authorName ?? null,
            source_author_handle: source?.authorHandle ?? null,
            source_published_at: source?.publishedAt ?? null,
            imported_at: source ? now : null,
            import_warnings: source?.warnings ?? [],
            is_partial_import: source?.isPartial ?? false,
            updated_at: now,
          })
          .select(ARTICLE_COLUMNS)
          .single<ArticleRow>(),
      );

      await must(
        supabase
          .from("article_revisions")
          .insert({
            id: randomId("revision"),
            article_id: id,
            revision: 1,
            body: input.body,
          })
          .select("id")
          .single<{ id: string }>(),
      );

      const authoritativeWords = await replaceSections(id, input.body, input.sections);
      if (authoritativeWords !== totalWords) {
        await must(supabase.from("articles").update({ total_words: authoritativeWords }).eq("id", id).select("id").single<{ id: string }>());
        article.total_words = authoritativeWords;
      }

      return mapArticle(article, []);
    },

    async getArticle(articleId: string): Promise<ArticleDetail> {
      const identity = requireIdentity(getIdentity);
      const { articles, sections } = await articleContext(identity.id, articleId);
      const article = articles[0];
      if (!article) throw new RubiconError("not_found", 404, "article_not_found", "Article not found.");
      return {
        ...mapArticle(article, sections),
        body: article.body,
      };
    },

    async updateArticle(articleId: string, input: UpdateArticleInput): Promise<Article> {
      const identity = requireIdentity(getIdentity);
      const current = await this.getArticle(articleId);
      let nextRevision = current.revision;
      let totalWords = current.totalWords;

      if (input.body !== undefined || input.sections !== undefined) {
        const body = input.body ?? current.body;
        totalWords = await replaceSections(articleId, body, input.sections);
        nextRevision = current.revision + 1;
        await must(
          supabase
            .from("article_revisions")
            .insert({
              id: randomId("revision"),
              article_id: articleId,
              revision: nextRevision,
              body,
            })
            .select("id")
            .single<{ id: string }>(),
        );
      }

      const updates = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.accessMode !== undefined ? { access_mode: input.accessMode } : {}),
        ...(input.pricePerWordAtomic !== undefined ? { price_per_word_atomic: input.pricePerWordAtomic } : {}),
        ...(input.maxArticlePriceAtomic !== undefined ? { max_article_price_atomic: input.maxArticlePriceAtomic } : {}),
        ...(input.sellerAgentConfig !== undefined ? { seller_agent_config: input.sellerAgentConfig } : {}),
        total_words: totalWords,
        revision: nextRevision,
        updated_at: new Date().toISOString(),
      };

      await must(supabase.from("articles").update(updates).eq("id", articleId).eq("creator_id", identity.id).select("id").single<{ id: string }>());
      // Re-embed on any change to the embedded input (title, body, or section
      // headings/ranges); pricing/access-mode edits don't affect the vectors.
      if (input.title !== undefined || input.body !== undefined || input.sections !== undefined) {
        void syncEmbeddings(articleId);
      }
      return this.getArticle(articleId);
    },

    async publishArticle(articleId: string): Promise<Article> {
      const identity = requireIdentity(getIdentity);

      // Paid articles must have somewhere for money to land and a price to
      // charge; free articles need neither. Enforced here because the rule is
      // business logic the database can't express. Free is a deliberate choice,
      // so a zero-priced *paid* article is a misconfiguration, not "free".
      const article = await must(
        supabase
          .from("articles")
          .select("access_mode, price_per_word_atomic")
          .eq("id", articleId)
          .eq("creator_id", identity.id)
          .single<Pick<ArticleRow, "access_mode" | "price_per_word_atomic">>(),
      );
      if (accessModeOf(article) === "paid") {
        const wallet = await maybe(
          supabase
            .from("creator_wallets")
            .select("verified")
            .eq("creator_id", identity.id)
            .eq("network", RECEIVING_NETWORK)
            .maybeSingle<{ verified: boolean }>(),
        );
        if (!canPublishPaid(article.price_per_word_atomic, wallet?.verified ?? false)) {
          // Surface the specific unmet requirement so the creator knows what to fix.
          if (!(Number(article.price_per_word_atomic) > 0)) {
            throw new RubiconError("validation", 0, "price_required", "Set a price per word before publishing, or mark this article free.");
          }
          throw new RubiconError("validation", 0, "wallet_required", "Connect and verify a receiving wallet before publishing a paid article.");
        }
      }

      await must(
        supabase
          .from("articles")
          .update({ state: "live", updated_at: new Date().toISOString() })
          .eq("id", articleId)
          .eq("creator_id", identity.id)
          .select("id")
          .single<{ id: string }>(),
      );
      // Now live: populate the semantic index for this article's sections.
      void syncEmbeddings(articleId);
      return this.getArticle(articleId);
    },

    async pauseArticle(articleId: string): Promise<Article> {
      const identity = requireIdentity(getIdentity);
      await must(
        supabase
          .from("articles")
          .update({ state: "paused", updated_at: new Date().toISOString() })
          .eq("id", articleId)
          .eq("creator_id", identity.id)
          .select("id")
          .single<{ id: string }>(),
      );
      // No longer live: drop its rows so stale hits don't surface in search.
      void syncEmbeddings(articleId);
      return this.getArticle(articleId);
    },

    async archiveArticle(articleId: string): Promise<void> {
      const identity = requireIdentity(getIdentity);
      await must(
        supabase
          .from("articles")
          .update({ state: "archived", updated_at: new Date().toISOString() })
          .eq("id", articleId)
          .eq("creator_id", identity.id)
          .select("id")
          .single<{ id: string }>(),
      );
      // No longer live: drop its rows so stale hits don't surface in search.
      void syncEmbeddings(articleId);
    },

    async deleteArticle(articleId: string): Promise<void> {
      requireIdentity(getIdentity);
      const deleted = await must(
        supabase.rpc("delete_article_permanently", { target_article_id: articleId }),
      );
      if (deleted !== true) {
        throw new RubiconError("not_found", 404, "article_not_found", "Article was not found or you do not have permission to delete it.");
      }
    },

    // --- Browser-extension tokens -------------------------------------------
    // Tokens authenticate the "Send to Rubicon" Chrome extension. We never store
    // or return the plaintext: the browser generates it, shows it once, and
    // persists only its SHA-256 hash (see lib/rubicon/extension-tokens.ts).

    async listExtensionTokens(): Promise<ExtensionTokenSummary[]> {
      const identity = requireIdentity(getIdentity);
      const rows = await must(
        supabase
          .from("extension_tokens")
          .select("id, token_prefix, label, created_at, last_used_at, revoked_at")
          .eq("creator_id", identity.id)
          .order("created_at", { ascending: false })
          .returns<ExtensionTokenRow[]>(),
      );
      return rows.map((row) => ({
        id: row.id,
        prefix: row.token_prefix,
        label: row.label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
      }));
    },

    /**
     * Mint a new extension token. Returns the plaintext token exactly once —
     * the caller must surface it immediately; it cannot be retrieved again.
     */
    async createExtensionToken(label?: string): Promise<{ token: string; summary: ExtensionTokenSummary }> {
      const identity = requireIdentity(getIdentity);
      await ensureCreator();
      const token = generateExtensionToken();
      const tokenHash = await hashExtensionToken(token);
      const row = await must(
        supabase
          .from("extension_tokens")
          .insert({
            id: randomId("exttok"),
            creator_id: identity.id,
            token_hash: tokenHash,
            token_prefix: tokenPrefix(token),
            label: label?.trim() || null,
          })
          .select("id, token_prefix, label, created_at, last_used_at, revoked_at")
          .single<ExtensionTokenRow>(),
      );
      return {
        token,
        summary: {
          id: row.id,
          prefix: row.token_prefix,
          label: row.label,
          createdAt: row.created_at,
          lastUsedAt: row.last_used_at,
          revokedAt: row.revoked_at,
        },
      };
    },

    async revokeExtensionToken(tokenId: string): Promise<void> {
      const identity = requireIdentity(getIdentity);
      await must(
        supabase
          .from("extension_tokens")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", tokenId)
          .eq("creator_id", identity.id)
          .select("id")
          .single<{ id: string }>(),
      );
    },
  };
}

export type RubiconClient = ReturnType<typeof createRubiconClient>;
