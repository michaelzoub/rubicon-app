"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { buildEarningsDonutSlices, type TrendBar } from "../dashboard/_components/charts";
import { DashboardOverviewContent, type DashboardOverviewProps } from "../dashboard/_components/overview-content";
import { DashboardDialog } from "../dashboard/_components/overlays";
import { DashboardFrame } from "../dashboard/_components/shell";

const earningsTrend: TrendBar[] = [
  { label: "May 26", fullLabel: "Tue, May 26", value: 12.8, detail: "1,280 words" },
  { label: "May 27", fullLabel: "Wed, May 27", value: 21.45, detail: "2,145 words" },
  { label: "May 28", fullLabel: "Thu, May 28", value: 8.9, detail: "890 words" },
  { label: "May 29", fullLabel: "Fri, May 29", value: 34.6, detail: "3,460 words" },
  { label: "May 30", fullLabel: "Sat, May 30", value: 17.25, detail: "1,725 words" },
  { label: "May 31", fullLabel: "Sun, May 31", value: 26.8, detail: "2,680 words" },
  { label: "Jun 1", fullLabel: "Mon, Jun 1", value: 45.4, detail: "4,540 words" },
  { label: "Jun 2", fullLabel: "Tue, Jun 2", value: 29.15, detail: "2,915 words" },
  { label: "Jun 3", fullLabel: "Wed, Jun 3", value: 38.72, detail: "3,872 words" },
  { label: "Jun 4", fullLabel: "Thu, Jun 4", value: 16.9, detail: "1,690 words" },
  { label: "Jun 5", fullLabel: "Fri, Jun 5", value: 57.35, detail: "5,735 words" },
  { label: "Jun 6", fullLabel: "Sat, Jun 6", value: 41.6, detail: "4,160 words" },
  { label: "Jun 7", fullLabel: "Sun, Jun 7", value: 23.48, detail: "2,348 words" },
  { label: "Jun 8", fullLabel: "Mon, Jun 8", value: 49.25, detail: "4,925 words" },
  { label: "Jun 9", fullLabel: "Tue, Jun 9", value: 27.6, detail: "2,760 words" },
  { label: "Jun 10", fullLabel: "Wed, Jun 10", value: 36.84, detail: "3,684 words" },
  { label: "Jun 11", fullLabel: "Thu, Jun 11", value: 18.42, detail: "1,842 words" },
  { label: "Jun 12", fullLabel: "Fri, Jun 12", value: 31.85, detail: "3,185 words" },
  { label: "Jun 13", fullLabel: "Sat, Jun 13", value: 24.7, detail: "2,470 words" },
  { label: "Jun 14", fullLabel: "Sun, Jun 14", value: 52.1, detail: "5,210 words" },
  { label: "Jun 15", fullLabel: "Mon, Jun 15", value: 43.66, detail: "4,366 words" },
  { label: "Jun 16", fullLabel: "Tue, Jun 16", value: 61.25, detail: "6,125 words" },
  { label: "Jun 17", fullLabel: "Wed, Jun 17", value: 39.48, detail: "3,948 words" },
  { label: "Jun 18", fullLabel: "Thu, Jun 18", value: 75.92, detail: "7,592 words" },
  { label: "Jun 19", fullLabel: "Fri, Jun 19", value: 58.14, detail: "5,814 words" },
  { label: "Jun 20", fullLabel: "Sat, Jun 20", value: 46.33, detail: "4,366 words" },
  { label: "Jun 21", fullLabel: "Sun, Jun 21", value: 32.94, detail: "3,294 words" },
  { label: "Jun 22", fullLabel: "Mon, Jun 22", value: 55.08, detail: "5,508 words" },
  { label: "Jun 23", fullLabel: "Tue, Jun 23", value: 41.18, detail: "4,118 words" },
  { label: "Jun 24", fullLabel: "Wed, Jun 24", value: 19, detail: "1,900 words" },
];

const previewArticles = [
  { id: "article_agent_economy", title: "The Agent Economy Is Already Here", words: 12840, reads: 58, earnings: "$142.60", state: "live" as const },
  { id: "article_interfaces_markets", title: "Why Interfaces Become Markets", words: 9640, reads: 43, earnings: "$119.40", state: "live" as const },
  { id: "article_ai_distribution", title: "AI Distribution After Search", words: 11320, reads: 39, earnings: "$102.75", state: "live" as const },
  { id: "article_autonomous_readers", title: "Designing for Autonomous Readers", words: 7280, reads: 21, earnings: "$64.25", state: "paused" as const },
  { id: "article_bundle_economics", title: "The New Bundle Economics", words: 6330, reads: 18, earnings: "$46.33", state: "live" as const },
  { id: "article_machine_audiences", title: "Writing for Machine Audiences", words: 5810, reads: 15, earnings: "$25.76", state: "draft" as const },
];

const historicalPreviewArticles = [
  ...previewArticles,
  { id: "article_protocol_notes", title: "Protocol Notes for Independent Creators", earnedIn: "May 2026", earnings: "$246.80" },
  { id: "article_compound_distribution", title: "Distribution Compounds in Public", earnedIn: "Apr 2026", earnings: "$231.45" },
  { id: "article_agentic_media", title: "The Shape of Agentic Media", earnedIn: "Mar 2026", earnings: "$198.20" },
  { id: "article_pricing_attention", title: "Pricing Attention Without Ads", earnedIn: "Feb 2026", earnings: "$174.90" },
  { id: "article_ai_native_publication", title: "What an AI-Native Publication Looks Like", earnedIn: "Jan 2026", earnings: "$151.70" },
  { id: "article_reading_as_interface", title: "Reading Is Becoming an Interface", earnedIn: "Dec 2025", earnings: "$128.55" },
  { id: "article_small_networks", title: "Small Networks, Durable Audiences", earnedIn: "Nov 2025", earnings: "$112.40" },
  { id: "article_unbundled_essays", title: "The Return of the Unbundled Essay", earnedIn: "Oct 2025", earnings: "$96.80" },
  { id: "article_buyer_intent", title: "When Buyer Intent Becomes Legible", earnedIn: "Sep 2025", earnings: "$82.15" },
  { id: "article_market_for_context", title: "A Market for Context", earnedIn: "Aug 2025", earnings: "$71.60" },
];

