import "server-only";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsConfig } from "./config";
import { AnalyticsError } from "./errors";

export interface AnalyticsQueryClient {
  query<T>(query: string, queryParams: Record<string, unknown>): Promise<T[]>;
  close(): Promise<void>;
}

export function createAnalyticsClickHouseClient(config: AnalyticsConfig): AnalyticsQueryClient {
  if (!config.clickhouse) throw new AnalyticsError(500, "analytics_not_configured", "ClickHouse analytics are not configured.");
  const client = createClient({
    url: config.clickhouse.url,
    username: config.clickhouse.username,
    password: config.clickhouse.password,
    database: config.clickhouse.database,
    request_timeout: config.queryTimeoutMs,
    max_open_connections: 5,
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: Math.max(1, Math.ceil(config.queryTimeoutMs / 1_000)),
      output_format_json_quote_64bit_integers: 1,
      output_format_decimal_trailing_zeros: 0,
    },
    application: "rubicon-dashboard-analytics",
  });
  return wrapClient(client);
}

function wrapClient(client: ClickHouseClient): AnalyticsQueryClient {
  return {
    async query<T>(query: string, queryParams: Record<string, unknown>) {
      try {
        const result = await client.query({ query, query_params: queryParams, format: "JSONEachRow" });
        return await result.json<T>();
      } catch (error) {
        throw new AnalyticsError(503, "analytics_unavailable", "Analytics are temporarily unavailable.", { cause: error });
      }
    },
    close: () => client.close(),
  };
}
