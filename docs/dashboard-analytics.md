# Dashboard analytics architecture

Creator analytics follow one authenticated server boundary:

```text
dashboard browser
  -> GET /api/analytics/overview or /api/analytics/articles/:articleId
  -> Privy access-token verification
  -> creator id from the verified token
  -> ClickHouse v1 analytical views, scoped by creator id
  -> current article/section metadata from Supabase
  -> ready-to-render JSON with atomic money as decimal strings
```

The browser never receives ClickHouse configuration and never reads
`word_payments`, `word_deliveries`, `stream_sessions`, `settlement_receipts`, or
the bundle ledger. Article CRUD, publishing, wallet settings, and imports remain
RLS-scoped Supabase browser operations.

## Backend contract

The ClickHouse implementation consumes the backend-owned event version `1` and
the schema in `rubicon/apps/gateway/analytics/clickhouse/001_analytics_events.sql`:

- `analytics_events`
- `creator_daily_metrics` and `creator_totals`
- `article_daily_metrics` and `article_totals`
- `session_metrics`, `section_metrics`, and `recent_reads`

Committed `read_bundle_committed` events supply `words_count`; transfer or
settlement counts never stand in for words. Distinct sessions supply agent
reads. Only a `settlement_changed` event with `completed` status contributes to
settled creator earnings. `confirmed`, `pending`, and `failed` remain distinct;
free reads are `not_applicable`. One settlement may cover multiple bundle ids.

Atomic amounts stay strings across the HTTP contract. ClickHouse stores them as
`Decimal(38,0)` and Postgres as `NUMERIC(78,0)`.

## Dates, bounds, and freshness

Both endpoints accept optional inclusive UTC `from` and `to` dates in
`YYYY-MM-DD` form. The default is the trailing 30 UTC days, including today; the
maximum is 366 days. Query parameters, ordering, selected columns, and result
limits are server-owned. Overview responses return at most 10 top articles and
100 recent bundles.

`freshness.latestEventAt` is the latest ClickHouse `ingested_at` timestamp for
the authenticated creator (and article when applicable). The response is stale
when its lag from `generatedAt` exceeds `ANALYTICS_STALE_AFTER_MS`. Empty
accounts have no timestamp and are not marked stale.

TanStack Query keeps the last successful response during background refreshes.
If a refresh fails, the dashboard labels the retained response instead of
silently replacing it with zeros.

## Configuration

Production should use `ANALYTICS_BACKEND=clickhouse` with the official
`@clickhouse/client`. `ANALYTICS_BACKEND=postgres` uses `DATABASE_URL` and
executes the same bundle-level aggregates on the server for local development
or controlled fallback.

Required server-only variables are documented in `.env.example`. Do not create
`NEXT_PUBLIC_` aliases for ClickHouse or Postgres credentials.
