---
name: project-map
description: Concise orientation map for important Rubicon app routes, architecture, and verification commands.
---

# Rubicon app project map

## App entrypoints

- `app/page.tsx`: public landing page.
- `app/dashboard/layout.tsx` and `app/dashboard/_components/shell.tsx`: authenticated creator dashboard shell.
- `app/dashboard/_components/overlays.tsx` and `app/dashboard/dashboard.css`: shared dashboard portal, dialog stack/focus/scroll behavior, motion tokens, typography tokens, and documented z-index scale. See `UI_CONVENTIONS.md`.
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

- `app/api/analytics/overview/`, `app/api/analytics/articles/[articleId]/`, and `lib/analytics/`: Privy-authenticated, creator-scoped analytics boundary. Production uses backend-owned ClickHouse v1 events over server-side native HTTP; totals, earnings activity, and article rankings resolve each read against its latest settlement status so migrated zero-delta records remain accurate. The overview accepts `allTime=1` for the dashboard’s historical earnings breakdown, while its default response remains a 30-day operational view. A server-side `read_bundles` Postgres repository is the controlled fallback. Supabase hydrates current article/section metadata, while backfilled evidence without a local article row remains visible as archived. Atomic money remains strings, and browser dashboard code never reads raw ledgers or credentials. See `docs/dashboard-analytics.md`.
- `lib/rubicon/client.ts` and `types.ts`: dashboard/Supabase contract, including creator-owned wallet records keyed by network for Arc and verified AgentCash Base (`eip155:8453`) recipients.
- `app/api/agentcash/wallet/route.ts`: development-only endpoint that verifies the requested EVM address is linked to the authenticated Privy creator before storing it as that creator's verified Base wallet; private keys never reach Rubicon.
- `lib/gateway.ts`, `gateway-client.ts`, `chain.ts`, and `onchain.ts`: metered access and payment integration.
- `lib/rubicon/embeddings.ts` and `app/api/embeddings/sync/route.ts`: write side of the gateway's semantic-search contract. On publish/edit/unpublish, `syncArticleEmbeddings` writes per-section `text-embedding-3-small` vectors to `article_section_embeddings` (service role + `OPENAI_API_KEY`); the browser client fires the route best-effort, and the import commit routes seed it in bulk. Section slicing mirrors the gateway's `tokenizeWords`/`clampSectionsToWords`.
- `supabase/migrations/`: ordered schema changes. Artemis source support is in `20260703010000_artemis_import_source.sql`; creator wallet records became network-keyed in `20260710000000_creator_wallet_networks.sql`. The `article_section_embeddings` table is owned by the gateway repo's migration `0009`, not here.

## Verification

- Unit tests: `pnpm test`
- Typecheck: `pnpm exec tsc --noEmit --incremental false`
- Browser tests: `pnpm test:e2e`
- Production build: `pnpm build`
- Production server: `pnpm start`
- Formatting sanity: `git diff --check`
