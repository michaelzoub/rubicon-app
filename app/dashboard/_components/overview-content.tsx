"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  ImagePlus,
  RefreshCw,
  ShieldCheck,
  Wallet2,
  X,
} from "lucide-react";
import type { ArticleState, PaymentStatus } from "@/lib/rubicon/types";
import { formatUsdDisplay } from "@/lib/rubicon/pricing";
import { RubiconBrand } from "../../_components/rubicon-brand";
import { CountUp, Donut, InsightTile, Reveal, Sparkline, TrendChart, type DonutSlice, type TrendBar } from "./charts";
import {
  ArticleStatePill,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PaymentStatusPill,
  RefreshDots,
  Skeleton,
  shortWallet,
  StatTile,
} from "./ui";

export interface DashboardOverviewStat {
  label: string;
  value: number;
  format: (value: number) => string;
  deltaPct?: number | null;
  sparklineValues?: number[];
  sparklineLabels?: string[];
  sparklineMetricLabel?: string;
  sparklineDetails?: string[];
}

export interface DashboardOverviewPaymentRow {
  id: string;
  title: string;
  meta: string;
  amount: string;
  status: PaymentStatus;
}

export interface DashboardOverviewArticleRow {
  id: string;
  title: string;
  meta: string;
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

export interface DashboardActivityDay {
  date: string;
  count: number;
}

export interface DashboardOverviewProps {
  greeting: string;
  exportData?: DashboardOverviewExport;
  activityCalendar: DashboardActivityDay[];
  stats: DashboardOverviewStat[];
  trendBars: TrendBar[];
  topArticles?: Array<{
    id?: string;
    title: string;
    earnings: string;
    href?: string;
  }>;
  breakdown?: {
    avgPerRead: number;
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
  greeting,
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
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Overview"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {refreshing && <RefreshDots />}
            <ContentProtectionPolicy />
            {exportData && <ExportButton {...exportData} />}
          </div>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="grid min-w-0 gap-3">
          <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map((stat, index) => (
              <Reveal
                key={stat.label}
                delay={index * 0.035}
                className="relative h-full hover:z-50 focus-within:z-50"
              >
                <StatTile
                  label={stat.label}
                  value={<CountUp value={stat.value} format={stat.format} />}
                  hint={stat.deltaPct !== undefined ? <DeltaHint pct={stat.deltaPct} /> : undefined}
                  sparkline={stat.sparklineValues && stat.sparklineValues.length > 1 ? (
                    <Sparkline
                      values={stat.sparklineValues}
                      labels={stat.sparklineLabels}
                      metricLabel={stat.sparklineMetricLabel ?? stat.label}
                      details={stat.sparklineDetails}
                      formatValue={stat.format}
                      height={32}
                    />
                  ) : undefined}
                />
              </Reveal>
            ))}
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,1fr)]">
            <Reveal delay={0.08} className="relative h-full hover:z-50 focus-within:z-50">
              <MoneyActivityChart bars={exportData?.trendBars ?? trendBars} />
            </Reveal>

            {topArticles.length > 0 && (
              <Reveal delay={0.1} className="h-full">
                <TopArticlesRanking articles={topArticles} />
              </Reveal>
            )}
          </div>

          {breakdown && breakdown.slices.length > 0 && (
            <Reveal delay={0.12}>
              <Card className="p-3.5">
                <div>
                  <h2 className="text-base font-semibold">Earnings breakdown</h2>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)]">
                  <InsightTile value={<CountUp value={breakdown.avgPerRead} format={formatUsdDisplay} />} caption="Average earned per agent read" />
                  <div className="flex min-w-0 items-center overflow-hidden rounded-lg border border-[var(--line)] bg-white p-3.5">
                    <Donut slices={breakdown.slices} centerValue={breakdown.totalEarned} centerLabel="Total earned" showCenter={false} size={142} stroke={18} />
                  </div>
                </div>
              </Card>
            </Reveal>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <PaymentActivityRows rows={paymentRows} />
            <ArticleRows rows={articleRows} />
          </div>
        </div>

        <aside className="grid h-fit gap-3 xl:sticky xl:top-5">
          <WalletCard wallet={wallet} />
        </aside>
      </div>
    </div>
  );
}

