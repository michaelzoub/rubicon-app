import "server-only";

import { Pool, type Pool as PgPool } from "pg";
import type { AnalyticsConfig } from "./config";
import { createAnalyticsClickHouseClient, type AnalyticsQueryClient } from "./clickhouse";
import { AnalyticsError } from "./errors";
import { createAnalyticsMetadataRepository, type AnalyticsMetadataRepository } from "./metadata";
import { clickHouseQueries, postgresQueries } from "./queries";
import type {
  AnalyticsDateRange,
  AnalyticsOverviewResponse,
  AnalyticsSettlementStatus,
  ArticleAnalyticsResponse,
  RepositoryArticleData,
  RepositoryArticleMetric,
  RepositoryDailyMetric,
  RepositoryOverviewData,
  RepositoryRecentRead,
} from "./types";

export interface AnalyticsDataRepository {
  overview(creatorId: string, range: AnalyticsDateRange): Promise<RepositoryOverviewData>;
  article(creatorId: string, articleId: string, range: AnalyticsDateRange): Promise<RepositoryArticleData>;
}

export interface AnalyticsService {
  overview(creatorId: string, range: AnalyticsDateRange): Promise<AnalyticsOverviewResponse>;
  article(creatorId: string, articleId: string, range: AnalyticsDateRange): Promise<ArticleAnalyticsResponse>;
}

export function createAnalyticsService(
  config: AnalyticsConfig,
  dependencies: {
    data?: AnalyticsDataRepository;
    metadata?: AnalyticsMetadataRepository;
  } = {},
): AnalyticsService {
  const data = dependencies.data ?? createDataRepository(config);
  const metadata = dependencies.metadata ?? createAnalyticsMetadataRepository();

  return {
    async overview(creatorId, range) {
      const generatedAt = new Date().toISOString();
      const result = await data.overview(creatorId, range);
      const articleIds = [
        ...result.topArticles.map((article) => article.articleId),
        ...result.recentReads.map((read) => read.articleId),
      ];
      const articleMetadata = await metadata.articles(creatorId, articleIds);

      return {
        generatedAt,
        freshness: freshness(result.latestEventAt, generatedAt, config.staleAfterMs),
        totals: { ...result.totals, pendingCreatorAmountAtomic: pendingAtomic(result.totals.creatorAmountAtomic, result.totals.settledCreatorAmountAtomic) },
        daily: result.daily,
        topArticles: result.topArticles.flatMap((metric) => {
          const article = articleMetadata.get(metric.articleId);
          if (!article) return [];
          return [{
            articleId: metric.articleId,
            title: article.title,
            state: article.state,
            accessMode: article.accessMode,
            wordsRead: metric.wordsRead,
            paidWords: metric.paidWords,
            agentReads: metric.agentReads,
            uniqueAgents: metric.uniqueAgents,
            creatorAmountAtomic: metric.creatorAmountAtomic,
            settledCreatorAmountAtomic: metric.settledCreatorAmountAtomic,
            pendingCreatorAmountAtomic: pendingAtomic(metric.creatorAmountAtomic, metric.settledCreatorAmountAtomic),
            lastReadAt: metric.lastReadAt,
          }];
        }),
        recentReads: result.recentReads.flatMap((read) => {
          const article = articleMetadata.get(read.articleId);
          return article ? [{ ...read, articleTitle: article.title }] : [];
        }),
      };
    },

    async article(creatorId, articleId, range) {
      // Ownership is checked before any analytical query so an attacker cannot
      // use timing or error differences to probe another creator's article.
      const article = await metadata.article(creatorId, articleId);
      const generatedAt = new Date().toISOString();
      const result = await data.article(creatorId, articleId, range);
      const sectionMetadata = await metadata.sections(creatorId, articleId, result.sections.map((section) => section.sectionId));
      return {
        generatedAt,
        freshness: freshness(result.latestEventAt, generatedAt, config.staleAfterMs),
        article,
        totals: { ...result.totals, pendingCreatorAmountAtomic: pendingAtomic(result.totals.creatorAmountAtomic, result.totals.settledCreatorAmountAtomic) },
        daily: result.daily.map(({ uniqueAgents: _uniqueAgents, ...daily }) => daily),
        sections: result.sections.map((section) => ({
          ...section,
          heading: sectionMetadata.get(section.sectionId)?.heading ?? "Untitled section",
        })),
        recentReads: result.recentReads.map((read) => ({ ...read, articleTitle: article.title })),
      };
    },
  };
}

