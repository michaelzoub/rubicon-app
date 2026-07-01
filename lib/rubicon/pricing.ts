/**
 * Pricing and word-counting helpers.
 *
 * All money on the wire is expressed in atomic USDC units (6 decimals) as
 * strings, to avoid floating-point drift. Creators only ever see and enter
 * friendly dollar amounts; these helpers convert at the UI boundary.
 *
 * Word counting here is only used for pre-publish *estimates*. The gateway is
 * the source of truth for billed word counts, and the UI displays the
 * gateway's numbers everywhere usage and earnings are shown.
 */
import { USDC_DECIMALS } from "./types";

const ATOMIC_PER_USDC = 10 ** USDC_DECIMALS; // 1_000_000

/** Convert a dollar amount to atomic USDC units (string). */
export function usdToAtomic(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "0";
  return Math.round(usd * ATOMIC_PER_USDC).toString();
}

/** Convert atomic USDC units (string) to a dollar number. */
export function atomicToUsd(atomic: string | null | undefined): number {
  if (!atomic) return 0;
  const n = Number(atomic);
  if (!Number.isFinite(n)) return 0;
  return n / ATOMIC_PER_USDC;
}

/**
 * Format a dollar number at full USDC precision (up to 6 decimals), always
 * keeping at least 2 decimals and trimming any trailing zeros beyond that.
 */
export function formatUsdNumber(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  // Render at full USDC precision, then trim trailing zeros down to 2 decimals.
  const fixed = usd.toFixed(USDC_DECIMALS).replace(/(\.\d{2}\d*?)0+$/, "$1");
  return `$${fixed}`;
}

/**
 * Format an atomic amount as a dollar string. Shows up to 6 decimals (USDC's
 * full precision) so sub-cent micro-amounts are visible, while always keeping
 * at least 2 decimals and trimming any trailing zeros beyond that.
 */
export function formatUsd(atomic: string | null | undefined): string {
  return formatUsdNumber(atomicToUsd(atomic));
}

/**
 * Display-oriented formatter for surfaces where micro-earnings are common
 * (the creator dashboard). Sub-dollar amounts read as cents — "$0.1388" is
 * legible as "13.88¢" — while a dollar or more uses the standard currency
 * format. Keeps early, low-earning accounts from looking broken.
 */
export function formatUsdDisplay(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0.00";
  if (usd < 0) return `-${formatUsdDisplay(-usd)}`;
  if (usd < 1) {
    const cents = usd * 100;
    const fixed = cents >= 0.1 ? cents.toFixed(2) : cents.toFixed(4);
    return `${fixed.replace(/\.?0+$/, "")}¢`;
  }
  return formatUsdNumber(usd);
}

/** Atomic-units convenience wrapper around {@link formatUsdDisplay}. */
export function formatUsdAtomicDisplay(atomic: string | null | undefined): string {
  return formatUsdDisplay(atomicToUsd(atomic));
}

/** Convert a creator's "price per 1,000 words" (USD) to atomic-per-word. */
export function per1000UsdToAtomicPerWord(usdPer1000: number): string {
  if (!Number.isFinite(usdPer1000) || usdPer1000 < 0) return "0";
  const perWordUsd = usdPer1000 / 1000;
  return usdToAtomic(perWordUsd);
}

/** Convert atomic-per-word back to a "price per 1,000 words" dollar number. */
export function atomicPerWordToPer1000Usd(atomicPerWord: string): number {
  return atomicToUsd(atomicPerWord) * 1000;
}

/** Multiply an atomic per-word price by a word count → atomic total (string). */
export function atomicForWords(atomicPerWord: string, words: number): string {
  const n = Number(atomicPerWord);
  if (!Number.isFinite(n) || words <= 0) return "0";
  return Math.round(n * words).toString();
}

/**
 * Estimate a word count from raw text. Mirrors a simple whitespace tokenizer.
 * Used ONLY for pre-publish estimates; the gateway's count governs billing.
 */
export function estimateWordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
