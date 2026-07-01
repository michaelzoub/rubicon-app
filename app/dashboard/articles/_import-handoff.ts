"use client";

/**
 * Handoff between the "Import from URL" page and the new-article editor.
 *
 * The import endpoint only parses — it never writes a draft. We stash the
 * normalized result in sessionStorage and route into the existing new-article
 * wizard, which is the review/edit screen and the single place that persists a
 * draft. This keeps the constraint that nothing is saved or published without
 * the creator reviewing it first. Imported markdown can be large, so passing it
 * via sessionStorage (not the URL) avoids query-string limits.
 */
import type { ImportResult } from "@/lib/import/types";

const KEY = "rubicon:import-handoff";

export function stashImport(result: ImportResult): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(result));
  } catch {
    // Storage can be unavailable (private mode / quota); the editor just won't
    // prefill. The import page handles the failure by surfacing an error.
  }
}

/** Read and clear the stashed import, so a refresh doesn't re-import. */
export function takeImport(): ImportResult | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as ImportResult;
  } catch {
    return null;
  }
}
