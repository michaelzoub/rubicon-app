"use client";

import { Activity } from "lucide-react";
import { useRubiconQuery } from "@/lib/rubicon/hooks";
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
  const earnings = useRubiconQuery((c) => c.getEarnings(), [], { queryKey: ["earnings"] });
  const wallet = useRubiconQuery((c) => c.getWallet(), [], { queryKey: ["wallet"] });
  const activity = useRubiconQuery((c) => c.getPaymentActivity(), [], { queryKey: ["payment-activity"] });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Earnings"
        description="Payments are routed straight to your receiving wallet. Rubicon never holds your funds."
      />

      {earnings.status === "loading" && <LoadingState />}
      {earnings.status === "error" && earnings.error && <ErrorState error={earnings.error} onRetry={earnings.refetch} />}

      {earnings.status === "success" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Settled earnings" value={formatUsd(earnings.data?.settledEarnings)} />
          <StatTile label="Words paid for" value={(earnings.data?.wordsPaidFor ?? 0).toLocaleString()} />
          <StatTile label="Agent reads" value={(earnings.data?.agentReads ?? 0).toLocaleString()} />
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
        {activity.status === "loading" && <div className="p-5"><LoadingState /></div>}
        {activity.status === "error" && activity.error && <div className="p-5"><ErrorState error={activity.error} onRetry={activity.refetch} /></div>}
        {activity.status === "success" && (activity.data?.length ?? 0) === 0 && (
          <div className="p-5">
            <EmptyState
              icon={<Activity size={22} aria-hidden="true" />}
              title="No payments yet"
              description="Every paid word an agent reads is recorded here, with its settlement reference."
            />
          </div>
        )}
        {activity.status === "success" && (activity.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Article</th>
                  <th className="px-5 py-3 font-medium">Words read</th>
                  <th className="px-5 py-3 font-medium">Gross</th>
                  <th className="px-5 py-3 font-medium">Rubicon fee</th>
                  <th className="px-5 py-3 font-medium">You earn</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Settlement</th>
                </tr>
              </thead>
              <tbody>
                {activity.data!.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-[var(--surface-muted)]">
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-5 py-3"><span className="block max-w-[200px] truncate">{row.articleTitle}</span></td>
                    <td className="px-5 py-3">{row.wordsRead.toLocaleString()}</td>
                    <td className="px-5 py-3">{formatUsd(row.grossAmount)}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">$0</td>
                    <td className="px-5 py-3 font-medium">{formatUsd(row.creatorAmount)}</td>
                    <td className="px-5 py-3"><PaymentStatusPill status={row.status} /></td>
                    <td className="px-5 py-3 mono text-xs text-[var(--muted)]">{row.settlementReference ?? "—"}</td>
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
