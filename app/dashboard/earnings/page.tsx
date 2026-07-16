"use client";

import { Activity } from "lucide-react";
import { useRubiconQuery } from "@/lib/rubicon/hooks";
import { useAnalyticsOverview } from "@/lib/analytics/hooks";
import { formatUsd } from "@/lib/rubicon/pricing";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  formatDate,
  LoadingState,
  PageHeader,
  PaymentStatusPill,
  shortWallet,
  StatTile,
  WalletStatePill,
} from "../_components/ui";

export default function EarningsPage() {
  const analytics = useAnalyticsOverview();
  const wallet = useRubiconQuery((c) => c.getWallet(), [], { queryKey: ["wallet"] });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Earnings"
        description="Payments are routed straight to your receiving wallet. Rubicon never holds your funds."
      />

      {analytics.isPending && !analytics.data && <LoadingState />}
      {analytics.error && !analytics.data && <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />}
      {analytics.data && analytics.error && (
        <div className="rounded-lg border border-[#eddcbd] bg-[#fdf9f1] px-4 py-3 text-sm text-[#7b4e12]" role="status">
          Couldn’t refresh analytics. Showing the last successful response.
        </div>
      )}
      {analytics.data && !analytics.error && analytics.data.freshness.stale && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--muted)]" role="status">
          Analytics are delayed. Recent reads and settlements may not appear yet.
        </div>
      )}

      {analytics.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Completed earnings" value={formatUsd(analytics.data.totals.settledCreatorAmountAtomic)} />
          <StatTile label="Pending earnings" value={formatUsd(analytics.data.totals.pendingCreatorAmountAtomic)} />
          <StatTile label="Agent reads" value={analytics.data.totals.agentReads.toLocaleString()} />
        </div>
      )}

      <Card>
        <CardHeader title="Receiving wallet" />
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          {wallet.status === "loading" && <span className="text-sm text-[var(--muted)]">Loading wallet…</span>}
          {wallet.status === "error" && wallet.error && <span className="text-sm text-[#8d2f2d]">{wallet.error.message}</span>}
          {wallet.status === "success" && (
            <>
              <div>
                <div className="mono text-sm">{shortWallet(wallet.data?.address)}</div>
                <div className="mt-1 text-xs text-[var(--muted)]">Funds for paid words are settled here.</div>
              </div>
              {wallet.data?.address && <WalletStatePill verified={wallet.data.verified} />}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment activity" />
        {analytics.isPending && <div className="p-5"><LoadingState /></div>}
        {analytics.data && analytics.data.recentReads.length === 0 && (
          <div className="p-5">
            <EmptyState
              icon={<Activity size={22} aria-hidden="true" />}
              title="No payments yet"
              description="Every paid word an agent reads is recorded here, with its settlement reference."
            />
          </div>
        )}
        {analytics.data && analytics.data.recentReads.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Article</th>
                  <th className="px-5 py-3 font-medium">Words read</th>
                  <th className="px-5 py-3 font-medium">Gross</th>
                  <th className="px-5 py-3 font-medium">You earn</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {analytics.data.recentReads.map((row) => (
                  <tr key={row.bundleId} className="transition-colors hover:bg-[var(--surface-muted)]">
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(row.occurredAt)}</td>
                    <td className="px-5 py-3"><span className="block max-w-[200px] truncate">{row.articleTitle}</span></td>
                    <td className="px-5 py-3">{row.wordsRead.toLocaleString()}</td>
                    <td className="px-5 py-3">{formatUsd(row.creatorAmountAtomic)}</td>
                    <td className="px-5 py-3 font-medium">{formatUsd(row.settledCreatorAmountAtomic)}</td>
                    <td className="px-5 py-3"><PaymentStatusPill status={row.settlementStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
