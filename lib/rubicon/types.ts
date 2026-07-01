/**
 * Shared TypeScript contract between this frontend and the Rubicon backend
 * (https://github.com/michaelzoub/rubicon).
 *
 * The two sides must agree on: article states, price units, word counting,
 * earnings calculations, wallet behaviour, and error formats. Keep this file
 * as the single source of truth on the client and mirror it on the server.
 */

/** USDC is metered in atomic units (6 decimals). 1 USDC = 1_000_000 atomic. */
export const USDC_DECIMALS = 6;

/** Rubicon's platform fee during the current launch period. */
export const PLATFORM_FEE_PERCENT = 0;

/** Lifecycle states an article can be in. Shared with the persistent schema. */
export type ArticleState = "draft" | "live" | "paused" | "archived" | "deleted";

export const ARTICLE_STATE_LABELS: Record<ArticleState, string> = {
  draft: "Draft",
  live: "Live",
  paused: "Paused",
  archived: "Archived",
  deleted: "Deleted",
};

/**
 * A navigable section of an article. The seller agent uses section titles to
 * guide buyer agents without revealing unpaid body text. Word counts come from
 * the gateway's tokenizer so the UI never diverges from billed usage.
 */
export interface ArticleSection {
  id: string;
  sectionId: string;
  heading: string;
  level: number;
  wordStart: number;
  /** Word count as measured by the gateway tokenizer. */
  wordCount: number;
  ordinal: number;
}

/** Aggregate usage for an article, as recorded by the gateway. */
export interface ArticleUsage {
  wordsRead: number;
  agentReads: number;
  /** Earnings in atomic USDC units. */
  earnings: string;
  /** ISO timestamp of the most recent agent read, or null if never read. */
  lastReadAt: string | null;
}

/** Platforms a draft can be imported from. Mirrors lib/import's ImportSource. */
export type ArticleSourcePlatform = "substack" | "x";

/**
 * Provenance for drafts created via "Import from URL". Persisted alongside the
 * article so the editor can show where content came from and warn when only a
 * partial (preview-only) import was possible.
 */
export interface ArticleImportMeta {
  isImported: boolean;
  sourcePlatform: ArticleSourcePlatform | null;
  sourceUrl: string | null;
  sourceAuthorName: string | null;
  sourceAuthorHandle: string | null;
  /** ISO timestamp of the original post, when the source exposed one. */
  sourcePublishedAt: string | null;
  /** ISO timestamp of when the import ran. */
  importedAt: string | null;
  importWarnings: string[];
  /** True when only public preview/metadata was imported. */
  isPartialImport: boolean;
}

/** The source fields a creator can attach when saving an imported draft. */
export interface ArticleSourceInput {
  platform: ArticleSourcePlatform;
  url: string;
  authorName: string | null;
  authorHandle: string | null;
  publishedAt: string | null;
  warnings: string[];
  isPartial: boolean;
}

export interface Article {
  id: string;
  title: string;
  author: string;
  state: ArticleState;
  /** Import provenance, or null for articles created by hand. */
  importMeta: ArticleImportMeta | null;
  /** Price per single word, in atomic USDC units. */
  pricePerWordAtomic: string;
  /** Optional cap on the total an agent can be charged for one article. */
  maxArticlePriceAtomic: string | null;
  /** Total billable words, as measured by the gateway tokenizer. */
  totalWords: number;
  revision: number;
  sellerAgentConfig: Record<string, unknown> | null;
  sections: ArticleSection[];
  usage: ArticleUsage;
  createdAt: string;
  updatedAt: string;
}

/**
 * A seller-agent session summary for the article detail page. Intentionally
 * omits buyer-sensitive information (identity, prompts, captured content).
 */
export interface SellerAgentSession {
  id: string;
  startedAt: string;
  wordsRead: number;
  /** Earnings from this session, in atomic USDC units. */
  earnings: string;
}

/** Per-section usage so creators can see what agents found useful. */
export interface SectionUsage {
  sectionId: string;
  heading: string;
  wordsRead: number;
}

export interface ArticleDetail extends Article {
  body: string;
  sessions: SellerAgentSession[];
  sectionUsage: SectionUsage[];
  paymentActivity: PaymentActivity[];
}

export interface Creator {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Wallet {
  address: string | null;
  network: string | null;
  verified: boolean;
}

export interface EarningsSummary {
  /** Settled earnings to date, in atomic USDC units. */
  settledEarnings: string;
  wordsPaidFor: number;
  agentReads: number;
  liveArticles: number;
  /** The highest-earning article, when there is activity. */
  topArticle: { id: string; title: string; earnings: string } | null;
}

export type PaymentStatus = "settled" | "pending" | "failed";

export interface PaymentActivity {
  id: string;
  /** ISO timestamp. */
  date: string;
  articleId: string;
  articleTitle: string;
  wordsRead: number;
  /** Gross amount for the words read, in atomic USDC units. */
  grossAmount: string;
  /** Rubicon platform fee, in atomic USDC units. Currently always "0". */
  platformFee: string;
  /** Amount routed to the creator's wallet, in atomic USDC units. */
  creatorAmount: string;
  status: PaymentStatus;
  /** Settlement reference from the payment provider, when available. */
  settlementReference: string | null;
}

/** Section definition sent when creating or updating an article. */
export interface ArticleSectionInput {
  heading: string;
  ordinal: number;
}

export interface CreateArticleInput {
  title: string;
  author: string;
  /** Raw article body. The gateway parses sections and counts words. */
  body: string;
  /** Optional creator overrides for parsed section titles/order/exclusion. */
  sections?: ArticleSectionInput[];
  /** Price per word in atomic USDC units. */
  pricePerWordAtomic: string;
  maxArticlePriceAtomic?: string | null;
  sellerAgentConfig?: Record<string, unknown> | null;
  /** Import provenance when the draft originated from "Import from URL". */
  source?: ArticleSourceInput | null;
}

export type UpdateArticleInput = Partial<
  Pick<CreateArticleInput, "title" | "author" | "body" | "sections" | "pricePerWordAtomic" | "maxArticlePriceAtomic" | "sellerAgentConfig">
>;

export interface UpdateCreatorInput {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface UpdateWalletInput {
  address: string;
  network: string;
  /**
   * Whether the address is proven to be controlled by the creator. The
   * receiving wallet is the creator's own Privy embedded EOA, so connecting it
   * is proof of control — set this true when the saved address matches the
   * embedded wallet. The gateway only settles payouts to verified wallets.
   */
  verified?: boolean;
}

/** A browser-extension token as shown in Settings (never includes the secret). */
export interface ExtensionTokenSummary {
  id: string;
  /** First chars of the token (e.g. "rbx_ab12cd") for recognition. */
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Error envelope the gateway returns on non-2xx responses. */
export interface RubiconErrorBody {
  error: {
    code: string;
    message: string;
  };
}