export function createDataRepository(config: AnalyticsConfig): AnalyticsDataRepository {
  return config.backend === "clickhouse" ? createClickHouseRepository(config) : createPostgresRepository(config);
}

function createClickHouseRepository(config: AnalyticsConfig): AnalyticsDataRepository {
  if (!config.clickhouse) throw new AnalyticsError(500, "analytics_not_configured", "ClickHouse analytics are not configured.");
  const client = clickHouseClient(config);
  const query = clickHouseQueries(config.clickhouse.database);

  return {
    async overview(creatorId, range) {
      const params = clickHouseParams(creatorId, range, config);
      const [totalRows, distinctRows, dailyRows, topRows, recentRows, freshnessRows] = await Promise.all([
        client.query<AggregateRow>(query.totals, params),
        client.query<DistinctRow>(query.distinctTotals, params),
        client.query<DailyRow>(query.daily, params),
        client.query<ArticleAggregateRow>(query.topArticles, params),
        client.query<RecentReadRow>(query.recentReads, { ...params, articleId: "" }),
        client.query<FreshnessRow>(query.freshness, { ...params, articleId: "" }),
      ]);
      const articleIds = topRows.map((row) => row.article_id);
      const distinctArticleRows = articleIds.length === 0
        ? []
        : await client.query<ArticleDistinctRow>(query.articleDistinct, {
            ...params,
            articleIds,
            articleMetricLimit: config.topArticleLimit,
          });
      const distinctByArticle = new Map(distinctArticleRows.map((row) => [row.article_id, row]));
      const total = totalRows[0];
      const distinct = distinctRows[0];
      return {
        latestEventAt: isoOrNull(freshnessRows[0]?.latest_event_at),
        totals: {
          wordsRead: integer(total?.words_read),
          paidWords: integer(total?.paid_words),
          agentReads: integer(distinct?.agent_reads),
          uniqueAgents: integer(distinct?.unique_agents),
          grossAmountAtomic: atomic(total?.gross_amount_atomic),
          creatorAmountAtomic: atomic(total?.creator_amount_atomic),
          settledCreatorAmountAtomic: atomic(total?.settled_creator_amount_atomic),
        },
        daily: dailyRows.map(mapDaily),
        topArticles: topRows.map((row) => mapArticleMetric(row, distinctByArticle.get(row.article_id))),
        recentReads: recentRows.map(mapRecentRead),
      };
    },

    async article(creatorId, articleId, range) {
      const params = { ...clickHouseParams(creatorId, range, config), articleId };
      const [totalRows, dailyRows, distinctRows, sectionRows, recentRows, freshnessRows] = await Promise.all([
        client.query<ArticleAggregateRow>(query.articleTotals, params),
        client.query<DailyRow>(query.articleDaily, params),
        client.query<ArticleDistinctRow>(query.articleDistinct, {
          ...params,
          articleIds: [articleId],
          articleMetricLimit: 1,
        }),
        client.query<SectionRow>(query.sections, { ...params, sectionLimit: 500 }),
        client.query<RecentReadRow>(query.recentReads, params),
        client.query<FreshnessRow>(query.freshness, params),
      ]);
      const total = totalRows[0];
      const distinct = distinctRows[0];
      return {
        latestEventAt: isoOrNull(freshnessRows[0]?.latest_event_at),
        totals: {
          wordsRead: integer(total?.words_read),
          paidWords: integer(total?.paid_words),
          agentReads: integer(distinct?.agent_reads),
          uniqueAgents: integer(distinct?.unique_agents),
          creatorAmountAtomic: atomic(total?.creator_amount_atomic),
          settledCreatorAmountAtomic: atomic(total?.settled_creator_amount_atomic),
        },
        daily: dailyRows.map(mapDaily),
        sections: sectionRows.map((row) => ({ sectionId: row.section_id, wordsRead: integer(row.words_read), agentReads: integer(row.agent_reads) })),
        recentReads: recentRows.map(mapRecentRead),
      };
    },
  };
}

let cachedClickHouse: { key: string; client: AnalyticsQueryClient } | undefined;
function clickHouseClient(config: AnalyticsConfig): AnalyticsQueryClient {
  const value = config.clickhouse!;
  const key = `${value.url}|${value.username}|${value.database}|${config.queryTimeoutMs}`;
  if (!cachedClickHouse || cachedClickHouse.key !== key) {
    cachedClickHouse = { key, client: createAnalyticsClickHouseClient(config) };
  }
  return cachedClickHouse.client;
}