/** A deliberately simple loading shimmer — a few calm placeholder blocks that
    echo the dashboard's shape (stat row, two content cards, two lists, wallet)
    without trying to pixel-match it. No rigid min-width tracks, so it can't
    overflow, and generous spacing keeps it from feeling cramped. */
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

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        {/* main column */}
        <div className="grid min-w-0 gap-3">
          {/* stat tiles */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="grid min-h-[108px] content-between gap-6 p-4">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-7 w-28" />
              </Card>
            ))}
          </div>

          {/* chart + secondary */}
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            <Card className="min-h-[13rem] p-4">
              <Skeleton className="h-4 w-36" />
              <div className="mt-6 flex h-[9rem] items-end gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="flex-1" rounded="rounded" />
                ))}
              </div>
            </Card>
            <Card className="min-h-[13rem] p-4">
              <Skeleton className="h-4 w-28" />
              <div className="mt-6 grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" rounded="rounded-lg" />
                ))}
              </div>
            </Card>
          </div>

          {/* list cards */}
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

        {/* wallet sidebar */}
        <aside className="min-w-0">
          <Card className="p-4">
            <Skeleton className="h-4 w-32" />
            <div className="mt-5 grid gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" rounded="rounded-lg" />
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function TopArticlesRanking({ articles }: { articles: NonNullable<DashboardOverviewProps["topArticles"]> }) {
  return (
    <Card className="flex h-full min-h-[13rem] flex-col overflow-hidden p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Top articles</h2>
        <span className="text-[0.68rem] text-[var(--muted)]">Ranked by earnings</span>
      </div>
      <ul className="mt-2 flex flex-1 flex-col justify-center">
        {articles.slice(0, 3).map((article, rank) => {
          const leader = rank === 0;
          const row = (
            <>
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.68rem] font-semibold tabular-nums ${
                  leader ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-muted)] text-[var(--muted)]"
                }`}
              >
                {rank + 1}
              </span>
              <span className={`min-w-0 flex-1 truncate text-sm ${leader ? "font-semibold" : "font-medium"}`}>
                {article.title}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{article.earnings}</span>
            </>
          );
          const rowClassName = "flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-muted)]";
          return (
            <li key={article.id ?? article.title} className="min-w-0 border-t border-[var(--line)] first:border-t-0">
              {article.href ? (
                <Link href={article.href} className={rowClassName}>
                  {row}
                </Link>
              ) : (
                <div className={rowClassName}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MoneyActivityChart({ bars }: { bars: TrendBar[] }) {
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const paidDays = bars.filter((bar) => bar.value > 0).length;
  return (
    <Card className="flex h-full min-h-[13rem] flex-col p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Earnings activity</h2>
          <p className="text-xs text-[var(--muted)]">Daily earnings from agent reads</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{formatUsdDisplay(total)}</div>
          <div className="text-[0.68rem] text-[var(--muted)]">{paidDays} paid days</div>
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1">
        <TrendChart bars={bars} formatValue={formatUsdDisplay} height={132} />
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
  return (
    <div className="group relative">
      <button type="button" className="button button-secondary text-sm">
        <ShieldCheck size={15} aria-hidden="true" /> Content Protection Policy
      </button>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(27rem,calc(100vw-2rem))] translate-y-1 rounded-[10px] bg-white p-4 text-left opacity-0 transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
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
      </div>
    </div>
  );
}

function PaymentActivityRows({ rows }: { rows: DashboardOverviewPaymentRow[] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
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
        <ul className="grid gap-1 px-2 pb-2">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex min-w-0 items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-muted)]">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.title}</div>
                <div className="truncate text-xs text-[var(--muted)]">{row.meta}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-semibold">{row.amount}</span>
                <PaymentStatusPill status={row.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArticleRows({ rows }: { rows: DashboardOverviewArticleRow[] }) {
  return (
    <Card>
      <CardHeader
        title="Your articles"
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
        <ul className="grid gap-1 px-2 pb-2">
          {rows.slice(0, 4).map((row) => {
            const content = (
              <>
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.title}</div>
                  <div className="truncate text-xs text-[var(--muted)]">{row.meta}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold">{row.earnings}</span>
                  <ArticleStatePill state={row.state} />
                </div>
              </>
            );
            return (
              <li key={row.id} className="min-w-0">
                {row.href ? (
                  <Link href={row.href} className="flex min-w-0 flex-col gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-w-0 flex-col gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-muted)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function WalletCard({ wallet }: { wallet: DashboardOverviewWallet }) {
  return (
    <Card>
      <CardHeader
        title="Payout connection"
        action={
          wallet.address ? (
            <div className="flex items-center gap-4">
              {wallet.onWithdraw && (
                <button type="button" onClick={wallet.onWithdraw} className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink)] hover:underline">
                  <ArrowRight size={14} aria-hidden="true" /> Withdraw
                </button>
              )}
              {wallet.onRefresh && (
                <button type="button" onClick={wallet.onRefresh} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline">
                  <RefreshCw size={14} aria-hidden="true" /> Refresh
                </button>
              )}
            </div>
          ) : undefined
        }
      />
      {!wallet.address ? (
        <div className="p-5">
          <EmptyState
            icon={<Wallet2 size={22} aria-hidden="true" />}
            title="Payouts not set up yet"
            description="Set up the secure account your earnings land in. It takes one click — Rubicon handles the rest."
            action={
              <Link href={wallet.settingsHref ?? "/dashboard/settings#payout-connection"} className="button button-primary text-sm">
                Set up payouts
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-2.5 p-3">
          <p className="px-2 text-xs text-[var(--muted)]">Withdrawable earnings are sent through your confirmed payout connection.</p>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
              <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Wallet address</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="mono text-sm font-medium">{wallet.addressLabel ?? shortWallet(wallet.address)}</span>
                {wallet.onCopy && (
                  <button type="button" onClick={wallet.onCopy} className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]" aria-label="Copy address">
                    <Copy size={14} aria-hidden="true" />
                  </button>
                )}
                {wallet.copied && <span className="text-xs text-[var(--green)]">copied</span>}
              </div>
              {wallet.explorerHref && (
                <a
                  href={wallet.explorerHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:underline"
                >
                  View on {wallet.explorerLabel ?? "explorer"} <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
              <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Network</div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                <Link2 size={14} className="text-[var(--muted)]" aria-hidden="true" /> {wallet.networkName ?? "Not connected"}
              </div>
              {wallet.chainId && <div className="mt-2 text-xs text-[var(--muted)]">Chain ID {wallet.chainId}</div>}
            </div>

            <div className="rounded-lg border border-[var(--line)] bg-white p-3.5">
              <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Balance</div>
              <div className="mt-2 text-2xl font-semibold tracking-[-0.01em]">{wallet.balanceLabel ?? <span className="text-base font-normal text-[var(--muted)]">Loading...</span>}</div>
              {wallet.balanceError && <div className="mt-1 text-xs text-[var(--muted)]">{wallet.balanceError}</div>}
            </div>
          </div>
        </div>
      )}
    </Card>
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
  const [celebrationKey, setCelebrationKey] = useState(0);
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
      setCelebrationKey((key) => key + 1);
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

      <AnimatePresence>
        {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Export card"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
        >
          <motion.div
            className="relative w-full max-w-md overflow-hidden rounded-[var(--radius-lg)] bg-white"
            onClick={(e) => e.stopPropagation()}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.97)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px) scale(0.985)" }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            <AnimatePresence>{copyStatus === "copied" && <CopyCelebration key={celebrationKey} />}</AnimatePresence>
            <div className="flex items-center justify-between border-b border-[var(--faint)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Export card</h2>
                <p className="text-xs text-[var(--muted)]">X-ready PNG · 1080 × 1350</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                aria-label="Close"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {allBackgrounds.length > 0 && (
              <div className="border-b border-[var(--faint)] px-5 py-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.6px] text-[var(--muted)]">Background</p>
                <div className="flex flex-wrap gap-2">
                  {allBackgrounds.map((bg) => (
                    <button
                      key={bg.src}
                      type="button"
                      onClick={() => setBgImage(bg.src)}
                      title={bg.label}
                      className={`relative overflow-hidden rounded-[var(--radius-ui)] transition-all ${
                        bgImage === bg.src
                          ? "ring-2 ring-[var(--ink)] ring-offset-1"
                          : "ring-1 ring-[var(--line)] hover:ring-[var(--muted)]"
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
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const CONFETTI = [
  [-150, -250, -38, "#246bfd"], [-112, -292, 42, "#18181b"], [-72, -235, -76, "#62c79b"],
  [-36, -320, 88, "#f0b64d"], [0, -260, -28, "#246bfd"], [34, -305, 64, "#e46d67"],
  [70, -242, -54, "#18181b"], [108, -286, 36, "#62c79b"], [148, -252, -82, "#f0b64d"],
  [-132, -190, 70, "#e46d67"], [-88, -214, -44, "#246bfd"], [-48, -178, 92, "#62c79b"],
  [46, -196, -62, "#f0b64d"], [88, -218, 52, "#e46d67"], [130, -188, -96, "#246bfd"],
] as const;

function CopyCelebration() {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
      {CONFETTI.map(([x, y, rotate, color], index) => (
        <motion.span
          key={`${x}-${y}`}
          className="absolute bottom-[62px] left-1/2 h-2.5 w-1.5 rounded-[2px]"
          style={{ background: color }}
          initial={{ opacity: 0, transform: "translate(-50%, 0) rotate(0deg) scale(0.92)" }}
          animate={{
            opacity: [0, 1, 1, 0],
            transform: [
              "translate(-50%, 0) rotate(0deg) scale(0.92)",
              `translate(calc(-50% + ${x * 0.45}px), ${y * 0.58}px) rotate(${rotate * 0.45}deg) scale(1)`,
              `translate(calc(-50% + ${x}px), ${y}px) rotate(${rotate}deg) scale(0.96)`,
              `translate(calc(-50% + ${x * 1.08}px), ${y + 72}px) rotate(${rotate + 80}deg) scale(0.9)`,
            ],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.78, delay: index * 0.018, ease: [0.23, 1, 0.32, 1] }}
        />
      ))}
    </div>
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

function DeltaHint({ pct, onDark = false }: { pct: number | null; onDark?: boolean }) {
  if (pct === null) return null;
  if (Math.abs(pct) < 1) {
    return <span className="inline-flex rounded-full bg-[var(--surface-muted)] px-2.5 py-1 font-medium text-[var(--muted)]">Flat vs last week</span>;
  }
  const up = pct > 0;
  const color = up
    ? onDark
      ? "bg-white/10 text-[var(--gain-on-dark)]"
      : "bg-[#e8f6ef] text-[var(--gain)]"
    : onDark
      ? "bg-white/10 text-[var(--loss-on-dark)]"
      : "bg-[#fde8e6] text-[var(--loss)]";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 font-medium ${color}`}>
      {up ? "+" : "−"}
      {Math.abs(Math.round(pct))}% vs last week
    </span>
  );
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
