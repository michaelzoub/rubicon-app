-- Free vs paid articles.
--
-- `paid` is the default so historical zero-priced rows stay *paid* (an unpriced
-- draft), never silently converted to free. A creator makes an article free
-- only by deliberately setting access_mode = 'free' (which the dashboard does
-- explicitly). Free articles skip the positive-price / verified-wallet publish
-- requirements and earn nothing; their readership is measured from
-- word_deliveries rather than word_payments.
--
-- This mirrors the matching column added on the Rubicon gateway. Deploy order:
-- apply this migration, deploy the gateway, then deploy the dashboard controls.
alter table public.articles
  add column if not exists access_mode text not null default 'paid'
    check (access_mode in ('free', 'paid'));
