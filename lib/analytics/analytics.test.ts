import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseAnalyticsDateRange, type AnalyticsConfig } from "./config";
import { AnalyticsError, controlledAnalyticsError } from "./errors";
import { clickHouseQueries, postgresQueries } from "./queries";
import {
  createAnalyticsService,
  freshness,
  pendingAtomic,
  settlementStatus,
  type AnalyticsDataRepository,
} from "./repository";
import type { AnalyticsMetadataRepository } from "./metadata";
import type { RepositoryOverviewData } from "./types";

const config: AnalyticsConfig = {
  backend: "clickhouse",
  clickhouse: { url: "https://clickhouse.invalid", username: "default", password: "secret", database: "analytics" },
  queryTimeoutMs: 5_000,
  staleAfterMs: 60_000,
  defaultRangeDays: 30,
  maximumRangeDays: 366,
  topArticleLimit: 10,
  recentReadLimit: 100,
};

const range = { from: "2026-07-01", to: "2026-07-15", toExclusive: "2026-07-16" };

function overviewData(overrides: Partial<RepositoryOverviewData> = {}): RepositoryOverviewData {
  return {
    latestEventAt: null,
    totals: {
      wordsRead: 0,
      paidWords: 0,
      agentReads: 0,
      uniqueAgents: 0,
      grossAmountAtomic: "0",
      creatorAmountAtomic: "0",
      settledCreatorAmountAtomic: "0",
    },
    daily: [],
    topArticles: [],
    recentReads: [],
    ...overrides,
  };
}

function metadata(): AnalyticsMetadataRepository {
  return {
    articles: async (_creatorId, ids) => new Map(ids.map((id) => [id, { id, title: "Title", state: "live" as const, accessMode: "paid" as const }])),
    article: async (_creatorId, id) => ({ id, title: "Title", state: "live", accessMode: "paid" }),
    sections: async (_creatorId, _articleId, ids) => new Map(ids.map((id) => [id, { sectionId: id, heading: "Heading" }])),
  };
}

describe("analytics date ranges", () => {
  it("uses an inclusive 30-day UTC default", () => {
    expect(parseAnalyticsDateRange(new URLSearchParams(), config, new Date("2026-07-15T19:00:00Z"))).toEqual({
      from: "2026-06-16",
      to: "2026-07-15",
      toExclusive: "2026-07-16",
    });
  });

  it("allows the explicit all-time overview range without relaxing ordinary range limits", () => {
    expect(parseAnalyticsDateRange(new URLSearchParams("allTime=1"), config, new Date("2026-07-15T19:00:00Z"))).toEqual({
      from: "1970-01-01",
      to: "2026-07-15",
      toExclusive: "2026-07-16",
    });
  });

  it.each([
    "from=nope&to=2026-07-15",
    "from=2026-07-16&to=2026-07-15",
    "from=2025-01-01&to=2026-07-15",
    "from=2026-02-30&to=2026-03-01",
  ])("rejects invalid or excessive ranges: %s", (query) => {
    expect(() => parseAnalyticsDateRange(new URLSearchParams(query), config)).toThrowError(AnalyticsError);
  });
});

describe("analytics response assembly", () => {
  it("returns stable zero-activity shapes", async () => {
    const data: AnalyticsDataRepository = {
      overview: async () => overviewData(),
      article: vi.fn(),
    };
    const response = await createAnalyticsService(config, { data, metadata: metadata() }).overview("creator_a", range);
    expect(response.totals).toEqual({
      wordsRead: 0,
      paidWords: 0,
      agentReads: 0,
      uniqueAgents: 0,
      grossAmountAtomic: "0",
      creatorAmountAtomic: "0",
      settledCreatorAmountAtomic: "0",
      pendingCreatorAmountAtomic: "0",
    });
    expect(response.topArticles).toEqual([]);
    expect(response.recentReads).toEqual([]);
  });

  it("preserves exact atomic strings and never reports pending as completed", async () => {
    const huge = "99999999999999999999999999999999999999";
    const settled = "123456789012345678901234567890";
    const data: AnalyticsDataRepository = {
      overview: async (creatorId) => {
        expect(creatorId).toBe("creator_a");
        return overviewData({
          totals: {
            wordsRead: 20,
            paidWords: 20,
            agentReads: 1,
            uniqueAgents: 1,
            grossAmountAtomic: huge,
            creatorAmountAtomic: huge,
            settledCreatorAmountAtomic: settled,
          },
        });
      },
      article: vi.fn(),
    };
    const response = await createAnalyticsService(config, { data, metadata: metadata() }).overview("creator_a", range);
    expect(response.totals.creatorAmountAtomic).toBe(huge);
    expect(response.totals.settledCreatorAmountAtomic).toBe(settled);
    expect(response.totals.pendingCreatorAmountAtomic).toBe((BigInt(huge) - BigInt(settled)).toString());
  });

  it("keeps ClickHouse read evidence visible when its article no longer has local metadata", async () => {
    const data: AnalyticsDataRepository = {
      overview: async () => overviewData({
        topArticles: [{
          articleId: "migrated_article",
          wordsRead: 12,
          paidWords: 12,
          agentReads: 1,
          uniqueAgents: 1,
          creatorAmountAtomic: "1000",
          settledCreatorAmountAtomic: "1000",
          lastReadAt: "2026-07-15T10:00:00.000Z",
        }],
        recentReads: [{
          bundleId: "bundle_1",
          sessionId: "session_1",
          articleId: "migrated_article",
          occurredAt: "2026-07-15T10:00:00.000Z",
          accessMode: "paid",
          wordsRead: 12,
          creatorAmountAtomic: "1000",
          settledCreatorAmountAtomic: "1000",
          settlementStatus: "completed",
        }],
      }),
      article: vi.fn(),
    };
    const response = await createAnalyticsService(config, {
      data,
      metadata: { ...metadata(), articles: async () => new Map() },
    }).overview("creator_a", range);

    expect(response.topArticles).toMatchObject([{ articleId: "migrated_article", title: "Archived article", state: "archived" }]);
    expect(response.recentReads).toMatchObject([{ bundleId: "bundle_1", articleTitle: "Archived article", settlementStatus: "completed" }]);
  });

  it("checks article ownership before querying analytics", async () => {
    const data: AnalyticsDataRepository = { overview: vi.fn(), article: vi.fn() };
    const meta = metadata();
    meta.article = async () => { throw new AnalyticsError(404, "article_not_found", "Article not found."); };
    await expect(createAnalyticsService(config, { data, metadata: meta }).article("creator_a", "article_b", range))
      .rejects.toMatchObject({ status: 404, code: "article_not_found" });
    expect(data.article).not.toHaveBeenCalled();
  });

  it("propagates repository failures instead of returning zero metrics", async () => {
    const data: AnalyticsDataRepository = {
      overview: async () => { throw new Error("clickhouse_down"); },
      article: vi.fn(),
    };
    await expect(createAnalyticsService(config, { data, metadata: metadata() }).overview("creator_a", range))
      .rejects.toThrow("clickhouse_down");
    expect(controlledAnalyticsError(new Error("clickhouse_down"))).toMatchObject({
      status: 503,
      code: "analytics_unavailable",
    });
  });
});

