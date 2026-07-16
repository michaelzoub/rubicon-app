import "server-only";

import type { AnalyticsConfig } from "./config";
import { AnalyticsError } from "./errors";

export interface AnalyticsQueryClient {
  query<T>(query: string, queryParams: Record<string, unknown>): Promise<T[]>;
  close(): Promise<void>;
}

export function createAnalyticsClickHouseClient(config: AnalyticsConfig): AnalyticsQueryClient {
  if (!config.clickhouse) throw new AnalyticsError(500, "analytics_not_configured", "ClickHouse analytics are not configured.");
  const clickhouse = config.clickhouse;
  return {
    async query<T>(query: string, queryParams: Record<string, unknown>) {
      const url = new URL(clickhouse.url);
      url.searchParams.set("database", clickhouse.database);
      url.searchParams.set("query", `${query.trim()} FORMAT JSONEachRow`);
      url.searchParams.set("readonly", "1");
      url.searchParams.set("max_execution_time", String(Math.max(1, Math.ceil(config.queryTimeoutMs / 1_000))));
      url.searchParams.set("output_format_json_quote_64bit_integers", "1");
      url.searchParams.set("output_format_decimal_trailing_zeros", "0");
      url.searchParams.set("wait_end_of_query", "1");
      for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(`param_${key}`, formatQueryParam(value));
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "x-clickhouse-user": clickhouse.username,
            "x-clickhouse-key": clickhouse.password,
          },
          signal: AbortSignal.timeout(config.queryTimeoutMs),
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`clickhouse_request_failed:${response.status}:${body.slice(0, 300)}`);
        return body.trim() === "" ? [] : body.trim().split("\n").map((line) => JSON.parse(line) as T);
      } catch (error) {
        throw new AnalyticsError(503, "analytics_unavailable", "Analytics are temporarily unavailable.", { cause: error });
      }
    },
    async close() {},
  };
}

function formatQueryParam(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return `[${value.map((item) => `'${item.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`).join(",")}]`;
  }
  throw new AnalyticsError(500, "analytics_invalid_parameter", "Analytics received an invalid query parameter.");
}
