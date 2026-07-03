/**
 * Access-mode helpers shared by the dashboard client.
 *
 * These encode the two rules that separate free and paid articles:
 *  - A missing/unknown access_mode reads as "paid" (never "free"), so legacy
 *    rows and zero-priced drafts keep their price/wallet publish guards.
 *  - Free-article readership is measured from the delivery ledger, paid-article
 *    readership from the payment ledger — revenue always stays on payments.
 */
import type { ArticleAccessMode } from "./types";

/** Resolve a row's access mode, defaulting a null/unknown value to "paid". */
export function accessModeOf(row: { access_mode: ArticleAccessMode | null }): ArticleAccessMode {
  return row.access_mode === "free" ? "free" : "paid";
}

/** Whether a paid article is publishable: it needs a positive price and a verified wallet. */
export function canPublishPaid(pricePerWordAtomic: string, walletVerified: boolean): boolean {
  return Number(pricePerWordAtomic) > 0 && walletVerified;
}

/**
 * The per-word "read" events for an article: deliveries when free (there are no
 * payments), payments when paid. Callers derive words-read, reading-agent, and
 * per-section counts from the result; revenue is computed from payments only.
 */
export function selectReadEvents<E extends { article_id: string }>(
  row: { id: string; access_mode: ArticleAccessMode | null },
  payments: E[],
  deliveries: E[],
): E[] {
  const source = accessModeOf(row) === "free" ? deliveries : payments;
  return source.filter((event) => event.article_id === row.id);
}