describe("settlement and freshness semantics", () => {
  it("maps free, authorized, confirmed, completed, and failed honestly", () => {
    expect(settlementStatus("free", "completed")).toBe("not_applicable");
    expect(settlementStatus("paid", "authorized")).toBe("pending");
    expect(settlementStatus("paid", "pending")).toBe("pending");
    expect(settlementStatus("paid", "confirmed")).toBe("confirmed");
    expect(settlementStatus("paid", "completed")).toBe("completed");
    expect(settlementStatus("paid", "failed")).toBe("failed");
  });

  it("never produces negative pending money and marks delayed ingestion stale", () => {
    expect(pendingAtomic("10", "20")).toBe("0");
    expect(freshness("2026-07-15T10:00:00.000Z", "2026-07-15T10:02:00.000Z", 60_000)).toMatchObject({
      ingestionLagMs: 120_000,
      stale: true,
    });
  });
});

describe("query and client boundaries", () => {
  it("uses the backend v1 contract, bundle words, direct creator-scoped reads, and creator parameters", () => {
    const clickhouse = clickHouseQueries("analytics");
    expect(clickhouse.totals).toContain("arrayJoin(bundle_ids)");
    expect(clickhouse.totals).toContain("FROM `analytics`.`analytics_events` AS reads FINAL");
    expect(clickhouse.totals).toContain("sumIf(reads.creator_amount_atomic, settlement.settlement_status IN ('confirmed', 'completed'))");
    expect(clickhouse.daily).toContain("{creatorId:String}");
    expect(clickhouse.distinctTotals).toContain("event_version = 1");
    expect(clickhouse.distinctTotals).toContain("read_bundle_committed");
    expect(clickhouse.recentReads).toContain("arrayJoin(bundle_ids)");
    expect(clickhouse.recentReads).toContain("FROM `analytics`.`analytics_events` AS reads FINAL");
    expect(clickhouse.recentReads).toContain("reads.event_type = 'read_bundle_committed'");
    expect(clickhouse.recentReads).toContain("reads.occurred_at >= toDateTime64");
    expect(clickhouse.recentReads).not.toContain("FROM `analytics`.`recent_reads`");
    expect(clickhouse.topArticles).toContain("ORDER BY sumIf(reads.creator_amount_atomic, settlement.settlement_status IN ('confirmed', 'completed')) DESC");
    expect(postgresQueries.totals).toContain("FROM read_bundles");
    expect(postgresQueries.totals).toContain("COUNT(DISTINCT session_id)");
    expect(postgresQueries.totals).toContain("payment_status = 'completed'");
    expect(postgresQueries.totals).toContain("creator_id = $1");
  });

  it("keeps raw ledgers and ClickHouse secrets out of browser modules", () => {
    const browserSources = [
      "lib/rubicon/client.ts",
      "lib/analytics/client.ts",
      "lib/analytics/hooks.ts",
      "app/dashboard/page.tsx",
      "app/dashboard/articles/page.tsx",
      "app/dashboard/articles/[articleId]/page.tsx",
      "app/dashboard/earnings/page.tsx",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(browserSources).not.toMatch(/\.from\(["'](?:word_payments|word_deliveries|stream_sessions|settlement_receipts)["']\)/);
    expect(browserSources).not.toContain("CLICKHOUSE_");
    expect(browserSources).not.toContain("@clickhouse/client");
  });
});
