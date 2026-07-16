"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ImagePlus,
  RefreshCw,
  ShieldCheck,
  Wallet2,
  X,
} from "lucide-react";
import type { ArticleState } from "@/lib/rubicon/types";
import type { AnalyticsSettlementStatus } from "@/lib/analytics/types";
import { formatUsdDisplay } from "@/lib/rubicon/pricing";
import { RubiconBrand } from "../../_components/rubicon-brand";
import { ChartEmptyState, CountUp, Donut, Reveal, Sparkline, TrendChart, type DonutSlice, type TrendBar } from "./charts";
import { DashboardDialog } from "./overlays";
import {
  Card,
  CardHeader,
  EmptyState,
  MetricTrend,
  PageHeader,
  RefreshDots,
  Skeleton,
  shortWallet,
} from "./ui";

export interface DashboardOverviewStat {
  label: string;
  value: number;
  format: (value: number) => string;
  deltaPct?: number | null;
  context?: string;
  sparklineValues?: number[];
  sparklineLabels?: string[];
  sparklineMetricLabel?: string;
  sparklineDetails?: string[];
}

export interface DashboardOverviewPaymentRow {
  id: string;
  title: string;
  occurredAt: string;
  amount: string;
  status: AnalyticsSettlementStatus;
}

export interface DashboardOverviewArticleRow {
  id: string;
  title: string;
  wordsRead: number;
  earnings: string;
  state: ArticleState;
  href?: string;
}

export interface DashboardOverviewWallet {
  address: string | null;
  addressLabel?: string;
  explorerHref?: string;
  explorerLabel?: string;
  networkName?: string;
  chainId?: string | number;
  balanceLabel?: ReactNode;
  balanceError?: string;
  onCopy?: () => void;
  copied?: boolean;
  onWithdraw?: () => void;
  onRefresh?: () => void;
  settingsHref?: string;
}

export interface DashboardOverviewExport {
  username: string;
  avatarUrl: string | null;
  totalEarned: number;
  wordsRead: number;
  agentReads: number;
  topArticle: string | null;
  trendBars: TrendBar[];
}

export interface DashboardOverviewProps {
  greeting: string;
  exportData?: DashboardOverviewExport;
  stats: DashboardOverviewStat[];
  trendBars: TrendBar[];
  topArticles?: Array<{
    id?: string;
    title: string;
    earnings: string;
    value?: number;
    href?: string;
  }>;
  breakdown?: {
    totalEarned: string;
    slices: DonutSlice[];
  } | null;
  paymentRows: DashboardOverviewPaymentRow[];
  articleRows: DashboardOverviewArticleRow[];
  wallet: DashboardOverviewWallet;
  /** True while a background refresh is in flight — shows a tiny inline cue
      without tearing down the visible data. */
  refreshing?: boolean;
}

export function DashboardOverviewContent({
  exportData,
  stats,
  trendBars,
  topArticles = [],
  breakdown,
  paymentRows,
  articleRows,
  wallet,
  refreshing = false,
}: DashboardOverviewProps) {
  const hasTopArticles = topArticles.length > 0;
  const hasBreakdown = Boolean(breakdown && breakdown.slices.length > 0);
  const [payoutOpen, setPayoutOpen] = useState(false);

  return (
    <div className="grid gap-3 sm:gap-4">
      <PageHeader
        title="Overview"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshing && <RefreshDots />}
            <button type="button" onClick={() => setPayoutOpen(true)} className="button button-secondary text-sm">
              <Wallet2 size={15} aria-hidden="true" /> Payout connection
            </button>
            <ContentProtectionPolicy />
            {exportData && <ExportButton {...exportData} />}
          </div>
        }
      />

      <Reveal delay={0.02} className="dashboard-tooltip-layer relative">
        <UnifiedMetricsPanel stats={stats} />
      </Reveal>

      <div className="grid min-w-0 gap-3 sm:gap-4">
        <div className={`grid min-w-0 gap-3 ${hasTopArticles ? "lg:grid-cols-[minmax(0,2.125fr)_minmax(18rem,1fr)]" : ""}`}>
          <Reveal delay={0.06} className="h-full">
            <MoneyActivityChart bars={exportData?.trendBars ?? trendBars} />
          </Reveal>

          {hasTopArticles && (
            <Reveal delay={0.09} className="h-full">
              <TopArticlesPodium articles={topArticles} />
            </Reveal>
          )}
        </div>

        {hasBreakdown && (
          <Reveal delay={0.12} className="h-full">
            <EarningsBreakdown breakdown={breakdown!} />
          </Reveal>
        )}

        <div className="grid items-start gap-3 lg:grid-cols-2">
          <PaymentActivityRows rows={paymentRows} />
          <ArticleRows rows={articleRows} />
        </div>
      </div>

      <PayoutConnectionDialog open={payoutOpen} onClose={() => setPayoutOpen(false)} wallet={wallet} />
    </div>
  );
}

