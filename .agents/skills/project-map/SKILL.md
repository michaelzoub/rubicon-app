---
name: project-map
description: Concise orientation map for important Rubicon app routes, architecture, and verification commands.
---

# Rubicon app project map

## App entrypoints

- `app/page.tsx`: public landing page.
- `app/dashboard/layout.tsx` and `app/dashboard/_components/shell.tsx`: authenticated creator dashboard shell.
- `app/dashboard/_components/substack-onboarding-dialog.tsx`: first-run platform selection plus Substack and Artemis onboarding/pricing flows; renders through a body portal and owns document scroll while open.
- `app/dashboard/articles/new/page.tsx`: new article and URL-import review/publish flow.
- `app/dashboard/imports/[draftId]/page.tsx`: extension-import draft review.

## Imports

- `lib/import/index.ts`, `detect.ts`, and `types.ts`: normalized URL-import dispatch and contracts.
- `lib/import/importers/`: source parsers for Substack, X, and Artemis.
- `app/api/import/url/route.ts`: one-article URL import API.
- `app/api/import/substack/` and `app/api/import/substack/commit/`: Substack archive staging and publish.
- `app/api/artemis/search/`, `articles/`, and `commit/`: Artemis profile search, fully paginated published-article listing, and bulk publish.
- `app/api/x/search/`, `articles/`, and `commit/`: X exact-handle lookup (credential-free via FxTwitter), session-backed X Articles listing with dynamically discovered GraphQL query IDs, and bulk publish. Name search and profile-wide listing require `X_COOKIE`; pasted article URLs use the shared URL importer without it.
- `lib/rubicon/import-server.ts`: service-role import persistence helpers; never expose its credentials to clients.

## Data and payments

- `lib/rubicon/client.ts` and `types.ts`: dashboard/Supabase contract.
- `lib/gateway.ts`, `gateway-client.ts`, `chain.ts`, and `onchain.ts`: metered access and payment integration.
- `supabase/migrations/`: ordered schema changes. Artemis source support is in `20260703010000_artemis_import_source.sql`.

## Verification

- Unit tests: `pnpm test`
- Typecheck: `pnpm exec tsc --noEmit --incremental false`
- Browser tests: `pnpm test:e2e`
- Production build: `pnpm build`
- Formatting sanity: `git diff --check`
