import "server-only";

import type { AnalyticsBackend, AnalyticsDateRange } from "./types";
import { AnalyticsError } from "./errors";

export interface AnalyticsConfig {
  backend: AnalyticsBackend;
  clickhouse?: {
    url: string;
    username: string;
    password: string;
    database: string;
  };
  postgresUrl?: string;
  queryTimeoutMs: number;
  staleAfterMs: number;
  defaultRangeDays: number;
  maximumRangeDays: number;
  topArticleLimit: number;
  recentReadLimit: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadAnalyticsConfig(env: NodeJS.ProcessEnv = process.env): AnalyticsConfig {
  const backend = env.ANALYTICS_BACKEND;
  if (backend !== "clickhouse" && backend !== "postgres") {
    throw new AnalyticsError(500, "analytics_not_configured", "ANALYTICS_BACKEND must be clickhouse or postgres.");
  }

  const base: Omit<AnalyticsConfig, "backend"> = {
    queryTimeoutMs: integerEnv(env.CLICKHOUSE_QUERY_TIMEOUT_MS, 5_000, 250, 30_000, "CLICKHOUSE_QUERY_TIMEOUT_MS"),
    staleAfterMs: integerEnv(env.ANALYTICS_STALE_AFTER_MS, 300_000, 1_000, 86_400_000, "ANALYTICS_STALE_AFTER_MS"),
    defaultRangeDays: 30,
    maximumRangeDays: 366,
    topArticleLimit: 10,
    recentReadLimit: 100,
  };

  if (backend === "postgres") {
    const postgresUrl = env.DATABASE_URL;
    if (!postgresUrl) throw new AnalyticsError(500, "analytics_not_configured", "DATABASE_URL is required for Postgres analytics.");
    validateUrl(postgresUrl, "DATABASE_URL", ["postgres:", "postgresql:"]);
    return { ...base, backend, postgresUrl };
  }

  const url = required(env.CLICKHOUSE_URL, "CLICKHOUSE_URL");
  validateUrl(url, "CLICKHOUSE_URL", ["http:", "https:"]);
  const database = required(env.CLICKHOUSE_DATABASE, "CLICKHOUSE_DATABASE");
  if (!IDENTIFIER.test(database)) {
    throw new AnalyticsError(500, "analytics_not_configured", "CLICKHOUSE_DATABASE must be a simple identifier.");
  }
  return {
    ...base,
    backend,
    clickhouse: {
      url,
      username: env.CLICKHOUSE_USERNAME?.trim() || "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
      database,
    },
  };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new AnalyticsError(500, "analytics_not_configured", `${name} is required.`);
  return trimmed;
}

function validateUrl(value: string, name: string, protocols: string[]): void {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new AnalyticsError(500, "analytics_not_configured", `${name} is not a valid ${protocols.join(" or ")} URL.`);
  }
}

function integerEnv(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AnalyticsError(500, "analytics_not_configured", `${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function parseAnalyticsDateRange(
  searchParams: URLSearchParams,
  config: Pick<AnalyticsConfig, "defaultRangeDays" | "maximumRangeDays">,
  now = new Date(),
): AnalyticsDateRange {
  const defaultTo = utcDate(now);
  const defaultFromDate = new Date(`${defaultTo}T00:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - config.defaultRangeDays + 1);

  const from = searchParams.get("from") ?? utcDate(defaultFromDate);
  const to = searchParams.get("to") ?? defaultTo;
  if (!isUtcDate(from) || !isUtcDate(to)) {
    throw new AnalyticsError(400, "invalid_date_range", "from and to must use YYYY-MM-DD UTC dates.");
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const inclusiveDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (inclusiveDays < 1 || inclusiveDays > config.maximumRangeDays) {
    throw new AnalyticsError(400, "invalid_date_range", `Date range must be between 1 and ${config.maximumRangeDays} days.`);
  }

  const toExclusiveDate = new Date(toDate);
  toExclusiveDate.setUTCDate(toExclusiveDate.getUTCDate() + 1);
  return { from, to, toExclusive: utcDate(toExclusiveDate) };
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && utcDate(parsed) === value;
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