function UnifiedMetricsPanel({ stats }: { stats: DashboardOverviewStat[] }) {
  return (
    <Card className="grid min-h-[126px] overflow-visible sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={`dashboard-metric-cell relative flex min-w-0 flex-col justify-between px-4 py-3.5 sm:px-5 ${metricDividerClass(index)}`}
          data-dashboard-metric={stat.label}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[0.72rem] font-medium text-[var(--muted)]">{stat.label}</span>
            {stat.deltaPct !== undefined && <MetricTrend value={stat.deltaPct} />}
          </div>
          <div className="mt-3 text-[1.45rem] font-semibold leading-none tracking-[-0.035em] tabular-nums">
            <CountUp value={stat.value} format={stat.format} />
          </div>
          <div className="mt-3 flex min-h-4 items-end justify-between gap-2">
            {stat.context && <span className="text-[0.68rem] leading-4 text-[var(--quiet)]">{stat.context}</span>}
            {stat.sparklineValues && stat.sparklineValues.length > 1 && (
              <div className="ml-auto w-16 opacity-55">
                <Sparkline
                  values={stat.sparklineValues}
                  labels={stat.sparklineLabels}
                  metricLabel={stat.sparklineMetricLabel ?? stat.label}
                  details={stat.sparklineDetails}
                  formatValue={stat.format}
                  height={20}
                  strokeWidth={1}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

function metricDividerClass(index: number) {
  if (index === 0) return "";
  if (index === 1) return "border-t border-[var(--line)] sm:border-l sm:border-t-0";
  if (index === 2) return "border-t border-[var(--line)] xl:border-l xl:border-t-0";
  return "border-t border-[var(--line)] sm:border-l xl:border-l xl:border-t-0";
}

/** A deliberately simple loading shimmer that follows the loaded overview's
    major geometry without trying to pixel-match every data state. */
export function OverviewSkeleton({ refreshing = false }: { refreshing?: boolean }) {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Overview"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshing && <RefreshDots />}
            <ContentProtectionPolicy />
            <Skeleton className="h-8 w-28" />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="grid min-h-[108px] content-between gap-6 p-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-28" />
          </Card>
        ))}
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,1fr)]">
        <Card className="min-h-[20rem] p-4">
          <Skeleton className="h-4 w-36" />
          <div className="mt-6 flex h-[12rem] items-end gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="flex-1" rounded="rounded" />
            ))}
          </div>
        </Card>
        <Card className="min-h-[20rem] p-4 sm:p-5">
          <Skeleton className="h-4 w-28" />
          <div className="mt-5 grid grid-cols-3 items-end gap-2 sm:gap-3">
            {["h-20", "h-28", "h-16"].map((height, i) => (
              <div key={i} className="grid gap-3">
                <Skeleton className={`${height} w-full`} rounded="rounded-t-lg" />
                <Skeleton className="mx-auto h-3 w-4/5" />
                <Skeleton className="mx-auto h-2.5 w-3/5" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="min-h-[12rem] p-4">
        <Skeleton className="h-4 w-36" />
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-6">
          <Skeleton className="h-24 w-full" rounded="rounded-lg" />
          <Skeleton className="aspect-square w-full" rounded="rounded-full" />
        </div>
      </Card>

      <Card className="min-h-[10rem] p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-5 h-20 w-full" rounded="rounded-lg" />
      </Card>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card} className="p-4">
            <Skeleton className="h-4 w-40" />
            <div className="mt-5 grid gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-4">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3.5 w-12" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const PODIUM_STYLES = [
  {
    rank: 1,
    top: "#fff0c4",
    front: "#f7d77e",
    side: "#dfac43",
    badge: "#9c660d",
    line: "#ecc767",
    height: "4.25rem",
  },
  {
    rank: 2,
    top: "#ffffff",
    front: "#f1f2f4",
    side: "#d5d8dc",
    badge: "#969aa2",
    line: "#e4e6e9",
    height: "4.25rem",
  },
  {
    rank: 3,
    top: "#fff0e4",
    front: "#efcba9",
    side: "#d79c68",
    badge: "#b67534",
    line: "#e9c8ad",
    height: "4.25rem",
  },
] as const;

function TopArticlesPodium({ articles }: { articles: NonNullable<DashboardOverviewProps["topArticles"]> }) {
  const ranked = articles.slice(0, 6);
  const leaders = ranked.slice(0, 3);
  const runners = ranked.slice(3, 6);
  const podiumOrder = leaders.length === 3 ? [leaders[1], leaders[0], leaders[2]] : leaders.length === 2 ? [leaders[1], leaders[0]] : leaders;
  const podiumGridClass = leaders.length === 1
    ? "mx-auto w-full max-w-32 grid-cols-1"
    : leaders.length === 2
      ? "mx-auto w-full max-w-64 grid-cols-2"
      : "grid-cols-3";
  const total = ranked.reduce((sum, article) => sum + (article.value ?? 0), 0);

  return (
    <Card className="flex h-full min-h-[20rem] flex-col overflow-hidden p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="dashboard-panel-title">Top articles</h2>
        <span className="dashboard-meta">Ranked by earnings</span>
      </div>
      <ol className={`mt-4 grid items-stretch gap-1.5 sm:gap-2 ${podiumGridClass}`} aria-label="Top three articles">
        {podiumOrder.map((article) => {
          const rank = leaders.indexOf(article);
          const style = PODIUM_STYLES[rank] ?? PODIUM_STYLES[2];
          const percentage = total > 0 && article.value !== undefined ? (article.value / total) * 100 : null;
          return <PodiumPlace key={article.id ?? article.title} article={article} style={style} percentage={percentage} />;
        })}
      </ol>
      {runners.length > 0 && (
        <ol className="mt-3 divide-y divide-[var(--line)] border-t border-[var(--line)]" aria-label="Fourth through sixth place">
          {runners.map((article, index) => {
            const rank = index + 4;
            const percentage = total > 0 && article.value !== undefined ? (article.value / total) * 100 : null;
            return <PodiumRunner key={article.id ?? article.title} article={article} rank={rank} percentage={percentage} />;
          })}
        </ol>
      )}
    </Card>
  );
}

function PodiumPlace({
  article,
  style,
  percentage,
}: {
  article: NonNullable<DashboardOverviewProps["topArticles"]>[number];
  style: typeof PODIUM_STYLES[number];
  percentage: number | null;
}) {
  const content = (
    <>
      <div className="relative flex h-[5.5rem] w-full items-end" aria-hidden="true">
        <div className="relative w-full" style={{ height: style.height }}>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 56" preserveAspectRatio="none">
            <polygon points="1,9 9,1 99,1 91,9" fill={style.top} stroke={style.line} vectorEffect="non-scaling-stroke" />
            <polygon points="1,9 91,9 91,55 1,55" fill={style.front} stroke={style.line} vectorEffect="non-scaling-stroke" />
            <polygon points="91,9 99,1 99,47 91,55" fill={style.side} stroke={style.line} vectorEffect="non-scaling-stroke" />
          </svg>
          <span
            className="absolute left-[46%] top-[57%] grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/45 text-[0.68rem] font-semibold tabular-nums text-white"
            style={{ backgroundColor: style.badge, zIndex: "var(--dashboard-z-content)" }}
          >
            {style.rank}
          </span>
        </div>
      </div>
      <div className="grid min-w-0 grid-rows-[2.1rem_1rem] px-0.5 pt-2 text-center">
        <p className="line-clamp-2 w-full text-[0.72rem] font-semibold leading-[1.05rem] text-[var(--ink)] group-hover:text-[var(--river-deep)]" title={article.title}>
          {article.title}
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1.5 text-[0.64rem] tabular-nums text-[var(--quiet)]">
          <span className="font-medium text-[var(--muted)]">{article.earnings}</span>
          {percentage !== null && <span>{percentage.toFixed(1)}%</span>}
        </p>
      </div>
    </>
  );
  const className = "group relative flex w-full min-w-0 flex-col justify-end rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--river-line)]";
  return (
    <li className="flex min-w-0 self-stretch items-end">
      {article.href ? <Link href={article.href} className={className}>{content}</Link> : <div className={className}>{content}</div>}
    </li>
  );
}

function PodiumRunner({
  article,
  rank,
  percentage,
}: {
  article: NonNullable<DashboardOverviewProps["topArticles"]>[number];
  rank: number;
  percentage: number | null;
}) {
  const content = (
    <>
      <span className="w-7 text-[0.62rem] font-medium tracking-[0.08em] tabular-nums text-[var(--quiet)]" data-rank>{String(rank).padStart(2, "0")}</span>
      <span className="min-w-0 truncate text-xs font-medium" title={article.title}>{article.title}</span>
      <span className="text-right text-[0.68rem] font-medium tabular-nums">{article.earnings}</span>
      <span className="text-right text-[0.66rem] tabular-nums text-[var(--quiet)]">{percentage === null ? "—" : `${percentage.toFixed(1)}%`}</span>
    </>
  );
  const className = "group grid min-h-10 min-w-0 grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_3rem] items-center gap-2 rounded-[5px] px-1.5 transition-[background-color,color] duration-150 hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--river-line)] motion-reduce:transition-none";
  return (
    <li className="min-w-0">
      {article.href ? <Link href={article.href} className={className}>{content}</Link> : <div className={className}>{content}</div>}
    </li>
  );
}

function EarningsBreakdown({ breakdown }: { breakdown: NonNullable<DashboardOverviewProps["breakdown"]> }) {
  return (
    <Card className="h-full min-h-[13rem] overflow-hidden">
      <div className="flex items-end justify-between gap-3 px-4 pb-1 pt-3.5">
        <div>
          <h2 className="dashboard-panel-title">Earnings breakdown</h2>
          <div className="dashboard-meta mt-0.5">All-time settled earnings by article</div>
        </div>
        <div className="text-sm font-semibold tabular-nums">{breakdown.totalEarned}</div>
      </div>
      <div className="flex min-h-[10rem] items-center px-4 pb-4 pt-2">
        <Donut slices={breakdown.slices} centerValue={breakdown.totalEarned} centerLabel="All-time earnings" size={132} stroke={12} />
      </div>
    </Card>
  );
}

function MoneyActivityChart({ bars }: { bars: TrendBar[] }) {
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const paidDays = bars.filter((bar) => bar.value > 0).length;
  const hasMeaningfulData = paidDays > 0;
  return (
    <Card className="flex h-full min-h-[20rem] flex-col overflow-hidden">
      <div className="flex flex-col gap-3 px-4 pb-1 pt-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className="dashboard-panel-title text-balance">Earnings activity</h2>
          <p className="dashboard-meta mt-0.5">Last {bars.length} days · settled agent reads</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{formatUsdDisplay(total)}</div>
          <div className="dashboard-meta">{paidDays} paid days</div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        {hasMeaningfulData ? (
          <TrendChart bars={bars} formatValue={formatUsdDisplay} height="100%" />
        ) : (
          <ChartEmptyState title="Waiting for first settled read" description="Earnings activity appears after an agent completes a paid read." />
        )}
      </div>
    </Card>
  );
}

const CONTENT_PROTECTION_RULES = [
  {
    title: "Drafts stay private",
    detail: "Draft text is available only inside your creator workspace. It is not listed or previewed to agents.",
  },
  {
    title: "Discovery never includes the article body",
    detail: "Before payment, agents can see listing metadata and section headings, but not paragraphs or the full article text.",
  },
  {
    title: "Payment is required before delivery",
    detail: "Protected words are returned only after the payment requirement for that request has been satisfied.",
  },
  {
    title: "Only purchased words are released",
    detail: "Rubicon returns the paid section or word range. Everything outside that purchase remains unavailable.",
  },
  {
    title: "Your workspace and source remain closed",
    detail: "Agents receive a paid response, never access to your editor, drafts, or complete stored article.",
  },
];

export function ContentProtectionPolicy() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="button button-secondary text-sm" aria-expanded={open} aria-controls="content-protection-popover">
        <ShieldCheck size={15} aria-hidden="true" /> Content Protection Policy
      </button>
      {open && <div id="content-protection-popover" className="absolute right-0 top-[calc(100%+0.5rem)] w-[min(27rem,calc(100vw-2rem))] rounded-[10px] border border-[var(--line)] bg-white p-4 text-left" style={{ zIndex: "var(--dashboard-z-popover)" }}>
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--muted)]">
            <ShieldCheck size={17} aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold">Content Protection Policy</h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Rubicon separates discovery from delivery. Publishing makes your listing discoverable while the article text stays protected.
        </p>
        <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {CONTENT_PROTECTION_RULES.map((rule) => (
            <div key={rule.title} className="grid grid-cols-[18px_1fr] gap-3 py-3">
              <CheckCircle2 size={16} className="mt-0.5 text-[var(--ink)]" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold">{rule.title}</div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{rule.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}

function PaymentActivityRows({ rows }: { rows: DashboardOverviewPaymentRow[] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            Recent payment activity
            {rows.length > 0 && <LiveDot />}
          </span>
        }
        action={
          <Link href="/dashboard/earnings" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline">
            View all
          </Link>
        }
      />
      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={<Wallet2 size={22} aria-hidden="true" />}
            title="No payments yet"
            description="When an agent reads your articles, every paid word shows up here."
          />
        </div>
      ) : (
        <>
          <div className="px-4 pt-1 sm:px-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 border-b border-[var(--line)] pb-2 text-[0.63rem] font-medium uppercase tracking-[0.08em] text-[var(--quiet)]">
              <span>Article</span>
              <span className="text-right">Amount</span>
              <span className="w-[4.7rem] text-right">Status</span>
            </div>
          </div>
          <ul className="divide-y divide-[var(--line)] px-4 pb-1 sm:px-5">
            {rows.slice(0, 5).map((row) => (
              <li key={row.id} className="grid min-h-[56px] min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[0.82rem] font-medium">{row.title}</div>
                  <div className="mt-0.5 text-[0.7rem] text-[var(--muted)]">{row.occurredAt}</div>
                </div>
                <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{row.amount}</span>
                <span className="w-[4.7rem] shrink-0 text-right"><PaymentStatusText status={row.status} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ArticleRows({ rows }: { rows: DashboardOverviewArticleRow[] }) {
  return (
    <Card>
      <CardHeader
        title={<span className="text-sm font-medium">Your articles</span>}
        action={
          <Link href="/dashboard/articles" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline">
            Manage
          </Link>
        }
      />
      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={<FileText size={22} aria-hidden="true" />}
            title="No articles yet"
            description="Publish your first article to let agents pay to read it."
            action={
              <Link href="/dashboard/articles/new" className="button button-primary text-sm">
                New article
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="hidden px-4 pt-1 sm:block sm:px-5">
            <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.75rem_4.5rem] gap-3 border-b border-[var(--line)] pb-2 text-[0.63rem] font-medium uppercase tracking-[0.08em] text-[var(--quiet)]">
              <span>Article</span>
              <span className="text-right">Words</span>
              <span className="text-right">Earned</span>
              <span className="text-right">Status</span>
            </div>
          </div>
          <ul className="divide-y divide-[var(--line)] px-4 pb-1 sm:px-5">
          {rows.slice(0, 4).map((row) => {
            const content = (
              <>
                <div className="min-w-0">
                  <div className="truncate text-[0.82rem] font-medium">{row.title}</div>
                  <div className="mt-0.5 text-[0.7rem] text-[var(--muted)] sm:hidden">{row.wordsRead.toLocaleString()} words read</div>
                </div>
                <span className="hidden text-right text-xs tabular-nums text-[var(--muted)] sm:block">{row.wordsRead.toLocaleString()}</span>
                <span className="text-right text-sm font-semibold tabular-nums">{row.earnings}</span>
                <span className="w-[4.5rem] text-right"><ArticleStateText state={row.state} /></span>
              </>
            );
            return (
              <li key={row.id} className="min-w-0">
                {row.href ? (
                  <Link href={row.href} className="grid min-h-[56px] min-w-0 grid-cols-[minmax(0,1fr)_4.75rem_4.5rem] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.75rem_4.5rem]">
                    {content}
                  </Link>
                ) : (
                  <div className="grid min-h-[56px] min-w-0 grid-cols-[minmax(0,1fr)_4.75rem_4.5rem] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_4.75rem_4.5rem]">{content}</div>
                )}
              </li>
            );
          })}
          </ul>
        </>
      )}
    </Card>
  );
}

const PAYMENT_STATUS_TONES: Record<AnalyticsSettlementStatus, string> = {
  not_applicable: "text-[var(--muted)] before:bg-[#8b8b91]",
  pending: "text-[#8a5a10] before:bg-[#c78a22]",
  confirmed: "text-[#176342] before:bg-[#2e8a61]",
  completed: "text-[#176342] before:bg-[#2e8a61]",
  failed: "text-[#963b37] before:bg-[#c5221c]",
};

function PaymentStatusText({ status }: { status: AnalyticsSettlementStatus }) {
  const label = status === "not_applicable" ? "Free" : status[0].toUpperCase() + status.slice(1);
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${PAYMENT_STATUS_TONES[status]} before:h-1.5 before:w-1.5 before:rounded-full before:content-['']`}>{label}</span>;
}

const ARTICLE_STATE_TONES: Record<ArticleState, string> = {
  draft: "text-[var(--muted)] before:bg-[#8b8b91]",
  live: "text-[#176342] before:bg-[#2e8a61]",
  paused: "text-[#8a5a10] before:bg-[#c78a22]",
  archived: "text-[var(--muted)] before:bg-[#8b8b91]",
  deleted: "text-[#963b37] before:bg-[#c5221c]",
};

function ArticleStateText({ state }: { state: ArticleState }) {
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${ARTICLE_STATE_TONES[state]} before:h-1.5 before:w-1.5 before:rounded-full before:content-['']`}>{state[0].toUpperCase() + state.slice(1)}</span>;
}

function PayoutConnectionDialog({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: DashboardOverviewWallet }) {
  return (
    <DashboardDialog open={open} onClose={onClose} labelledBy="payout-connection-title" className="max-w-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5 sm:px-5">
        <h2 id="payout-connection-title" className="dashboard-panel-title">Payout connection</h2>
        <div className="flex items-center gap-3">
          <PayoutConnectionActions wallet={wallet} onClose={onClose} />
          <button type="button" onClick={onClose} className="dashboard-icon-button" aria-label="Close payout connection">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <PayoutConnectionDetails wallet={wallet} />
    </DashboardDialog>
  );
}

function PayoutConnectionActions({ wallet, onClose }: { wallet: DashboardOverviewWallet; onClose: () => void }) {
  if (!wallet.address) return null;
  return (
    <div className="flex items-center gap-3">
      {wallet.onWithdraw && (
        <button
          type="button"
          onClick={() => {
            onClose();
            wallet.onWithdraw?.();
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink)] hover:underline"
        >
          <ArrowRight size={14} aria-hidden="true" /> Withdraw
        </button>
      )}
      {wallet.onRefresh && (
        <button type="button" onClick={wallet.onRefresh} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline">
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      )}
    </div>
  );
}

function PayoutConnectionDetails({ wallet }: { wallet: DashboardOverviewWallet }) {
  if (!wallet.address) {
    return (
      <div className="p-5">
        <EmptyState
          icon={<Wallet2 size={22} aria-hidden="true" />}
          title="Payouts not set up yet"
          description="Set up the secure account your earnings land in. It takes one click — Rubicon handles the rest."
          action={<Link href={wallet.settingsHref ?? "/dashboard/settings#payout-connection"} className="button button-primary text-sm">Set up payouts</Link>}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 p-3 sm:p-4">
      <p className="px-1 text-xs text-[var(--muted)]">Withdrawable earnings are sent through your confirmed payout connection.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
          <div className="text-xs font-medium text-[var(--muted)]">Wallet address</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="mono text-sm font-medium">{wallet.addressLabel ?? shortWallet(wallet.address)}</span>
            {wallet.onCopy && <button type="button" onClick={wallet.onCopy} className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]" aria-label="Copy address"><Copy size={14} aria-hidden="true" /></button>}
            {wallet.copied && <span className="text-xs text-[var(--green)]">copied</span>}
          </div>
          {wallet.explorerHref && <a href={wallet.explorerHref} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline">View on {wallet.explorerLabel ?? "explorer"} <ExternalLink size={11} aria-hidden="true" /></a>}
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
          <div className="text-xs font-medium text-[var(--muted)]">Balance</div>
          <div className="mt-2 text-2xl font-semibold tracking-[-0.01em]">{wallet.balanceLabel ?? <span className="text-base font-normal text-[var(--muted)]">Loading...</span>}</div>
          {wallet.balanceError && <div className="mt-1 text-xs text-[var(--muted)]">{wallet.balanceError}</div>}
        </div>
      </div>
    </div>
  );
}

const PRESET_BACKGROUNDS = [
  { src: "/export-card-michele-1.jpeg", label: "Harbor" },
  { src: "/export-card-michele-2.jpg", label: "Orchard" },
  { src: "/export-card-michele-3.jpg", label: "Lakeside" },
  { src: "/export-card-michele-4.jpg", label: "Village path" },
  { src: "/export-card-painting.png", label: "Pond" },
];

const PRESET_THUMB_SIZE = 44;

function ExportButton({
  username,
  avatarUrl,
  totalEarned,
  wordsRead,
  agentReads,
  topArticle,
  trendBars,
}: DashboardOverviewExport) {
  const reduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "blocked">("idle");
  const [bgImage, setBgImage] = useState<string>("/export-card-michele-1.jpeg");
  const [customBgs, setCustomBgs] = useState<{ src: string; label: string }[]>([]);
  const [loadedPresets, setLoadedPresets] = useState<{ src: string; label: string }[]>([]);

  // check which preset images actually load
  useEffect(() => {
    const checkPresets = async () => {
      const results: { src: string; label: string }[] = [];
      for (const p of PRESET_BACKGROUNDS) {
        const img = await loadImage(p.src);
        if (img) results.push(p);
      }
      setLoadedPresets(results);
    };
    checkPresets();
  }, []);

  const allBackgrounds = [...loadedPresets, ...customBgs];

  useEffect(() => {
    let cancelled = false;
    setPngUrl(null);
    renderExportPng({
      username,
      avatarUrl,
      amount: formatUsdDisplay(totalEarned),
      reads: formatInt(agentReads),
      words: formatInt(wordsRead),
      topArticle: topArticle ?? "Not available yet",
      trendBars,
      bgImage,
    }).then((url) => {
      if (!cancelled) setPngUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [agentReads, avatarUrl, topArticle, totalEarned, trendBars, username, wordsRead, bgImage]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 18);
      setCustomBgs((prev) => {
        if (prev.some((b) => b.src === dataUrl)) return prev;
        return [...prev, { src: dataUrl, label }];
      });
      setBgImage(dataUrl);
      // reset so re-selecting the same file triggers again
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  }, []);

  const download = () => {
    if (!pngUrl) return;
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `rubicon-${username.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "writer"}-earnings.png`;
    link.click();
  };

  const copyImage = async () => {
    if (!pngUrl) return;
    try {
      if (!("ClipboardItem" in window) || !navigator.clipboard?.write) {
        throw new Error("Image clipboard is not available in this browser.");
      }
      const clipboard = ClipboardItem as typeof ClipboardItem & { supports?: (type: string) => boolean };
      if (clipboard.supports && !clipboard.supports("image/png")) {
        throw new Error("PNG clipboard writes are not supported in this browser.");
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": dataUrlToPngBlob(pngUrl) })]);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("blocked");
    }
    window.setTimeout(() => setCopyStatus("idle"), 2200);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="button button-secondary text-sm">
        <Download size={15} aria-hidden="true" /> Export card
      </button>

      <DashboardDialog open={open} onClose={() => setOpen(false)} labelledBy="export-card-title" className="max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 pb-3 pt-4">
              <div>
                <h2 id="export-card-title" className="text-base font-semibold">Export card</h2>
                <p className="dashboard-meta">X-ready PNG · 1080 × 1350</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="dashboard-icon-button"
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {allBackgrounds.length > 0 && (
              <div className="mx-5 rounded-xl bg-[var(--surface-muted)] px-3 py-3">
                <p className="mb-2 text-xs font-medium text-[var(--muted)]">Background</p>
                <div className="flex flex-wrap gap-2">
                  {allBackgrounds.map((bg) => (
                    <button
                      key={bg.src}
                      type="button"
                      onClick={() => setBgImage(bg.src)}
                      title={bg.label}
                      className={`relative overflow-hidden rounded-[var(--radius-ui)] border-2 transition-[border-color,transform] ${
                        bgImage === bg.src
                          ? "border-[var(--ink)]"
                          : "border-[var(--line)] hover:border-[var(--muted)]"
                      }`}
                      style={{ width: PRESET_THUMB_SIZE, height: PRESET_THUMB_SIZE }}
                    >
                      <img
                        src={bg.src}
                        alt={bg.label}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload custom image"
                    className="flex items-center justify-center rounded-[var(--radius-ui)] border border-dashed border-[var(--line)] text-[var(--muted)] transition-colors hover:border-[var(--muted)] hover:text-[var(--ink)]"
                    style={{ width: PRESET_THUMB_SIZE, height: PRESET_THUMB_SIZE }}
                  >
                    <ImagePlus size={17} aria-hidden="true" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    aria-label="Upload background image"
                  />
                </div>
              </div>
            )}

            <div className="p-5">
              <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-[18px] bg-[#eceef4]">
                {pngUrl ? (
                  <img
                    src={pngUrl}
                    alt={`${username} Rubicon earnings export card`}
                    className="block aspect-[4/5] h-auto w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="aspect-[4/5] animate-pulse bg-[var(--surface-muted)]" />
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" onClick={download} className="button button-primary justify-center text-sm" disabled={!pngUrl}>
                  <Download size={15} aria-hidden="true" /> Download
                </button>
                <motion.button
                  type="button"
                  onClick={copyImage}
                  className={`button export-copy-button justify-center text-sm ${copyStatus === "copied" ? "is-copied" : "button-secondary"}`}
                  disabled={!pngUrl}
                  animate={!reduceMotion && copyStatus === "copied" ? { transform: ["scale(1)", "scale(1.045)", "scale(1)"] } : { transform: "scale(1)" }}
                  transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                >
                  {copyStatus === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  <span aria-live="polite">{copyStatus === "copied" ? "Copied" : copyStatus === "blocked" ? "Copy blocked" : "Copy PNG"}</span>
                </motion.button>
              </div>
              {copyStatus === "blocked" && (
                <p className="mt-2 text-xs text-[var(--muted)]">This browser blocked image clipboard access. Use Download as a fallback.</p>
              )}
            </div>
      </DashboardDialog>
    </>
  );
}

/**
 * Renders the share card as "The Crossing" — a flat portrait poster split by a
 * single full-bleed rule. Above the line the chosen artwork runs edge to edge
 * (the writing); below it a dark typographic ledger records what agents paid.
 * The earnings figure straddles the rule, crossing from art into income — the
 * Rubicon moment the brand is named for.
 */
async function renderExportPng({
  username,
  avatarUrl,
  amount,
  reads,
  words,
  topArticle,
  trendBars,
  bgImage,
}: {
  username: string;
  avatarUrl: string | null;
  amount: string;
  reads: string;
  words: string;
  topArticle: string;
  trendBars: TrendBar[];
  bgImage: string;
}) {
  const W = 1080;
  const H = 1350;
  // Render at 2x so the exported PNG stays crisp on retina and when scaled up
  // on social. All drawing below uses logical (1x) coordinates.
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas?.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  const INK = "#0b0d12";
  const PAPER = "#ffffff";
  const MUTED = "rgba(11,13,18,0.55)";
  const QUIET = "rgba(11,13,18,0.34)";
  const HAIRLINE = "rgba(11,13,18,0.12)";
  const RIVER = "#7f9cd4";
  const GAIN = "#1f8f4e";

  // The dashboard's own faces (Hanken Grotesk / JetBrains Mono) carry into the
  // artifact; wait for them so the canvas doesn't rasterize a fallback.
  try {
    await document.fonts.ready;
  } catch {
    // fonts API unavailable — the fallback stacks below still render
  }
  const SANS = resolveCanvasFontStack("--font-sans", '"Helvetica Neue", Arial, sans-serif');
  const MONO = resolveCanvasFontStack("--font-mono", '"SFMono-Regular", Menlo, monospace');

  const [painting, logo, avatar] = await Promise.all([
    loadImage(bgImage),
    loadImage("/Header-logo_b.svg"),
    avatarUrl ? loadImage(avatarUrl) : Promise.resolve(null),
  ]);

  const MARGIN = 64;
  const RIGHT = W - MARGIN;
  const CROSSING = 620;

  // letterSpacing lands on the 2d context in modern browsers but isn't yet in
  // the TS DOM lib; cast so the source type-checks.
  const setSpacing = (v: string) => {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = v;
  };

  const monoLabel = (
    text: string,
    x: number,
    y: number,
    { align = "left" as CanvasTextAlign, color = MUTED, size = 13, tracking = "2.5px" } = {},
  ) => {
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    setSpacing(tracking);
    ctx.fillText(text, x, y);
    setSpacing("0px");
    ctx.textAlign = "left";
  };

  const hairline = (y: number) => {
    ctx.strokeStyle = HAIRLINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(RIGHT, y);
    ctx.stroke();
  };

  // ---- upper bank: the artwork, vivid and full-bleed ----------------------
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  if (painting) {
    drawCoverImage(ctx, painting, 0, 0, W, CROSSING);
  }

  // Keep a dark wash under the white top chrome for legibility.
  const chrome = ctx.createLinearGradient(0, 0, 0, 200);
  chrome.addColorStop(0, "rgba(6,9,14,0.55)");
  chrome.addColorStop(1, "rgba(6,9,14,0)");
  ctx.fillStyle = chrome;
  ctx.fillRect(0, 0, W, 200);

  // The source SVG has a roomy square artboard. Crop to its horizontal lockup
  // so the real white Rubicon mark sits cleanly in the top-left corner.
  if (logo) {
    // drawImage uses the SVG's intrinsic 2000px dimensions, not its 1500-unit
    // viewBox. These source coordinates account for that 4/3 scale.
    ctx.drawImage(logo, 110, 760, 1740, 470, MARGIN, 54, 210, 57);
  }
  monoLabel("PROOF OF PAID READS", RIGHT, 90, { align: "right", color: "rgba(255,255,255,0.85)" });

  // ---- lower bank: the ledger ----------------------------------------------
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, CROSSING, W, H - CROSSING);

  // The crossing itself — the only full-bleed rule on the card.
  ctx.strokeStyle = "rgba(11,13,18,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, CROSSING);
  ctx.lineTo(W, CROSSING);
  ctx.stroke();

  // ---- the figure, mid-crossing --------------------------------------------
  // Sized to fit the column and drawn last across both banks.
  setSpacing("-4px");
  let amountSize = 192;
  ctx.font = `800 ${amountSize}px ${SANS}`;
  while (amountSize > 96 && ctx.measureText(amount).width > RIGHT - MARGIN) {
    amountSize -= 8;
    ctx.font = `800 ${amountSize}px ${SANS}`;
  }
  ctx.fillStyle = INK;
  ctx.fillText(amount, MARGIN - 4, CROSSING + 96);
  setSpacing("0px");

  // Positive growth is useful proof; negative growth is intentionally omitted
  // from a share artifact rather than turning it into a dashboard report.
  const delta = computeTrendDelta(trendBars.map((bar) => bar.value));
  const captionY = CROSSING + 152;
  monoLabel("EARNED FROM AGENT READS", MARGIN, captionY, { size: 15 });
  if (delta.up && delta.label.startsWith("+")) {
    ctx.font = `700 15px ${MONO}`;
    setSpacing("2.5px");
    const captionW = ctx.measureText("EARNED FROM AGENT READS").width;
    setSpacing("0px");
    monoLabel(`${delta.label} VS PRIOR WEEK`, MARGIN + captionW + 28, captionY, { size: 15, color: GAIN });
  }

  // ---- ruled ledger rows ----------------------------------------------------
  const rows = [
    { label: "AGENT READS", value: reads, size: 32 },
    { label: "PAID WORDS", value: words, size: 32 },
    { label: "TOP PAID ARTICLE", value: topArticle, size: 26 },
  ];
  const ledgerTop = 838;
  const rowH = 72;
  rows.forEach((row, i) => {
    const top = ledgerTop + i * rowH;
    hairline(top);
    monoLabel(row.label, MARGIN, top + 45);
    ctx.font = `600 ${row.size}px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(truncateForCanvas(ctx, row.value, RIGHT - MARGIN - 260), RIGHT, top + 46);
    ctx.textAlign = "left";
  });
  hairline(ledgerTop + rows.length * rowH);

  // ---- 14-day strip ---------------------------------------------------------
  const stripLabelY = 1102;
  monoLabel("EARNINGS ACTIVITY", MARGIN, stripLabelY, { color: QUIET });
  monoLabel("LAST 14 DAYS", RIGHT, stripLabelY, { align: "right", color: QUIET });
  drawEarningsStrip(ctx, MARGIN, 1126, RIGHT - MARGIN, 78, trendBars, {
    paid: RIVER,
    peak: INK,
    rest: "rgba(11,13,18,0.22)",
    baseline: HAIRLINE,
    labels: QUIET,
    mono: MONO,
  });

  // ---- signature ------------------------------------------------------------
  const avatarSize = 44;
  const avatarY = 1258;
  const footBaseline = avatarY + 29;
  ctx.save();
  ctx.beginPath();
  ctx.arc(MARGIN + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    drawCoverImage(ctx, avatar, MARGIN, avatarY, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = INK;
    ctx.fillRect(MARGIN, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = PAPER;
    ctx.font = `700 18px ${SANS}`;
    ctx.textAlign = "center";
    ctx.fillText(username.replace(/^@/, "").slice(0, 1).toUpperCase(), MARGIN + avatarSize / 2, avatarY + 29);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(11,13,18,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(MARGIN + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 - 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `700 21px ${SANS}`;
  ctx.fillText(username, MARGIN + avatarSize + 16, footBaseline);

  // bottom-right: creator-first Rubicon attribution
  const lead = "Creating on ";
  ctx.font = `500 18px ${SANS}`;
  const leadW = ctx.measureText(lead).width;
  ctx.font = `700 18px ${SANS}`;
  const brandW = ctx.measureText("Rubicon").width;
  const attributionX = RIGHT - leadW - brandW;
  ctx.fillStyle = MUTED;
  ctx.font = `500 18px ${SANS}`;
  ctx.fillText(lead, attributionX, footBaseline);
  ctx.fillStyle = INK;
  ctx.font = `700 18px ${SANS}`;
  ctx.fillText("Rubicon", attributionX + leadW, footBaseline);

  return canvas.toDataURL("image/png");
}

/**
 * Resolves a next/font CSS variable (its hashed family names) into a stack the
 * canvas 2d context can use, falling back when the variable isn't available.
 */
function resolveCanvasFontStack(cssVar: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const families = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return families ? `${families}, ${fallback}` : fallback;
}

/**
 * The 14-day trend as a scan strip: one thin stroke per day rising from a
 * shared baseline — days agents paid read like marks on a scanned code, quiet
 * days stay as countable notches, and the best day is picked out in white.
 */
function drawEarningsStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  bars: TrendBar[],
  colors: { paid: string; peak: string; rest: string; baseline: string; labels: string; mono: string },
) {
  const data = normalizeFourteenBars(bars);
  const max = Math.max(...data.map((bar) => bar.value), 0);
  const peak = data.reduce((best, bar, i) => (bar.value > data[best].value ? i : best), 0);
  const baseY = y + height;
  const slot = width / data.length;
  const strokeW = 7;

  data.forEach((bar, i) => {
    const bx = x + i * slot + (slot - strokeW) / 2;
    if (bar.value <= 0 || max <= 0) {
      ctx.fillStyle = colors.rest;
      ctx.fillRect(bx, baseY - 5, strokeW, 5);
      return;
    }
    const strokeH = Math.max(10, (bar.value / max) * height);
    ctx.fillStyle = i === peak ? colors.peak : colors.paid;
    roundRect(ctx, bx, baseY - strokeH, strokeW, strokeH, 3);
    ctx.fill();
  });

  ctx.strokeStyle = colors.baseline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, baseY + 2);
  ctx.lineTo(x + width, baseY + 2);
  ctx.stroke();

  ctx.fillStyle = colors.labels;
  ctx.font = `700 12px ${colors.mono}`;
  ctx.fillText(data[0]?.label ?? "", x, baseY + 28);
  ctx.textAlign = "right";
  ctx.fillText(data[data.length - 1]?.label ?? "", x + width, baseY + 28);
  ctx.textAlign = "left";
}

function normalizeFourteenBars(bars: TrendBar[]): TrendBar[] {
  const fallback = Array.from({ length: 14 }, (_, index) => ({
    label: index === 0 ? "14d" : index === 13 ? "Now" : "",
    fullLabel: "",
    value: 0,
  }));
  if (bars.length === 0) return fallback;
  if (bars.length >= 14) return bars.slice(bars.length - 14);
  return [...fallback.slice(0, 14 - bars.length), ...bars];
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceW = width / scale;
  const sourceH = height / scale;
  const sourceX = (image.width - sourceW) / 2;
  const sourceY = (image.height - sourceH) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceW, sourceH, x, y, width, height);
}

/**
 * Derives a green "gain" figure from the 14-day trend by comparing the recent
 * half against the earlier half. Falls back to "New" when there's no baseline.
 */
function computeTrendDelta(values: number[]): { label: string; up: boolean } {
  if (values.length === 0) return { label: "New", up: true };
  const half = Math.floor(values.length / 2) || 1;
  const prev = values.slice(0, half).reduce((a, b) => a + b, 0);
  const cur = values.slice(half).reduce((a, b) => a + b, 0);
  if (prev <= 0) return { label: cur > 0 ? "New" : "—", up: cur > 0 };
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10;
  return pct > 0 ? { label: `+${pct.toFixed(1)}%`, up: true } : { label: `${pct.toFixed(1)}%`, up: false };
}

function truncateForCanvas(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let next = text;
  while (next.length > 0 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function dataUrlToPngBlob(dataUrl: string) {
  const [, base64 = ""] = dataUrl.split(",");
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/png" });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2" aria-label="Recent activity">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--green)] opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--green)]" />
    </span>
  );
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString();
}
