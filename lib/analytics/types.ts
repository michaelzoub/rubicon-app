import type { ArticleState } from "@/lib/rubicon/types";

export type AnalyticsBackend = "clickhouse" | "postgres";

export type AnalyticsSettlementStatus =
  | "not_applicable"
  | "pending"
  | "confirmed"
  | "completed"
  | "failed";

export interface AnalyticsFreshness {
  latestEventAt: string | null;
  ingestionLagMs: number | null;
  stale: boolean;
}

export interface AnalyticsDailyMetric {
  date: string;
  wordsRead: number;
  paidWords: number;
  agentReads: number;
  uniqueAgents: number;
  grossAmountAtomic: string;
  creatorAmountAtomic: string;
  settledCreatorAmountAtomic: string;
}

export interface AnalyticsRecentRead {
  bundleId: string;
  sessionId: string;
  articleId: string;
  articleTitle: string;
  occurredAt: string;
  accessMode: "paid" | "free";
  wordsRead: number;
  creatorAmountAtomic: string;
  settledCreatorAmountAtomic: string;
  settlementStatus: AnalyticsSettlementStatus;
}

export interface AnalyticsOverviewResponse {
  generatedAt: string;
  freshness: AnalyticsFreshness;
  totals: {
    wordsRead: number;
    paidWords: number;
    agentReads: number;
    uniqueAgents: number;
    grossAmountAtomic: string;
    creatorAmountAtomic: string;
    settledCreatorAmountAtomic: string;
    pendingCreatorAmountAtomic: string;
  };
  daily: AnalyticsDailyMetric[];
  topArticles: Array<{
    articleId: string;
    title: string;
    state: ArticleState;
    accessMode: "paid" | "free";
    wordsRead: number;
    paidWords: number;
    agentReads: number;
    uniqueAgents: number;
    creatorAmountAtomic: string;
    settledCreatorAmountAtomic: string;
    pendingCreatorAmountAtomic: string;
    lastReadAt: string | null;
  }>;
  recentReads: AnalyticsRecentRead[];
}

export interface ArticleAnalyticsResponse {
  generatedAt: string;
  freshness: AnalyticsFreshness;
  article: {
    id: string;
    title: string;
    state: ArticleState;
    accessMode: "paid" | "free";
  };
  totals: {
    wordsRead: number;
    paidWords: number;
    agentReads: number;
    uniqueAgents: number;
    creatorAmountAtomic: string;
    settledCreatorAmountAtomic: string;
    pendingCreatorAmountAtomic: string;
  };
  daily: Array<Omit<AnalyticsDailyMetric, "uniqueAgents">>;
  sections: Array<{
    sectionId: string;
    heading: string;
    wordsRead: number;
    agentReads: number;
  }>;
  recentReads: AnalyticsRecentRead[];
}

export interface AnalyticsDateRange {
  from: string;
  to: string;
  toExclusive: string;
}

export interface AnalyticsArticleMetadata {
  id: string;
  title: string;
  state: ArticleState;
  accessMode: "paid" | "free";
}

export interface AnalyticsSectionMetadata {
  sectionId: string;
  heading: string;
}

export interface RepositoryDailyMetric {
  date: string;
  wordsRead: number;
  paidWords: number;
  agentReads: number;
  uniqueAgents: number;
  grossAmountAtomic: string;
  creatorAmountAtomic: string;
  settledCreatorAmountAtomic: string;
}

export interface RepositoryArticleMetric {
  articleId: string;
  wordsRead: number;
  paidWords: number;
  agentReads: number;
  uniqueAgents: number;
  creatorAmountAtomic: string;
  settledCreatorAmountAtomic: string;
  lastReadAt: string | null;
}

export interface RepositoryRecentRead {
  bundleId: string;
  sessionId: string;
  articleId: string;
  occurredAt: string;
  accessMode: "paid" | "free";
  wordsRead: number;
  creatorAmountAtomic: string;
  settledCreatorAmountAtomic: string;
  settlementStatus: AnalyticsSettlementStatus;
}

export interface RepositoryOverviewData {
  latestEventAt: string | null;
  totals: Omit<AnalyticsOverviewResponse["totals"], "pendingCreatorAmountAtomic">;
  daily: RepositoryDailyMetric[];
  topArticles: RepositoryArticleMetric[];
  recentReads: RepositoryRecentRead[];
}

export interface RepositoryArticleData {
  latestEventAt: string | null;
  totals: Omit<ArticleAnalyticsResponse["totals"], "pendingCreatorAmountAtomic">;
  daily: RepositoryDailyMetric[];
  sections: Array<{ sectionId: string; wordsRead: number; agentReads: number }>;
  recentReads: RepositoryRecentRead[];
}
