"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import type { RubiconError } from "@/lib/rubicon/client";
import { fetchAnalyticsOverview, fetchArticleAnalytics, type AnalyticsClientDateRange } from "./client";

const STALE_TIME_MS = 30_000;
const REFRESH_INTERVAL_MS = 60_000;

export function useAnalyticsOverview(range: AnalyticsClientDateRange = {}, options: { enabled?: boolean } = {}) {
  const { getAccessToken } = usePrivy();
  return useQuery({
    queryKey: ["analytics", "overview", range.from ?? null, range.to ?? null, range.allTime ?? false],
    queryFn: () => fetchAnalyticsOverview(getAccessToken, range),
    enabled: options.enabled ?? true,
    staleTime: STALE_TIME_MS,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: controlledRetry,
  });
}

export function useArticleAnalytics(articleId: string, range: AnalyticsClientDateRange = {}) {
  const { getAccessToken } = usePrivy();
  return useQuery({
    queryKey: ["analytics", "article", articleId, range.from ?? null, range.to ?? null],
    queryFn: () => fetchArticleAnalytics(articleId, getAccessToken, range),
    enabled: Boolean(articleId),
    staleTime: STALE_TIME_MS,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: controlledRetry,
  });
}

function controlledRetry(failureCount: number, error: RubiconError): boolean {
  if (error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}
