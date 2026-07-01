"use client";

/**
 * Wires the Supabase dashboard client to Privy authentication.
 *
 * The Privy access token is forwarded to Supabase as the bearer token. The
 * database must enforce RLS so creators can only read/write their own rows.
 */
import { usePrivy } from "@privy-io/react-auth";
import { useMemo } from "react";
import { createRubiconClient, RubiconError, toUserFacingRubiconError, type RubiconClient } from "./client";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function legacyJwtRole(key: string): string | null {
  const [, payload] = key.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const parsed = JSON.parse(decoded) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

export function getSupabasePublicKeyIssue(): string | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return "Supabase is not connected yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load live data.";
  }

  if (SUPABASE_ANON_KEY.startsWith("sb_secret_")) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY is using a Supabase secret key. Use a publishable key (sb_publishable_...) or the legacy anon JWT in browser-exposed env vars.";
  }

  if (SUPABASE_ANON_KEY.startsWith("eyJ") && legacyJwtRole(SUPABASE_ANON_KEY) !== "anon") {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY is using the wrong legacy JWT role. Use the legacy anon key, not service_role.";
  }

  return null;
}

export function isRubiconConfigured(): boolean {
  return getSupabasePublicKeyIssue() === null;
}

let supabaseTokenCache: { privyToken: string; supabaseToken: string; expiresAt: number } | null = null;

async function getSupabaseToken(privyToken: string | null): Promise<string | null> {
  if (!privyToken) return null;

  const now = Math.floor(Date.now() / 1000);
  if (supabaseTokenCache?.privyToken === privyToken && supabaseTokenCache.expiresAt > now + 30) {
    return supabaseTokenCache.supabaseToken;
  }

  const response = await fetch("/api/auth/supabase-token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privyToken}`,
    },
  }).catch((err: unknown) => {
    throw toUserFacingRubiconError(err, "Could not verify your session.");
  });

  if (!response.ok) {
    supabaseTokenCache = null;
    throw new RubiconError("auth", response.status, "supabase_token_failed", "Your session could not be verified. Sign in again.");
  }

  const body = (await response.json()) as { token?: string; expiresAt?: number };
  if (!body.token || !body.expiresAt) {
    supabaseTokenCache = null;
    return null;
  }

  supabaseTokenCache = {
    privyToken,
    supabaseToken: body.token,
    expiresAt: body.expiresAt,
  };

  return body.token;
}

/**
 * Returns a Supabase-backed dashboard client bound to the current Privy session,
 * or null when Supabase is not configured.
 */
export function useRubiconClient(): RubiconClient | null {
  const { getAccessToken, user } = usePrivy();

  return useMemo(() => {
    if (!isRubiconConfigured()) return null;
    const username =
      user?.twitter?.username ??
      user?.email?.address?.split("@")[0]?.replace(/[^a-zA-Z0-9_]/g, "_") ??
      user?.wallet?.address?.slice(2, 10) ??
      user?.id.slice(0, 8) ??
      "creator";
    const displayName = user?.twitter?.name ?? user?.twitter?.username ?? user?.email?.address ?? "Creator";

    return createRubiconClient({
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      getToken: async () => getSupabaseToken(await getAccessToken()),
      getIdentity: () =>
        user
          ? {
              id: user.id,
              username,
              displayName,
            }
          : null,
    });
  }, [getAccessToken, user]);
}
