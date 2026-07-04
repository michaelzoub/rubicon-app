/**
 * Public entry point for URL-based content import.
 *
 * Detects the source from the URL and dispatches to the matching importer. All
 * importers return the normalized `ImportResult`, so adding a platform is just:
 * write `importers/<name>.ts`, teach `detectImportSource`, and add a case here.
 */
import { detectImportSource, parseImportUrl } from "./detect";
import { ImportError, ImportResult, ImporterDeps } from "./types";
import { importSubstack } from "./importers/substackImporter";
import { importX } from "./importers/xImporter";
import { importArtemis } from "./importers/artemisImporter";

export { detectImportSource } from "./detect";
export { ImportError } from "./types";
export type { ImportResult } from "./types";

/** Fetch and normalize a Substack, Artemis, or X URL into a Rubicon draft payload. */
export async function importFromUrl(rawUrl: string, deps?: ImporterDeps): Promise<ImportResult> {
  // Validate up front so a bad URL fails fast with a clear code.
  parseImportUrl(rawUrl);

  const source = detectImportSource(rawUrl);
  switch (source) {
    case "substack":
      return importSubstack(rawUrl, deps);
    case "x":
      return importX(rawUrl, deps);
    case "artemis":
      return importArtemis(rawUrl, deps);
    default:
      throw new ImportError(
        "unsupported_source",
        "We can only import from Substack, Artemis, or X/Twitter URLs right now.",
      );
  }
}
