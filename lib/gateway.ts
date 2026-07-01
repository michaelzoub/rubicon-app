/**
 * Circle Gateway constants, ABI, and pure validation helpers for the seller
 * withdrawal flow.
 *
 * Seller earnings arrive as Circle Gateway credits held against the Gateway
 * Wallet contract — not as on-chain ERC-20 transfers. Moving them out is a
 * two-step, on-chain, 7-DAY-DELAYED flow on the Gateway Wallet contract:
 *
 *   1. initiateWithdrawal(token, value)  -> starts a ~7-day timer
 *   2. (wait until withdrawalBlock)      -> funds mature
 *   3. withdraw(token)                   -> returns the matured USDC to the
 *                                           depositor's own wallet on this chain
 *
 * withdraw() has NO recipient argument — funds always return to the depositor
 * (the signer). To land them at a different address we do a follow-up ERC-20
 * transfer after completion. Function names/params verified against Circle's
 * @circle-fin/unified-balance-kit contract mappings (initiateWithdrawal,
 * withdraw, withdrawalBlock, withdrawingBalance).
 *
 * Values below are Arc Testnet (the chain the dashboard targets — see
 * lib/chain.ts). USDC here is the 6-decimal ERC-20, NOT the 18-decimal native
 * gas token.
 */
import { ACTIVE_CHAIN } from "./chain";

/** Gateway Wallet contract (deposit/balance/withdraw) — Arc Testnet. */
export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

/** USDC ERC-20 on Arc (6 decimals). */
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

export const USDC_DECIMALS = 6;

/** 10 ** USDC_DECIMALS, as a bigint (atomic units per whole USDC). */
const USDC_BASE = BigInt(10) ** BigInt(USDC_DECIMALS);

/** Circle Gateway domain id for Arc Testnet (used by the /v1/balances API). */
export const ARC_GATEWAY_DOMAIN = 26;

/** A withdrawal matures roughly 7 days after it is initiated. */
export const WITHDRAWAL_DELAY_DAYS = 7;

/** Minimal verified ABI for the Gateway Wallet withdrawal surface. */
export const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "initiateWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawalBlock",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawingBalance",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Minimal ERC-20 ABI for the optional "send to a different address" step. */
export const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function explorerTxUrl(hash: string): string {
  const base = ACTIVE_CHAIN.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : "#";
}

// --- Pure, dependency-free helpers (unit-tested) -------------------------

/** Well-formed EVM address: 0x followed by 40 hex chars. */
export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

/** Render a 6-decimal atomic USDC amount as a trimmed decimal string. */
export function formatUsdc(atomic: bigint): string {
  const negative = atomic < BigInt(0);
  const abs = negative ? -atomic : atomic;
  const whole = abs / USDC_BASE;
  const frac = (abs % USDC_BASE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * Parse a user-entered USDC amount into atomic (6-decimal) units. Returns the
 * bigint on success, or a human-readable error string.
 */
export function parseUsdcAmount(input: string): bigint | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") {
    return { error: "Enter a valid number." };
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > USDC_DECIMALS) {
    return { error: `USDC supports at most ${USDC_DECIMALS} decimal places.` };
  }
  const atomic = BigInt(whole || "0") * USDC_BASE + BigInt((frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS));
  if (atomic <= BigInt(0)) return { error: "Amount must be greater than zero." };
  return atomic;
}

/**
 * Validate a withdrawal amount against the available balance. Returns an error
 * string, or null when the amount is valid.
 */
export function validateWithdrawAmount(input: string, availableAtomic: bigint): string | null {
  const parsed = parseUsdcAmount(input);
  if (typeof parsed === "object") return parsed.error;
  if (parsed > availableAtomic) {
    return `Amount exceeds your available balance of ${formatUsdc(availableAtomic)} USDC.`;
  }
  return null;
}

/** Validate a destination address. Returns an error string, or null. */
export function validateDestination(address: string): string | null {
  if (!address.trim()) return "Enter a destination address.";
  if (!isValidAddress(address)) return "Enter a valid 0x address.";
  return null;
}
