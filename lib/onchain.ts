"use client";

/**
 * Read-only on-chain reads for the dashboard.
 *
 * Balance is the wallet's native balance on the active chain. On Arc the native
 * gas token is USDC, so this is the creator's USDC balance. The read goes
 * through /api/onchain/balance so the (token-bearing) Arc RPC stays server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_CHAIN } from "./chain";

export type BalanceState = {
  status: "idle" | "loading" | "success" | "error";
  /** Formatted balance in whole token units, e.g. "12.5". */
  value: string | null;
  symbol: string;
  error: string | null;
};

export function useNativeBalance(address: string | null | undefined): BalanceState & { refetch: () => void } {
  const symbol = ACTIVE_CHAIN.nativeCurrency.symbol;
  const [state, setState] = useState<BalanceState>({ status: "idle", value: null, symbol, error: null });

  const load = useCallback(() => {
    if (!address) {
      setState({ status: "idle", value: null, symbol, error: null });
      return () => {};
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", error: null }));
    fetch(`/api/onchain/balance?address=${encodeURIComponent(address)}`)
      .then(async (res) => {
        const body = (await res.json()) as { value?: string; symbol?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || body.value === undefined) {
          setState({ status: "error", value: null, symbol, error: body.error ?? "Failed to load balance" });
          return;
        }
        setState({ status: "success", value: body.value, symbol: body.symbol ?? symbol, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", value: null, symbol, error: e instanceof Error ? e.message : "Failed to load balance" });
      });
    return () => {
      cancelled = true;
    };
  }, [address, symbol]);

  useEffect(() => load(), [load]);

  return { ...state, refetch: () => void load() };
}

export function formatBalance(value: string | null): string {
  if (value === null) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function explorerAddressUrl(address: string): string {
  const base = ACTIVE_CHAIN.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : "#";
}
