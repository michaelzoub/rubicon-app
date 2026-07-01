import type { ArticleSourcePlatform } from "@/lib/rubicon/types";

/**
 * Content-ownership safety for imported posts.
 *
 * X / Twitter posts carry the original author's handle. We only let a creator
 * publish (or save) an imported X post when that handle matches their own
 * Rubicon username — otherwise they'd be monetizing someone else's content.
 */

/** A handle/username, lowercased and stripped of any leading "@". */
export function normalizeHandle(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^@+/, "").toLowerCase();
}

/** Minimal source shape both the import wizard and saved drafts can satisfy. */
export interface OwnershipSource {
  platform: ArticleSourcePlatform;
  authorHandle: string | null;
}

/**
 * True only when we can *positively* confirm a mismatch: an X import whose
 * known author handle differs from the logged-in creator's known username.
 *
 * When either side is unknown (e.g. the creator is still loading, or the
 * import didn't expose a handle) we can't prove theft, so we don't block.
 */
export function isStolenXContent(
  source: OwnershipSource | null | undefined,
  creatorUsername: string | null | undefined,
): boolean {
  if (!source || source.platform !== "x") return false;
  const handle = normalizeHandle(source.authorHandle);
  const username = normalizeHandle(creatorUsername);
  if (!handle || !username) return false;
  return handle !== username;
}
