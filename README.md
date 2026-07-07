# Rubicon App

The creator dashboard for [app.rubiconpay.xyz](https://app.rubiconpay.xyz).

Rubicon lets writers publish content that AI agents pay to read. Creators set a
per-word USDC price, import existing writing from Substack, Artemis, or X, track
agent reads and earnings, and withdraw settled USDC to their wallet. Payments
settle on-chain through Circle Gateway on Arc, Circle's USDC-native L1.

## What's inside

- **Creator onboarding** (`app/dashboard/_components/substack-onboarding-dialog.tsx`):
  a first-run flow that asks "where do you mostly write?", then runs a
  platform-specific import (Substack archive, Artemis profile search, or X
  handle lookup), lets the creator pick a per-word price, and publishes their
  first article.
- **Dashboard** (`app/dashboard/`): an overview with earnings charts and
  payment activity, an articles list and detail/editor, an earnings page, a
  settings page (wallet, extension tokens, profile), and developer docs.
- **Article publishing**: compose from scratch, import from a URL, or import a
  Markdown file. Articles can be **paid** (per-word USDC, the default) or
  **free**. The body is parsed into billable sections by the gateway, which is
  the source of truth for word counts and billing.
- **Content import** (`lib/import/`): a pluggable, normalized import pipeline.
  Each source has its own importer under `lib/import/importers/` and returns the
  same `ImportResult` contract. New platforms are added by writing an importer,
  teaching `detect.ts`, and registering a case in `index.ts`.
- **Earnings and withdrawals** (`lib/gateway.ts`, `lib/onchain.ts`): earnings
  arrive as Circle Gateway credits. Withdrawing is a two-step, 7-day-delayed
  on-chain flow on the Gateway Wallet contract (`initiateWithdrawal` then
  `withdraw`), with an optional ERC-20 transfer to a different address.

## Tech stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 15 (App Router) + React 19                  |
| Language       | TypeScript                                          |
| Styling        | Tailwind CSS 4                                       |
| Auth           | Privy (email, Twitter, wallet) with embedded wallets |
| Database       | Supabase (Postgres + RLS)                            |
| Payments       | Circle Gateway + Arc (USDC-native L1, testnet)       |
| Editor         | Tiptap (markdown)                                    |
| Data fetching  | TanStack Query                                       |
| Analytics      | PostHog                                              |
| Unit tests     | Vitest                                               |
| Browser tests  | Playwright                                           |
| Package manager| pnpm                                                 |

## Project layout

```
app/
  api/                  API routes (auth, import, onchain, artemis, x, substack)
  dashboard/            Authenticated creator dashboard
    _components/        Shell, onboarding dialog, editor, charts, withdraw dialog
    articles/           Article list, editor, detail, import
    earnings/           Earnings summary
    settings/           Wallet, profile, extension tokens
    docs/               Developer docs
  dashboard-newuser/    New-user onboarding entry
  providers.tsx         Privy + QueryClient providers
lib/
  import/               URL-import dispatch, source detection, per-platform importers
  rubicon/              Supabase client, types, auth wiring, pricing, access, import persistence
  gateway.ts            Circle Gateway ABI + USDC helpers (withdrawal flow)
  onchain.ts            On-chain read/write helpers
  chain.ts              Arc Testnet chain config
supabase/
  migrations/           Ordered SQL schema migrations
  policies.sql          Row-level security policies
e2e/                    Playwright browser tests
```

## Local development

1. Copy `.env.example` to `.env.local` and fill in the required values.
2. Install dependencies with `pnpm install`.
3. Start the app with `pnpm dev`.

The root route (`/`) redirects to `/dashboard`, which gates on Privy auth and
launches onboarding for first-time creators.

### Requirements

- Node `>=20.17 <25` (see `.nvmrc`).
- pnpm.

### Environment variables

See `.env.example` for the full list. The core ones:

- `NEXT_PUBLIC_PRIVY_APP_ID` / `NEXT_PUBLIC_PRIVY_CLIENT_ID` / `PRIVY_APP_SECRET` / `SUPABASE_JWT_SECRET` — creator authentication.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase database.
- `NEXT_PUBLIC_RUBICON_API_BASE` — Rubicon gateway/API.
- `X_COOKIE` / `X_AUTH_BEARER` — optional, for broader X (Twitter) import support. Exact `@handle` lookup works without them; name search and profile-wide Article listing are login-gated by X.

## Verification

| Task              | Command                                          |
| ----------------- | ------------------------------------------------ |
| Unit tests        | `pnpm test`                                      |
| Typecheck         | `pnpm exec tsc --noEmit --incremental false`     |
| Browser tests     | `pnpm test:e2e`                                  |
| Production build  | `pnpm build`                                     |
| Lint              | `pnpm lint`                                      |
| Formatting sanity | `git diff --check`                               |

## Architecture notes

- **Auth to data binding**: the Privy access token is exchanged for a Supabase
  JWT via `POST /api/auth/supabase-token` and forwarded as the bearer token to
  Supabase. RLS enforces that creators only read/write their own rows.
- **Money**: all on-the-wire amounts are atomic USDC units (6 decimals) carried
  as strings to avoid floating-point drift. The UI converts to friendly dollar
  amounts at the boundary via `lib/rubicon/pricing.ts`. The gateway is the
  source of truth for billed word counts.
- **Shared contracts**: `lib/rubicon/types.ts` is the single source of truth on
  the client for article states, price units, earnings, and error formats, and
  is mirrored on the Rubicon backend.
- **Import provenance**: imported drafts persist their source platform, URL,
  author, and any import warnings alongside the article.
