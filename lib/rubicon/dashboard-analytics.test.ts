import { describe, expect, it } from "vitest";
import { buildAgentActivityHeatmap } from "./dashboard-analytics";
import type { AnalyticsRecentRead, AnalyticsSettlementStatus } from "@/lib/analytics/types";

function activity(id: string, date: Date, status: AnalyticsSettlementStatus): AnalyticsRecentRead {
  return {
    bundleId: id,
    sessionId: id,
    occurredAt: date.toISOString(),
    articleId: "article_1",
    articleTitle: "Article",
    accessMode: "paid",
    wordsRead: 10,
    creatorAmountAtomic: "1000",
    settledCreatorAmountAtomic: status === "completed" ? "1000" : "0",
    settlementStatus: status,
  };
}

describe("buildAgentActivityHeatmap", () => {
  it("counts non-failed sessions by local weekday and hour", () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);
    const mondayMorning = new Date(2026, 6, 13, 10, 0, 0);
    const rows = [
      activity("one", mondayMorning, "completed"),
      activity("two", new Date(2026, 6, 13, 10, 30, 0), "completed"),
      activity("pending", mondayMorning, "pending"),
      activity("old", new Date(2026, 5, 1, 10, 0, 0), "completed"),
    ];

    const result = buildAgentActivityHeatmap(rows, 28, now);

    expect(result.cells).toHaveLength(168);
    expect(result.totalReads).toBe(3);
    expect(result.cells.find((cell) => cell.day === 0 && cell.hour === 10)?.reads).toBe(3);
  });

  it("uses the daily aggregate for the displayed total when provided", () => {
    const result = buildAgentActivityHeatmap([], 28, new Date(2026, 6, 15, 12, 0, 0), 14);

    expect(result.totalReads).toBe(14);
  });
});
