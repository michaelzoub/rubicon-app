---
name: add-platform-onboarding
description: Add a new writing-platform import + onboarding flow to Rubicon (like Substack, Artemis, X). Use when asked to "add <platform> onboarding/import", wire a new source into the onboarding dialog, or support importing articles from another publishing platform. Every platform is the same shape — search a writer → list their articles → bulk price → go live — so this codifies the proven recipe.
---

# Add a new platform onboarding flow

Rubicon onboards writers by importing an existing archive and pricing each piece for agents. Substack, Artemis, and X all follow the **same shape**; a new platform is almost entirely copy-and-adapt. Follow this recipe and reference the existing Artemis and X implementations as the canonical templates.

## The mental model

Two flows share one pricing/publish step:

- **Bulk (Artemis, X):** search a writer → list their articles → select + price them → publish. The list step only needs `{ id, title, wordCount, url }` per article; the **canonical article URL is rebuilt server-side at commit** and run through the shared `importFromUrl` pipeline. This is the flow to copy for most platforms.
- **ZIP (Substack only):** upload an export archive. Copy this only if the platform has no per-article URL and instead offers a bulk export.

Everything funnels into the normalized `ImportResult` contract (`lib/import/types.ts`). If you fulfill that contract, the API route, dashboard, and editor never special-case the platform.

## Steps (bulk flow — the common case)

Use `<p>` = the new platform id (e.g. `substack`, `artemis`, `x`).

### 1. Importer + detection (the content parser)
- Write `lib/import/importers/<p>Importer.ts` exporting `import<P>(url, deps?) => Promise<ImportResult>`. Keep a pure `build…Result` function so it's unit-testable against fixtures (see `xImporter.ts` / `artemisImporter.ts`). Reuse `lib/import/html.ts` helpers: `splitSections`, `toIso`, `readMeta`, `decodeEntities`.
- Register it in `detectImportSource` (`lib/import/detect.ts`) — add the host + path pattern — and add a `case` in `importFromUrl` (`lib/import/index.ts`).
- Add `<p>` to the `ImportSource` union in `lib/import/types.ts`.

### 2. Server routes (copy `app/api/artemis/*` or `app/api/x/*`)
- **`app/api/<p>/search/route.ts`** — writer typeahead. `GET ?query=` → normalize to `{ handle, name, avatarUrl, ...idIfNeeded }`. Conventions: 2–100 char guard, in-memory TTL cache, `MAX_SUGGESTIONS`, and **`[]` on any failure** (never throw to the client — the paste-a-link fallback covers gaps).
- **`app/api/<p>/articles/route.ts`** — list a writer's articles. Return `{ articles: [{ id/statusId/shortId, title, wordCount, publishedAt, url }] }`. Word counts are best-effort here; the real count is computed at commit. Cache + error-shape like the search route.
- **`app/api/<p>/commit/route.ts`** — bulk publish. **Near-verbatim copy of `app/api/artemis/commit/route.ts`**; only change: handle/id validation regexes, the rebuilt `sourceUrl`, and `source_platform: "<p>"`. It rebuilds the canonical URL from the *validated* handle+id (never trusts client URLs), calls `importFromUrl`, and inserts articles + sections + revisions. Keep the legacy-constraint retry block.
- If the API is **auth-gated** (X's internal endpoints are), add a small auth helper like `lib/import/x-internal-auth.ts` (public bearer + guest token, optional `<P>_COOKIE` env for a real session) and degrade gracefully.

### 3. Registration
- Add `<p>` to `PLATFORM_IMPORT_OPTIONS` and to `ImportOptionId` in `lib/import/options.ts`. Position in the array = tile order in onboarding. Give it `platformLabel` and a `logoSrc` (add a square asset under `public/`). This auto-populates `ONBOARDING_PLATFORM_CHOICES`.
- Extend the DB check constraint: add `<p>` to `articles_source_platform_check` in `supabase/import-fields.sql` **and** a new migration under `supabase/migrations/` (see `20260703010000_artemis_import_source.sql`).

### 4. Onboarding UI (`app/dashboard/_components/substack-onboarding-dialog.tsx`)
Everything here is by analogy to the **Artemis blocks** — search for `artemis` / `Artemis` in that file and mirror each occurrence:
- Add `"<p>"` to the `Step` type; add `<P>Profile` / `<P>ArticleSummary` interfaces; add `"<p>"` to `ArchiveStats.source`.
- Add a `<p>*` state block (input, suggestions, profile, articles, loading/pending/error/checking, refs, `useAnchorRect`).
- Add a typeahead `useEffect` (`step === "<p>"`, hits `/api/<p>/search`), plus `choose<P>Profile` (hits `/api/<p>/articles`, builds `ArchiveStats { source: "<p>" }`, → `price` step), `change<P>Profile`, and a paste-link fallback (`detectImportSource(...) === "<p>"` → `importFromUrl` → `stashImport` handoff).
- Wire the three dispatch points: `continueFromPlatform` (→ `setStep("<p>")`), `backToImport` (→ back to the `<p>` step), and `goLive` (→ `/api/<p>/commit`; if the payload matches Artemis/X, just extend the shared `isBulkUrl`/`endpoint` branch).
- Render a `{step === "<p>" && (...)}` `motion.section` copied from the Artemis one (title, placeholder, `data-testid="<p>-*"`), reusing `SubstackSuggestionLogo` for avatars.
- **Tile grid:** every added platform is one more tile in the "Where do you mostly write?" grid. Bump the `grid-cols-N` (and card `max-w-*`) so tiles stay on one row.

### 5. Tests + verify
- Route test mirroring `app/api/artemis/articles/route.test.ts` (stub `fetch`, assert normalization/pagination). Importer test mirroring `xImporter.test.ts`.
- `npx tsc --noEmit`, `npm test`, then drive the flow (`/run` or `next dev`): tile appears in the right position, search → list → price → **Go live** lands on `/dashboard/articles` with `source_platform = '<p>'`. Confirm the paste-a-link fallback still imports one article when search is empty.

## Gotchas
- **Auth-gated APIs** (internal endpoints): use guest-token/bearer auth server-side and always degrade to `[]` + the link fallback — never hard-fail onboarding.
- **id vs handle:** some list endpoints key on a numeric user id, not the handle (X's `UserArticlesTweets`). Carry the id through search results into the articles call.
- **Word counts** in the list step are estimates; the accurate count comes from the imported body at commit.
- **Never trust client URLs** at commit — rebuild the canonical URL from the validated handle + id.
- Keep the importer's fetch/build split so the parser is unit-testable without network.