function clickHouseParams(creatorId: string, range: AnalyticsDateRange, config: AnalyticsConfig): Record<string, unknown> {
  return {
    creatorId,
    fromDate: range.from,
    toDate: range.to,
    fromTimestamp: `${range.from} 00:00:00.000`,
    toExclusiveTimestamp: `${range.toExclusive} 00:00:00.000`,
    dailyLimit: config.maximumRangeDays,
    topArticleLimit: config.topArticleLimit,
    recentReadLimit: config.recentReadLimit,
  };
}

function createPostgresRepository(config: AnalyticsConfig): AnalyticsDataRepository {
  const pool = postgresPool(config);
  return {
    async overview(creatorId, range) {
      const values = [creatorId, range.from, range.toExclusive];
      try {
        const [totals, daily, top, recent, fresh] = await Promise.all([
          pool.query<AggregateAndDistinctRow>(postgresQueries.totals, values),
          pool.query<DailyRow>(postgresQueries.daily, [...values, config.maximumRangeDays]),
          pool.query<ArticleMetricRow>(postgresQueries.topArticles, [...values, config.topArticleLimit]),
          pool.query<RecentReadRow>(postgresQueries.recentReads, [...values, "", config.recentReadLimit]),
          pool.query<FreshnessRow>(postgresQueries.freshness, [creatorId, ""]),
        ]);
        const total = totals.rows[0];
        return {
          latestEventAt: isoOrNull(fresh.rows[0]?.latest_event_at),
          totals: {
            wordsRead: integer(total?.words_read),
            paidWords: integer(total?.paid_words),
            agentReads: integer(total?.agent_reads),
            uniqueAgents: integer(total?.unique_agents),
            grossAmountAtomic: atomic(total?.gross_amount_atomic),
            creatorAmountAtomic: atomic(total?.creator_amount_atomic),
            settledCreatorAmountAtomic: atomic(total?.settled_creator_amount_atomic),
          },
          daily: daily.rows.map(mapDaily),
          topArticles: top.rows.map((row) => mapArticleMetric(row, row)),
          recentReads: recent.rows.map(mapRecentRead),
        };
      } catch (error) {
        throw postgresFailure(error);
      }
    },

    async article(creatorId, articleId, range) {
      try {
        const [totals, daily, sections, recent, fresh] = await Promise.all([
          pool.query<AggregateAndDistinctRow>(postgresQueries.articleTotals, [creatorId, articleId, range.from, range.toExclusive]),
          pool.query<DailyRow>(postgresQueries.articleDaily, [creatorId, articleId, range.from, range.toExclusive, config.maximumRangeDays]),
          pool.query<SectionRow>(postgresQueries.sections, [creatorId, articleId, range.from, range.toExclusive, 500]),
          pool.query<RecentReadRow>(postgresQueries.recentReads, [creatorId, range.from, range.toExclusive, articleId, config.recentReadLimit]),
          pool.query<FreshnessRow>(postgresQueries.freshness, [creatorId, articleId]),
        ]);
        const total = totals.rows[0];
        return {
          latestEventAt: isoOrNull(fresh.rows[0]?.latest_event_at),
          totals: {
            wordsRead: integer(total?.words_read),
            paidWords: integer(total?.paid_words),
            agentReads: integer(total?.agent_reads),
            uniqueAgents: integer(total?.unique_agents),
            creatorAmountAtomic: atomic(total?.creator_amount_atomic),
            settledCreatorAmountAtomic: atomic(total?.settled_creator_amount_atomic),
          },
          daily: daily.rows.map(mapDaily),
          sections: sections.rows.map((row) => ({ sectionId: row.section_id, wordsRead: integer(row.words_read), agentReads: integer(row.agent_reads) })),
          recentReads: recent.rows.map(mapRecentRead),
        };
      } catch (error) {
        throw postgresFailure(error);
      }
    },
  };
}

let cachedPostgres: { key: string; pool: PgPool } | undefined;
function postgresPool(config: AnalyticsConfig): PgPool {
  if (!config.postgresUrl) throw new AnalyticsError(500, "analytics_not_configured", "Postgres analytics are not configured.");
  const key = `${config.postgresUrl}|${config.queryTimeoutMs}`;
  if (!cachedPostgres || cachedPostgres.key !== key) {
    cachedPostgres = {
      key,
      pool: new Pool({
        connectionString: config.postgresUrl,
        max: 5,
        connectionTimeoutMillis: config.queryTimeoutMs,
        statement_timeout: config.queryTimeoutMs,
        query_timeout: config.queryTimeoutMs,
      }),
    };
  }
  return cachedPostgres.pool;
}