const allTimeEarnings = historicalPreviewArticles.reduce((total, article) => total + Number(article.earnings.replace("$", "")), 0);
const recentEarnings = earningsTrend.slice(-7).reduce((total, bar) => total + bar.value, 0);
const earningsSlices = buildEarningsDonutSlices(
  historicalPreviewArticles.map((article) => ({
    label: article.title,
    value: Number(article.earnings.replace("$", "")),
  })),
  7,
);

export default function DashboardPreviewPage() {
  const [previewWithdrawOpen, setPreviewWithdrawOpen] = useState(false);
  const overviewProps: DashboardOverviewProps = useMemo(
    () => ({
      greeting: "@previewcreator",
      exportData: {
        username: "@previewcreator",
        avatarUrl: null,
        totalEarned: allTimeEarnings,
        wordsRead: 50005,
        agentReads: 183,
        topArticle: "The Agent Economy Is Already Here",
        trendBars: earningsTrend,
      },
      stats: [
        {
          label: "Total earnings",
          value: recentEarnings,
          format: formatUsd,
          deltaPct: 14,
          sparklineValues: earningsTrend.map((bar) => bar.value),
          sparklineLabels: earningsTrend.map((bar) => bar.fullLabel),
          sparklineMetricLabel: "Earnings that day",
          sparklineDetails: earningsTrend.map((bar) => `${bar.detail ?? "0 words"} read`),
          context: "Last 7 days",
        },
        {
          label: "Words read",
          value: 50005,
          format: formatInt,
          deltaPct: 9,
          sparklineValues: earningsTrend.map((bar) => Number(bar.detail?.replace(/[^0-9]/g, "") ?? 0)),
          sparklineLabels: earningsTrend.map((bar) => bar.fullLabel),
          sparklineMetricLabel: "Words read that day",
          sparklineDetails: earningsTrend.map((bar) => `${formatUsd(bar.value)} earned`),
          context: "Last 7 days",
        },
        { label: "Live articles", value: 3, format: formatInt, context: "Published now" },
        { label: "Agent reads", value: 183, format: formatInt, deltaPct: 11, context: "Last 7 days" },
      ],
      trendBars: earningsTrend,
      topArticles: previewArticles.slice(0, 6).map((article) => ({
        id: article.id,
        title: article.title,
        earnings: article.earnings,
        value: Number(article.earnings.replace("$", "")),
        href: `/dashboard/articles/${article.id}`,
      })),
      breakdown: {
        totalEarned: formatUsd(allTimeEarnings),
        slices: earningsSlices,
      },
      paymentRows: [
        { id: "pay_1028", title: "The Agent Economy Is Already Here", occurredAt: "Just now", amount: "$19.00", status: "completed" },
        { id: "pay_1027", title: "Why Interfaces Become Markets", occurredAt: "1d ago", amount: "$41.18", status: "completed" },
        { id: "pay_1026", title: "AI Distribution After Search", occurredAt: "2d ago", amount: "$55.08", status: "completed" },
        { id: "pay_1025", title: "Designing for Autonomous Readers", occurredAt: "3d ago", amount: "$32.94", status: "pending" },
        { id: "pay_1024", title: "The New Bundle Economics", occurredAt: "4d ago", amount: "$46.33", status: "completed" },
      ],
      articleRows: previewArticles.map((article) => ({
        id: article.id,
        title: article.title,
        wordsRead: article.words,
        earnings: article.earnings,
        state: article.state,
        href: `/dashboard/articles/${article.id}`,
      })),
      wallet: {
        address: "0x742d35cc6634c0532925a3b844bc9e7595f08f44",
        addressLabel: "0x742d...8f44",
        explorerHref: "https://testnet.arcscan.app/address/0x742d35cc6634c0532925a3b844bc9e7595f08f44",
        explorerLabel: "ArcScan",
        networkName: "Arc Testnet",
        chainId: 5042002,
        balanceLabel: (
          <>
            41.27<span className="ml-1.5 text-sm font-medium text-[var(--muted)]">USDC</span>
          </>
        ),
        onCopy: () => undefined,
        onWithdraw: () => setPreviewWithdrawOpen(true),
        onRefresh: () => undefined,
      },
    }),
    [],
  );

  return (
    <DashboardFrame identity="@previewcreator" activePath="/dashboard">
      <DashboardOverviewContent {...overviewProps} />
      <DashboardDialog
        open={previewWithdrawOpen}
        onClose={() => setPreviewWithdrawOpen(false)}
        labelledBy="preview-withdraw-title"
        className="max-w-md overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h2 id="preview-withdraw-title" className="text-base font-semibold">Withdraw USDC</h2>
          <button type="button" onClick={() => setPreviewWithdrawOpen(false)} className="dashboard-icon-button" aria-label="Close withdraw preview">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-3 p-5">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
            <div className="dashboard-meta">Available balance</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">41.27 <span className="text-sm font-medium text-[var(--muted)]">USDC</span></div>
          </div>
          <p className="dashboard-meta">Preview state for validating payout-to-withdraw dialog replacement.</p>
        </div>
      </DashboardDialog>
    </DashboardFrame>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString();
}
