"use client";

import { useMemo } from "react";
import { DONUT_COLORS, type DonutSlice, type TrendBar } from "../dashboard/_components/charts";
import { DashboardOverviewContent, type DashboardOverviewProps } from "../dashboard/_components/overview-content";
import { DashboardFrame } from "../dashboard/_components/shell";

const earningsTrend: TrendBar[] = [
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

const earningsSlices: DonutSlice[] = previewArticles.map((article, index) => ({
  label: article.title,
  value: Number(article.earnings.replace("$", "")),
  color: DONUT_COLORS[index],
}));

const previewHeatmapCells = Array.from({ length: 24 * 7 }, (_, index) => {
  const hour = Math.floor(index / 7);
  const day = index % 7;
  const workingHours = hour >= 9 && hour <= 20;
  const peak = hour >= 11 && hour <= 15;
  return { day, hour, reads: workingHours ? (peak ? ((day * 3 + hour) % 7) + 2 : ((day + hour) % 4) + 1) : (day + hour) % 8 === 0 ? 1 : 0 };
});

export default function DashboardPreviewPage() {
  const overviewProps: DashboardOverviewProps = useMemo(
    () => ({
      greeting: "@previewcreator",
      exportData: {
        username: "@previewcreator",
        avatarUrl: null,
        totalEarned: 501.09,
        wordsRead: 50005,
        agentReads: 183,
        topArticle: "The Agent Economy Is Already Here",
        trendBars: earningsTrend,
      },
      activityCalendar: [],
      stats: [
        {
          label: "Total earnings",
          value: 501.09,
          format: formatUsd,
          deltaPct: 14,
          sparklineValues: earningsTrend.map((bar) => bar.value),
          sparklineLabels: earningsTrend.map((bar) => bar.fullLabel),
          sparklineMetricLabel: "Earnings that day",
          sparklineDetails: earningsTrend.map((bar) => `${bar.detail ?? "0 words"} read`),
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
        },
        { label: "Live articles", value: 3, format: formatInt },
        { label: "Agent reads", value: 183, format: formatInt, deltaPct: 11 },
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
        totalEarned: "$501.09",
        slices: earningsSlices,
      },
      activityHeatmap: {
        cells: previewHeatmapCells,
        totalReads: 183,
        windowDays: 28,
      },
      paymentRows: [
        { id: "pay_1028", title: "The Agent Economy Is Already Here", meta: "Just now · 1,900 words read", amount: "$19.00", status: "completed" },
        { id: "pay_1027", title: "Why Interfaces Become Markets", meta: "1d ago · 4,118 words read", amount: "$41.18", status: "completed" },
        { id: "pay_1026", title: "AI Distribution After Search", meta: "2d ago · 5,508 words read", amount: "$55.08", status: "completed" },
        { id: "pay_1025", title: "Designing for Autonomous Readers", meta: "3d ago · 3,294 words read", amount: "$32.94", status: "pending" },
        { id: "pay_1024", title: "The New Bundle Economics", meta: "4d ago · 4,633 words read", amount: "$46.33", status: "completed" },
      ],
      articleRows: previewArticles.map((article) => ({
        id: article.id,
        title: article.title,
        meta: `${article.reads.toLocaleString()} reads · ${article.words.toLocaleString()} words`,
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
        onWithdraw: () => undefined,
        onRefresh: () => undefined,
      },
    }),
    [],
  );

  return (
    <DashboardFrame identity="@previewcreator" activePath="/dashboard">
      <DashboardOverviewContent {...overviewProps} />
    </DashboardFrame>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString();
}