function postgresFailure(error: unknown): AnalyticsError {
  return new AnalyticsError(503, "analytics_unavailable", "Analytics are temporarily unavailable.", { cause: error });
}

type AggregateRow = {
  words_read?: string | null;
  paid_words?: string | null;
  gross_amount_atomic?: string | null;
  creator_amount_atomic?: string | null;
  settled_creator_amount_atomic?: string | null;
};
type DistinctRow = { agent_reads?: string | null; unique_agents?: string | null };
type AggregateAndDistinctRow = AggregateRow & DistinctRow;
type DailyRow = AggregateAndDistinctRow & { date: string };
type ArticleAggregateRow = AggregateRow & { article_id: string };
type ArticleDistinctRow = DistinctRow & { article_id: string; last_read_at?: string | null };
type ArticleMetricRow = ArticleAggregateRow & ArticleDistinctRow;
type FreshnessRow = { latest_event_at?: string | null };
type SectionRow = { section_id: string; words_read?: string | null; agent_reads?: string | null };
type RecentReadRow = {
  bundle_id: string;
  session_id: string;
  article_id: string;
  occurred_at: string;
  access_mode: string;
  words_read?: string | null;
  creator_amount_atomic?: string | null;
  settled_creator_amount_atomic?: string | null;
  settlement_status?: string | null;
};

function mapDaily(row: DailyRow): RepositoryDailyMetric {
  return {
    date: row.date,
    wordsRead: integer(row.words_read),
    paidWords: integer(row.paid_words),
    agentReads: integer(row.agent_reads),
    uniqueAgents: integer(row.unique_agents),
    grossAmountAtomic: atomic(row.gross_amount_atomic),
    creatorAmountAtomic: atomic(row.creator_amount_atomic),
    settledCreatorAmountAtomic: atomic(row.settled_creator_amount_atomic),
  };
}

function mapArticleMetric(row: ArticleAggregateRow, distinct?: ArticleDistinctRow): RepositoryArticleMetric {
  return {
    articleId: row.article_id,
    wordsRead: integer(row.words_read),
    paidWords: integer(row.paid_words),
    agentReads: integer(distinct?.agent_reads),
    uniqueAgents: integer(distinct?.unique_agents),
    creatorAmountAtomic: atomic(row.creator_amount_atomic),
    settledCreatorAmountAtomic: atomic(row.settled_creator_amount_atomic),
    lastReadAt: isoOrNull(distinct?.last_read_at),
  };
}

function mapRecentRead(row: RecentReadRow): RepositoryRecentRead {
  const accessMode = row.access_mode === "free" ? "free" : "paid";
  return {
    bundleId: row.bundle_id,
    sessionId: row.session_id,
    articleId: row.article_id,
    occurredAt: isoOrNull(row.occurred_at) ?? row.occurred_at,
    accessMode,
    wordsRead: integer(row.words_read),
    creatorAmountAtomic: atomic(row.creator_amount_atomic),
    settledCreatorAmountAtomic: atomic(row.settled_creator_amount_atomic),
    settlementStatus: settlementStatus(accessMode, row.settlement_status),
  };
}

export function settlementStatus(accessMode: "paid" | "free", value: string | null | undefined): AnalyticsSettlementStatus {
  if (accessMode === "free") return "not_applicable";
  if (value === "confirmed" || value === "completed" || value === "failed") return value;
  return "pending";
}

export function pendingAtomic(total: string, settled: string): string {
  const pending = BigInt(atomic(total)) - BigInt(atomic(settled));
  return (pending > BigInt(0) ? pending : BigInt(0)).toString();
}

function atomic(value: string | number | null | undefined): string {
  const candidate = value === null || value === undefined || value === "" ? "0" : String(value);
  if (!/^-?\d+$/.test(candidate)) throw new AnalyticsError(503, "analytics_invalid_result", "Analytics returned an invalid atomic amount.");
  return BigInt(candidate).toString();
}

function integer(value: string | number | null | undefined): number {
  const candidate = atomic(value);
  const parsed = BigInt(candidate);
  if (parsed < BigInt(0) || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AnalyticsError(503, "analytics_invalid_result", "Analytics returned a count outside the supported range.");
  }
  return Number(parsed);
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function freshness(latestEventAt: string | null, generatedAt: string, staleAfterMs: number) {
  if (!latestEventAt) return { latestEventAt: null, ingestionLagMs: null, stale: false };
  const lag = Math.max(0, new Date(generatedAt).getTime() - new Date(latestEventAt).getTime());
  return { latestEventAt, ingestionLagMs: lag, stale: lag > staleAfterMs };
}
