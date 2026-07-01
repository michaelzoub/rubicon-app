"use client";

/**
 * Browser-side Circle Gateway withdrawal signing, via the seller's Privy
 * embedded wallet. We build a viem WalletClient from the wallet's EIP-1193
 * provider (mirroring Circle's own browser-wallet deposit reference) and call
 * the Gateway Wallet contract directly — there is no SDK install.
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http } from "viem";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { ACTIVE_CHAIN } from "./chain";
import {
  ERC20_TRANSFER_ABI,
  GATEWAY_WALLET_ABI,
  GATEWAY_WALLET_ADDRESS,
  USDC_ADDRESS,
} from "./gateway";

const publicClient = createPublicClient({ chain: ACTIVE_CHAIN, transport: http() });

export type GatewayBalanceState = {
  status: "idle" | "loading" | "success" | "error";
  /** Spendable balance in atomic USDC; null if the Gateway API was unreachable. */
  availableAtomic: bigint | null;
  /** Amount currently in a delayed withdrawal (0 if none pending). */
  withdrawingAtomic: bigint;
  /** Block at which a pending withdrawal can be completed (0 if none). */
  withdrawalBlock: bigint;
  /** Latest chain head, for comparing against withdrawalBlock. */
  currentBlock: bigint;
  error: string | null;
};

const EMPTY: Omit<GatewayBalanceState, "status" | "error"> = {
  availableAtomic: null,
  withdrawingAtomic: BigInt(0),
  withdrawalBlock: BigInt(0),
  currentBlock: BigInt(0),
};

export function useGatewayBalance(address: string | null | undefined): GatewayBalanceState & { refetch: () => void } {
  const [state, setState] = useState<GatewayBalanceState>({ status: "idle", error: null, ...EMPTY });

  const load = useCallback(() => {
    if (!address) {
      setState({ status: "idle", error: null, ...EMPTY });
      return () => {};
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading", error: null }));
    fetch(`/api/onchain/gateway-balance?address=${encodeURIComponent(address)}`)
      .then(async (res) => {
        const body = (await res.json()) as {
          availableAtomic?: string | null;
          withdrawingAtomic?: string;
          withdrawalBlock?: string;
          currentBlock?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || body.currentBlock === undefined) {
          setState({ status: "error", error: body.error ?? "Failed to load balance", ...EMPTY });
          return;
        }
        setState({
          status: "success",
          error: null,
          availableAtomic: body.availableAtomic == null ? null : BigInt(body.availableAtomic),
          withdrawingAtomic: BigInt(body.withdrawingAtomic ?? "0"),
          withdrawalBlock: BigInt(body.withdrawalBlock ?? "0"),
          currentBlock: BigInt(body.currentBlock ?? "0"),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ status: "error", error: e instanceof Error ? e.message : "Failed to load balance", ...EMPTY });
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => load(), [load]);

  return { ...state, refetch: () => void load() };
}

export class WithdrawError extends Error {
  constructor(
    readonly kind: "rejected" | "network" | "gas" | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "WithdrawError";
  }
}

/** Normalize wallet/provider errors into something the dialog can show. */
export function toWithdrawError(err: unknown): WithdrawError {
  const code = (err as { code?: number })?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === 4001 || /user rejected|denied|rejected the request/i.test(message)) {
    return new WithdrawError("rejected", "You rejected the signature.");
  }
  if (/network|fetch|timeout|connection/i.test(message)) {
    return new WithdrawError("network", "Network error. Check your connection and try again.");
  }
  if (/insufficient funds|gas \* price \+ value/i.test(message)) {
    const have = message.match(/\bhave\s+(\d+)/i)?.[1];
    const want = message.match(/\bwant\s+(\d+)/i)?.[1];
    const detail =
      have && want
        ? ` Your wallet has ${formatNativeGas(BigInt(have))} ${ACTIVE_CHAIN.nativeCurrency.symbol}; this transaction needs about ${formatNativeGas(BigInt(want))} ${ACTIVE_CHAIN.nativeCurrency.symbol} for gas.`
        : "";
    return new WithdrawError(
      "gas",
      `Your wallet needs ${ACTIVE_CHAIN.nativeCurrency.symbol} on ${ACTIVE_CHAIN.name} to pay gas.${detail}`,
    );
  }
  return new WithdrawError("unknown", message || "Something went wrong.");
}

function formatNativeGas(value: bigint): string {
  const formatted = formatUnits(value, ACTIVE_CHAIN.nativeCurrency.decimals);
  const numeric = Number(formatted);
  if (!Number.isFinite(numeric)) return formatted;
  return numeric.toLocaleString(undefined, { maximumSignificantDigits: 6 });
}

async function assertHasGas(account: `0x${string}`) {
  const balance = await publicClient.getBalance({ address: account });
  if (balance <= BigInt(0)) {
    throw new WithdrawError(
      "gas",
      `Your wallet has 0 ${ACTIVE_CHAIN.nativeCurrency.symbol} for gas. Add ${ACTIVE_CHAIN.nativeCurrency.symbol} on ${ACTIVE_CHAIN.name}, then try again.`,
    );
  }
}

async function walletClientFor(wallet: ConnectedWallet) {
  try {
    await wallet.switchChain(ACTIVE_CHAIN.id);
  } catch {
    // Already on the chain, or the wallet manages chains itself — the write
    // below will surface a real mismatch.
  }
  const provider = await wallet.getEthereumProvider();
  return createWalletClient({
    account: wallet.address as `0x${string}`,
    chain: ACTIVE_CHAIN,
    transport: custom(provider),
  });
}

/**
 * Step 1: start a delayed withdrawal. Returns the initiating tx hash. The funds
 * mature after the on-chain delay (~7 days); completion is a separate action.
 */
export async function initiateWithdrawal(wallet: ConnectedWallet, amountAtomic: bigint): Promise<`0x${string}`> {
  try {
    const client = await walletClientFor(wallet);
    await assertHasGas(wallet.address as `0x${string}`);
    const hash = await client.writeContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_WALLET_ABI,
      functionName: "initiateWithdrawal",
      args: [USDC_ADDRESS, amountAtomic],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  } catch (err) {
    throw toWithdrawError(err);
  }
}

export type CompleteResult = { withdrawHash: `0x${string}`; transferHash?: `0x${string}` };

/**
 * Step 2 (after maturity): withdraw the matured USDC to the depositor wallet.
 * `withdraw(token)` takes no recipient, so when the seller chose a different
 * destination we follow it with an ERC-20 transfer of the withdrawn amount.
 */
export async function completeWithdrawal(
  wallet: ConnectedWallet,
  options: { destination: string; amountAtomic: bigint },
): Promise<CompleteResult> {
  try {
    const client = await walletClientFor(wallet);
    await assertHasGas(wallet.address as `0x${string}`);
    const withdrawHash = await client.writeContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_WALLET_ABI,
      functionName: "withdraw",
      args: [USDC_ADDRESS],
    });
    await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

    const sameWallet = options.destination.toLowerCase() === wallet.address.toLowerCase();
    if (sameWallet || options.amountAtomic <= BigInt(0)) {
      return { withdrawHash };
    }

    const transferHash = await client.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [options.destination as `0x${string}`, options.amountAtomic],
    });
    await publicClient.waitForTransactionReceipt({ hash: transferHash });
    return { withdrawHash, transferHash };
  } catch (err) {
    throw toWithdrawError(err);
  }
}
