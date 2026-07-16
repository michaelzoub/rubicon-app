import type { AnalyticsRecentRead } from "@/lib/analytics/types";

export interface DashboardActivityHeatCell {
  /** Monday = 0, Sunday = 6. */
  day: number;
  hour: number;
  reads: number;
}

/** Buckets bounded analytical read sessions by local weekday/hour. */
export function buildAgentActivityHeatmap(
  activity: AnalyticsRecentRead[],
  windowDays = 28,
  now = new Date(),
): { cells: DashboardActivityHeatCell[]; totalReads: number; windowDays: number } {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const counts = new Map<string, number>();
  const seenSessions = new Set<string>();
  let totalReads = 0;

  for (const row of activity) {
    if (row.settlementStatus === "failed" || seenSessions.has(row.sessionId)) continue;
    const date = new Date(row.occurredAt);
    if (Number.isNaN(date.getTime()) || date < cutoff || date > now) continue;
    const day = (date.getDay() + 6) % 7;
    const hour = date.getHours();
    const key = `${day}:${hour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    seenSessions.add(row.sessionId);
    totalReads += 1;
  }

  const cells: DashboardActivityHeatCell[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (let day = 0; day < 7; day += 1) {
      cells.push({ day, hour, reads: counts.get(`${day}:${hour}`) ?? 0 });
    }
  }
  return { cells, totalReads, windowDays };
}
