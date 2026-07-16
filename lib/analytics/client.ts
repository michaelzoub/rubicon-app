"use client";

import { RubiconError } from "@/lib/rubicon/client";
import type { AnalyticsOverviewResponse, ArticleAnalyticsResponse } from "./types";

export interface AnalyticsClientDateRange {
  from?: string;
  to?: string;
}

export async function fetchAnalyticsOverview(
  getAccessToken: () => Promise<string | null>,
  range: AnalyticsClientDateRange = {},
): Promise<AnalyticsOverviewResponse> {
  return authenticatedAnalyticsFetch("/api/analytics/overview", getAccessToken, range);
}

export async function fetchArticleAnalytics(
  articleId: string,
  getAccessToken: () => Promise<string | null>,
  range: AnalyticsClientDateRange = {},
): Promise<ArticleAnalyticsResponse> {
  return authenticatedAnalyticsFetch(`/api/analytics/articles/${encodeURIComponent(articleId)}`, getAccessToken, range);
}

async function authenticatedAnalyticsFetch<T>(
  path: string,
  getAccessToken: () => Promise<string | null>,
  range: AnalyticsClientDateRange,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new RubiconError("auth", 401, "missing_token", "Sign in to view analytics.");
  const search = new URLSearchParams();
  if (range.from) search.set("from", range.from);
  if (range.to) search.set("to", range.to);

  let response: Response;
  try {
    response = await fetch(`${path}${search.size ? `?${search}` : ""}`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      credentials: "same-origin",
    });
  } catch {
    throw new RubiconError("network", 0, "network_error", "Could not reach analytics. Check your connection and try again.");
  }

  const body = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403
      ? "auth"
      : response.status === 400 || response.status === 404
        ? "validation"
        : "backend";
    throw new RubiconError(
      kind,
      response.status,
      body.error?.code ?? "analytics_request_failed",
      body.error?.message ?? "Analytics are temporarily unavailable.",
    );
  }
  return body;
}
