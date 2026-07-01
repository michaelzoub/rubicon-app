"use client";

/**
 * TanStack Query adapters for the creator dashboard. They retain the small
 * result shape used by the UI while adding shared caching, request deduping,
 * retries, background refetching, mutations, and invalidation.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { RubiconError, toUserFacingRubiconError, type RubiconClient } from "./client";
import { getSupabasePublicKeyIssue, useRubiconClient } from "./auth";

export type QueryStatus = "loading" | "success" | "error";

export interface QueryResult<T> {
  status: QueryStatus;
  data: T | null;
  error: RubiconError | null;
  refetch: () => void;
}

function notConfiguredError() {
  return new RubiconError(
    "backend",
    0,
    "not_configured",
    getSupabasePublicKeyIssue() ?? "Supabase is not connected yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load live data.",
  );
}

/**
 * Runs `fetcher` against the Rubicon client and tracks its state. Re-runs when
 * `deps` change. Pass `enabled: false` to defer until prerequisites are ready
 * (e.g. the user is authenticated).
 */
export function useRubiconQuery<T>(
  fetcher: (client: RubiconClient) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: { enabled?: boolean; queryKey: QueryKey },
): QueryResult<T> {
  const enabled = options.enabled ?? true;
  const client = useRubiconClient();
  const query = useQuery<T, RubiconError>({
    queryKey: ["rubicon", ...options.queryKey, ...deps],
    enabled,
    queryFn: async () => {
      if (!client) throw notConfiguredError();
      try {
        return await fetcher(client);
      } catch (error) {
        throw toUserFacingRubiconError(error);
      }
    },
  });

  const status: QueryStatus = query.isError ? "error" : query.isSuccess ? "success" : "loading";
  return {
    status,
    data: query.data ?? null,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

export interface MutationState {
  pending: boolean;
  error: RubiconError | null;
}

/** Minimal mutation helper with pending/error tracking. */
export function useRubiconMutation<TArgs extends unknown[], TResult>(
  mutator: (client: RubiconClient, ...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult>;
  pending: boolean;
  error: RubiconError | null;
} {
  const client = useRubiconClient();
  const queryClient = useQueryClient();
  const mutation = useMutation<TResult, RubiconError, TArgs>({
    mutationFn: async (args) => {
      if (!client) throw notConfiguredError();
      try {
        return await mutator(client, ...args);
      } catch (err) {
        throw toUserFacingRubiconError(err);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rubicon"] }),
  });

  return {
    run: (...args) => mutation.mutateAsync(args),
    pending: mutation.isPending,
    error: mutation.error,
  };
}
