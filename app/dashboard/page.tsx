"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useRubiconQuery, type QueryResult } from "@/lib/rubicon/hooks";
import { atomicToUsd, formatUsdAtomicDisplay, formatUsdDisplay, formatUsdNumber } from "@/lib/rubicon/pricing";
import type { Article, PaymentActivity } from "@/lib/rubicon/types";
import { ACTIVE_CHAIN } from "@/lib/chain";
import { explorerAddressUrl, formatBalance, useNativeBalance } from "@/lib/onchain";
import { WithdrawDialog } from "./_components/withdraw-dialog";
import { CountUp, Donut, DONUT_COLORS, InsightTile, Reveal, type DonutSlice, type TrendBar } from "./_components/charts";
import { ContentProtectionPolicy, DashboardOverviewContent, OverviewSkeleton, type DashboardOverviewProps } from "./_components/overview-content";
import { SubstackOnboardingDialog } from "./_components/substack-onboarding-dialog";
import {
  ArticleStatePill,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  formatRelative,
  PageHeader,
  PaymentStatusPill,
  PrimaryLink,
  RefreshDots,
  shortWallet,
  Skeleton,
  StatTile,
} from "./_components/ui";

export default function OverviewPage() {
  const forceNewUser = usePathname() === "/dashboard-newuser";
  const { user } = usePrivy();
  const articles = useRubiconQuery((c) => c.listArticles(), [], { queryKey: ["articles"] });
  const wallet = useRubiconQuery((c) => c.getWallet(), [], { queryKey: ["wallet"] });
  const earnings = useRubiconQuery((c) => c.getEarnings(), [], { queryKey: ["earnings"] });
  const activity = useRubiconQuery((c) => c.getPaymentActivity(), [], { queryKey: ["payment-activity"] });

  // Distinguish the first paint (no data yet → skeleton layout) from a
  // background refresh (existing data stays visible with a tiny indicator).
  const initialLoading = [articles, wallet, earnings].some((q) => q.status === "loading" && !q.data);
  const refreshing =
    !initialLoading &&
    [articles, wallet, earnings, activity].some((q) => q.status === "loading" && q.data);
  const firstError = [articles, wallet, earnings].find((q) => q.status === "error" && !q.data);

  const greeting = user?.twitter?.username ? `@${user.twitter.username}` : user?.email?.address ?? "writer";

  const walletConnected = Boolean(wallet.data?.address);
  const hasArticles = (articles.data?.length ?? 0) > 0;
  const hasPricedArticle = (articles.data ?? []).some((a) => Number(a.pricePerWordAtomic) > 0);
  const hasLive = (articles.data ?? []).some((a) => a.state === "live");
  const onboardingComplete = !forceNewUser && walletConnected && hasLive && hasPricedArticle;

  const trendBars = useMemo(
    () => buildTrend(activity.data ?? [], "earnings"),
    [activity.data],
  );
  const earningsSlices = useMemo(() => buildEarningsSlices(articles.data ?? []), [articles.data]);
  const hasBreakdown = earningsSlices.length > 0;

  const avgPerRead =
    (earnings.data?.agentReads ?? 0) > 0
      ? atomicToUsd(earnings.data?.settledEarnings) / (earnings.data?.agentReads ?? 1)
      : 0;
  const totalEarned = atomicToUsd(earnings.data?.settledEarnings);

  const weeklyDeltas = useMemo(() => buildWeeklyDeltas(activity.data ?? []), [activity.data]);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const nativeBalance = useNativeBalance(wallet.data?.address ?? null);

  const overviewProps: DashboardOverviewProps | null = useMemo(() => {
    if (!onboardingComplete || !earnings.data || !wallet.data) return null;
    const articleList = articles.data ?? [];
    const paymentRows = (activity.data ?? []).slice(0, 5).map((row) => ({
      id: row.id,
      title: row.articleTitle,
      meta: `${formatRelative(row.date)} · ${row.wordsRead.toLocaleString()} words read`,
      amount: formatUsdAtomicDisplay(row.creatorAmount),
      status: row.status,
    }));
    const articleRows = articleList.slice(0, 4).map((article) => ({
      id: article.id,
      title: article.title,
      meta: `${article.usage.wordsRead.toLocaleString()} words read`,
      earnings: formatUsdAtomicDisplay(article.usage.earnings),
      state: article.state,
      href: `/dashboard/articles/${article.id}`,
    }));
    const balanceLabel =
      nativeBalance.status === "loading" ? (
        <span className="text-base font-normal text-[var(--muted)]">Loading...</span>
      ) : nativeBalance.status === "error" ? (
        <span className="text-base font-normal text-[#8d2f2d]">Unavailable</span>
      ) : (
        <>
          {formatBalance(nativeBalance.value)}
          <span className="ml-1.5 text-sm font-medium text-[var(--muted)]">{nativeBalance.symbol}</span>
        </>
      );

    return {
      greeting,
      exportData: {
        username: greeting,
        avatarUrl: user?.twitter?.profilePictureUrl ?? null,
        totalEarned,
        wordsRead: earnings.data.wordsPaidFor ?? 0,
        agentReads: earnings.data.agentReads ?? 0,
        topArticle: earnings.data.topArticle?.title ?? null,
        trendBars,
      },
      activityCalendar: buildActivityCalendar(activity.data ?? []),
      stats: [
        { label: "Total earnings", value: totalEarned, format: formatUsdDisplay, deltaPct: weeklyDeltas.earnings },
        { label: "Words read", value: earnings.data.wordsPaidFor ?? 0, format: formatInt, deltaPct: weeklyDeltas.words },
        { label: "Live articles", value: earnings.data.liveArticles ?? 0, format: formatInt },
      ],
      trendBars,
      topArticles: [...articleList]
        .sort((a, b) => Number(b.usage.earnings) - Number(a.usage.earnings))
        .slice(0, 3)
        .map((article) => ({
          id: article.id,
          title: article.title,
          earnings: formatUsdAtomicDisplay(article.usage.earnings),
          href: `/dashboard/articles/${article.id}`,
        })),
      breakdown: earningsSlices.length > 0
        ? {
            avgPerRead,
            totalEarned: formatUsdAtomicDisplay(earnings.data.settledEarnings),
            slices: earningsSlices,
          }
        : null,
      paymentRows,
      articleRows,
      wallet: {
        address: wallet.data.address ?? null,
        explorerHref: wallet.data.address ? explorerAddressUrl(wallet.data.address) : undefined,
        explorerLabel: ACTIVE_CHAIN.blockExplorers?.default.name ?? "explorer",
        networkName: ACTIVE_CHAIN.name,
        chainId: ACTIVE_CHAIN.id,
        balanceLabel,
        balanceError: nativeBalance.status === "error" ? "Could not reach the RPC. Try Refresh." : undefined,
      },
    };
  }, [
    activity.data,
    articles.data,
    avgPerRead,
    earnings.data,
    earningsSlices,
    greeting,
    nativeBalance.status,
    nativeBalance.symbol,
    nativeBalance.value,
    onboardingComplete,
    totalEarned,
    trendBars,
    user?.twitter?.profilePictureUrl,
    wallet.data,
    weeklyDeltas.earnings,
    weeklyDeltas.words,
  ]);

  const copyWallet = async () => {
    if (!wallet.data?.address) return;
    await navigator.clipboard.writeText(wallet.data.address);
    setCopiedWallet(true);
    window.setTimeout(() => setCopiedWallet(false), 1400);
  };

  return (
    <div className="grid gap-5">
      {initialLoading ? (
        <OverviewSkeleton />
      ) : firstError && firstError.error ? (
        <ErrorState
          error={firstError.error}
          onRetry={() => {
            articles.refetch();
            wallet.refetch();
            earnings.refetch();
            activity.refetch();
          }}
        />
      ) : (
        <>
          {!onboardingComplete && (
            <>
              <PageHeader
                title="Overview"
                description={`Welcome back, ${greeting}.`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <ContentProtectionPolicy />
                    {refreshing && <RefreshDots />}
                  </div>
                }
              />
              <SubstackOnboardingDialog forceOpen={forceNewUser} shouldOpen={forceNewUser || (!hasArticles && !walletConnected)} />
              <OnboardingChecklistCard
                articles={forceNewUser ? [] : articles.data ?? []}
                walletConnected={forceNewUser ? false : walletConnected}
              />
              <OnchainCard address={forceNewUser ? null : wallet.data?.address ?? null} />
              <PaymentActivityCard activity={forceNewUser ? { status: "success", data: [], error: null, refetch: () => {} } : activity} />
              <ArticlesCard articles={forceNewUser ? [] : articles.data ?? []} hasArticles={forceNewUser ? false : hasArticles} />
            </>
          )}

          {onboardingComplete && overviewProps && (
            <>
              {wallet.data?.address && (
                <WithdrawDialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} walletAddress={wallet.data.address} />
              )}
              <DashboardOverviewContent
                {...overviewProps}
                refreshing={refreshing}
                wallet={{
                  ...overviewProps.wallet,
                  onCopy: copyWallet,
                  copied: copiedWallet,
                  onWithdraw: () => setWithdrawOpen(true),
                  onRefresh: () => nativeBalance.refetch(),
                }}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

const ONBOARDING_DISMISSED_KEY = "rubicon-onboarding-dismissed";

interface OnboardingStep {
  title: string;
  description: string;
  complete: boolean;
  actions: Array<{ label: string; href: string }>;
}

function OnboardingChecklistCard({
  articles,
  walletConnected,
}: {
  articles: Article[];
  walletConnected: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1");
  }, []);

  const hasArticles = articles.length > 0;
  const hasPricedArticle = articles.some((article) => Number(article.pricePerWordAtomic) > 0);
  const hasLive = articles.some((article) => article.state === "live");
  const hasSections = articles.some((article) => article.sections.length > 0);
  const firstArticleHref = hasArticles ? `/dashboard/articles/${articles.find((article) => article.state !== "live")?.id ?? articles[0].id}` : "/dashboard/articles/new";

  // The first task is an OR — import a whole Substack archive *or* add one
  // article — so it's a single step with two entry points, not steps 1 and 2.
  const steps: OnboardingStep[] = [
    {
      title: "Add your first article",
      description: "Import your Substack archive, or add a single article to start.",
      complete: hasArticles,
      actions: [
        { label: "Import Substack", href: "/dashboard/import/substack" },
        { label: "Add article", href: "/dashboard/articles/new" },
      ],
    },
    { title: "Review the sections", description: "Check the structure agents use to find relevant passages.", complete: hasSections, actions: [{ label: "Review sections", href: firstArticleHref }] },
    { title: "Choose a price per word", description: "Set the rate agents pay for delivered words.", complete: hasPricedArticle, actions: [{ label: "Set pricing", href: firstArticleHref }] },
    { title: "Finish creator settings", description: "Confirm the account used for payouts.", complete: walletConnected, actions: [{ label: "Open settings", href: "/dashboard/settings" }] },
    { title: "Publish", description: "Make the reviewed article available to agents.", complete: hasLive, actions: [{ label: "Review and publish", href: firstArticleHref }] },
    { title: "Track reads and earnings", description: "See paid interactions after your article is live.", complete: false, actions: [{ label: "View earnings", href: "/dashboard/earnings" }] },
  ];
  const activeIndex = Math.max(0, steps.findIndex((step) => !step.complete));

  if (dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted)]">Creator setup</p><h2 className="mt-1 text-lg font-semibold">Publish your first agent-readable article</h2></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm tabular-nums text-[var(--muted)]">{Math.min(activeIndex + 1, steps.length)} / {steps.length}</span>
          <button type="button" onClick={dismiss} className="text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]">Skip setup</button>
        </div>
      </div>
      <ol className="mt-5 grid gap-1">
        {steps.map((step, index) => {
          const isComplete = step.complete;
          const isActive = index === activeIndex;
          const marker = (
            <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${isComplete ? "border-[#9bcab4] bg-[#edf8f2] text-[#165c3e]" : isActive ? "border-[var(--river-deep)] bg-white text-[var(--river-deep)]" : "border-[var(--line)] text-[var(--muted)]"}`}>
              {isComplete ? <Check size={14} aria-hidden="true" /> : index + 1}
            </span>
          );
          const label = (
            <span className="min-w-0 flex-1"><span className={`block text-sm font-medium ${!isActive && !isComplete ? "text-[var(--muted)]" : ""}`}>{step.title}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{step.description}</span></span>
          );

          // Single-action steps stay one big clickable row. The first step has
          // two entry points, so it can't be one <Link> — show both as buttons.
          if (step.actions.length === 1) {
            const action = step.actions[0];
            return (
              <li key={step.title}>
                <Link href={action.href} className={`group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${isActive ? "bg-[var(--surface-muted)]" : "hover:bg-[var(--surface-muted)]"}`}>
                  {marker}
                  {label}
                  <span className={`hidden items-center gap-1 text-xs font-medium sm:inline-flex ${isActive ? "text-[var(--river-deep)]" : "text-[var(--muted)] group-hover:text-[var(--ink)]"}`}>{action.label} <ArrowRight size={13} /></span>
                </Link>
              </li>
            );
          }

          return (
            <li key={step.title}>
              <div className={`flex flex-col gap-3 rounded-lg px-3 py-3 sm:flex-row sm:items-center ${isActive ? "bg-[var(--surface-muted)]" : ""}`}>
                <div className="flex items-center gap-3">{marker}{label}</div>
                <div className="flex shrink-0 flex-wrap gap-2 pl-10 sm:pl-0">
                  {step.actions.map((action, actionIndex) => (
                    <Link key={action.href} href={action.href} className={`text-sm ${actionIndex === 0 ? "button button-primary" : "button button-secondary"}`}>
                      {action.label} <ArrowRight size={13} />
                    </Link>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function PaymentActivityCard({ activity }: { activity: QueryResult<PaymentActivity[]> }) {
  const rows = activity.status === "success" ? activity.data ?? [] : [];
  const isLive = rows.some(
    (row) => row.status !== "failed" && Date.now() - new Date(row.date).getTime() < 48 * 3_600_000,
  );
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Recent payment activity
            {isLive && <LiveDot />}
          </span>
        }
        action={
          <Link href="/dashboard/earnings" className="text-sm text-[var(--river-deep)] hover:underline">
            View all
          </Link>
        }
      />
      {activity.status === "loading" && (
        <ul className="grid gap-1 px-2 pb-2" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-1.5 h-3 w-32" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-5 w-16" rounded="rounded-md" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {activity.status === "error" && activity.error && <div className="p-5"><ErrorState error={activity.error} onRetry={activity.refetch} /></div>}
      {activity.status === "success" && (activity.data?.length ?? 0) === 0 && (
        <div className="p-5">
          <EmptyState
            icon={<Activity size={22} aria-hidden="true" />}
            title="No payments yet"
            description="When an agent reads your articles, every paid word shows up here."
          />
        </div>
      )}
      {activity.status === "success" && (activity.data?.length ?? 0) > 0 && (
        <ul className="grid gap-1 px-2 pb-2">
          {activity.data!.slice(0, 5).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-muted)]">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.articleTitle}</div>
                <div className="text-xs text-[var(--muted)]">
                  {formatRelative(row.date)} · {row.wordsRead.toLocaleString()} words read
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">{formatUsdAtomicDisplay(row.creatorAmount)}</span>
                <PaymentStatusPill status={row.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ArticlesCard({ articles, hasArticles }: { articles: Article[]; hasArticles: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Your articles"
        action={
          <Link href="/dashboard/articles" className="text-sm text-[var(--river-deep)] hover:underline">
            Manage
          </Link>
        }
      />
      {!hasArticles ? (
        <div className="p-5">
          <EmptyState
            icon={<FileText size={22} aria-hidden="true" />}
            title="No articles yet"
            description="Publish your first article to let agents pay to read it."
            action={<PrimaryLink href="/dashboard/articles/new">New article</PrimaryLink>}
          />
        </div>
      ) : (
        <ul className="grid gap-1 px-2 pb-2">
          {articles.slice(0, 4).map((a) => (
            <li key={a.id}>
              <Link href={`/dashboard/articles/${a.id}`} className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 hover:bg-[var(--surface-muted)]">
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.title}</div>
                  <div className="text-xs text-[var(--muted)]">{a.usage.wordsRead.toLocaleString()} words read</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{formatUsdAtomicDisplay(a.usage.earnings)}</span>
                  <ArticleStatePill state={a.state} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExportButton({
  username,
  totalEarned,
  wordsRead,
  agentReads,
  topArticle,
  walletAddress,
  trendBars,
}: {
  username: string;
  totalEarned: number;
  wordsRead: number;
  agentReads: number;
  topArticle: string | null;
  walletAddress: string | null;
  trendBars: TrendBar[];
}) {
  const [open, setOpen] = useState(false);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "downloaded">("idle");
  const publicSummary = `Rubicon writer ${username} has earned ${formatUsdNumber(totalEarned)} from ${formatInt(agentReads)} agent reads across ${formatInt(wordsRead)} paid words.`;

  useEffect(() => {
    let cancelled = false;
    setPngUrl(null);
    renderExportPng({
        username,
        amount: formatUsdDisplay(totalEarned),
        reads: formatInt(agentReads),
        words: formatInt(wordsRead),
        topArticle: topArticle ?? "Not available yet",
        wallet: shortWallet(walletAddress),
        avgRead: formatUsdDisplay(agentReads > 0 ? totalEarned / agentReads : 0),
        trendValues: trendBars.map((bar) => bar.value),
      }).then((url) => {
        if (!cancelled) setPngUrl(url);
      });
    return () => {
      cancelled = true;
    };
  }, [agentReads, topArticle, totalEarned, trendBars, username, walletAddress, wordsRead]);

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
      const response = await fetch(pngUrl);
      const blob = await response.blob();
      if ("ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        await navigator.clipboard.writeText(publicSummary);
      }
      setCopyStatus("copied");
    } catch {
      download();
      setCopyStatus("downloaded");
    }
    window.setTimeout(() => setCopyStatus("idle"), 2200);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="button button-secondary text-sm">
        <Download size={15} aria-hidden="true" /> Export card
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Export card"
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--faint)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Export card</h2>
                <p className="text-xs text-[var(--muted)]">Twitter-ready PNG · 1200 × 720</p>
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

            <div className="p-5">
              <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[#eceef4]">
                {pngUrl ? (
                  <img
                    src={pngUrl}
                    alt={`${username} Rubicon earnings export card`}
                    className="block aspect-[5/3] h-auto w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="aspect-[5/3] animate-pulse bg-[var(--surface-muted)]" />
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" onClick={download} className="button button-primary justify-center text-sm" disabled={!pngUrl}>
                  <Download size={15} aria-hidden="true" /> Download
                </button>
                <button type="button" onClick={copyImage} className="button button-secondary justify-center text-sm" disabled={!pngUrl}>
                  <Copy size={15} aria-hidden="true" /> {copyStatus === "copied" ? "Copied" : copyStatus === "downloaded" ? "Downloaded" : "Copy PNG"}
                </button>
              </div>
              {copyStatus === "downloaded" && (
                <p className="mt-2 text-xs text-[var(--muted)]">Image copy was blocked, so the PNG was downloaded instead.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function renderExportPng({
  username,
  amount,
  reads,
  words,
  topArticle,
  wallet,
  avgRead,
  trendValues,
}: {
  username: string;
  amount: string;
  reads: string;
  words: string;
  topArticle: string;
  wallet: string;
  avgRead: string;
  trendValues: number[];
}) {
  const width = 1200;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Backdrop + premium export card surface.
  ctx.fillStyle = "#f0f0f1";
  ctx.fillRect(0, 0, width, height);
  const cardX = 32;
  const cardY = 32;
  const cardW = width - 64;
  const cardH = height - 64;
  const cardGradient = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  cardGradient.addColorStop(0, "#ffffff");
  cardGradient.addColorStop(1, "#f7f9fc");
  drawExportGradientPanel(ctx, cardX, cardY, cardW, cardH, 30, cardGradient, "rgba(18,24,38,0.12)");

  const logo = await loadImage("/rubicon-new-dark.png");
  const padX = 84;

  // Header
  if (logo && logo.width > 0) {
    const logoW = 188;
    const logoH = logoW * (logo.height / logo.width);
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.drawImage(logo, padX, 78, logoW, logoH);
    ctx.restore();
  }

  ctx.fillStyle = "#0e1014";
  ctx.font = "750 46px Arial, sans-serif";
  ctx.fillText("Earnings snapshot", padX, 160);
  ctx.fillStyle = "#69707c";
  ctx.font = "600 22px Arial, sans-serif";
  ctx.fillText(`${username} on Rubicon`, padX, 193);

  drawExportPill(ctx, width - padX - 132, 86, 132, 48, "14 days");

  // Featured earnings tile.
  const heroX = padX;
  const heroY = 232;
  const heroW = 410;
  const heroH = 156;
  const heroGradient = ctx.createLinearGradient(heroX, heroY, heroX + heroW, heroY + heroH);
  heroGradient.addColorStop(0, "#111827");
  heroGradient.addColorStop(1, "#2b3343");
  drawExportGradientPanel(ctx, heroX, heroY, heroW, heroH, 20, heroGradient, "rgba(18,24,38,0.10)");
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "700 14px Arial, sans-serif";
  ctx.fillText("TOTAL EARNED", heroX + 28, heroY + 42);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 56px Arial, sans-serif";
  ctx.fillText(truncateForCanvas(ctx, amount, heroW - 56), heroX + 28, heroY + 104);
  ctx.fillStyle = "#a7abb3";
  ctx.font = "600 18px Arial, sans-serif";
  ctx.fillText("Revenue from agent reads", heroX + 28, heroY + 134);

  const metricX = heroX + heroW + 22;
  const metricY = heroY;
  const metricGap = 16;
  const metricW = (width - padX - metricX - metricGap * 2) / 3;
  drawStatTile(ctx, metricX, metricY, metricW, heroH, "Words", words);
  drawStatTile(ctx, metricX + metricW + metricGap, metricY, metricW, heroH, "Reads", reads);
  drawStatTile(ctx, metricX + (metricW + metricGap) * 2, metricY, metricW, heroH, "Avg / read", avgRead);

  // Chart panel.
  const chartX = padX;
  const chartY = 412;
  const chartW = width - padX * 2;
  const chartH = 188;
  drawExportPanel(ctx, chartX, chartY, chartW, chartH, 20, "#ffffff", "rgba(18,24,38,0.08)");
  ctx.fillStyle = "#0e1014";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText("14-day earning trend", chartX + 24, chartY + 42);
  ctx.fillStyle = "#8a9099";
  ctx.font = "600 15px Arial, sans-serif";
  ctx.fillText("Paid word activity over time", chartX + 24, chartY + 66);
  drawBarChart(ctx, chartX + 24, chartY + 76, chartW - 48, chartH - 104, trendValues);

  // Footer.
  const footY = height - 58;
  ctx.fillStyle = "#eef2f7";
  roundRect(ctx, padX, footY - 34, width - padX * 2, 46, 14);
  ctx.fill();

  ctx.font = "700 16px Arial, sans-serif";
  ctx.fillStyle = "#7b838f";
  ctx.fillText("Top article", padX + 18, footY - 5);
  ctx.fillStyle = "#0e1014";
  ctx.font = "700 17px Arial, sans-serif";
  ctx.fillText(truncateForCanvas(ctx, topArticle, 470), padX + 112, footY - 5);

  ctx.font = "700 16px Arial, sans-serif";
  const walletLabel = "Wallet";
  const walletValue = wallet;
  const walletValueW = ctx.measureText(walletValue).width;
  const walletLabelW = ctx.measureText(walletLabel).width;
  const walletX = width - padX - 18 - walletValueW - walletLabelW - 12;
  ctx.fillStyle = "#7b838f";
  ctx.fillText(walletLabel, walletX, footY - 5);
  ctx.fillStyle = "#0e1014";
  ctx.fillText(walletValue, walletX + walletLabelW + 12, footY - 5);

  return canvas.toDataURL("image/png");
}

function drawStatTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
) {
  const tileGradient = ctx.createLinearGradient(x, y, x, y + height);
  tileGradient.addColorStop(0, "#ffffff");
  tileGradient.addColorStop(1, "#f4f6fa");
  drawExportGradientPanel(ctx, x, y, width, height, 18, tileGradient, "rgba(18,24,38,0.09)");
  ctx.fillStyle = "#8d95a1";
  ctx.font = "700 14px Arial, sans-serif";
  ctx.fillText(label.toUpperCase(), x + 22, y + 44);
  ctx.fillStyle = "#0e1014";
  ctx.font = "760 38px Arial, sans-serif";
  ctx.fillText(truncateForCanvas(ctx, value, width - 44), x + 22, y + 104);
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  values: number[],
) {
  const data = values.length > 0 ? values : [12, 20, 16, 28, 24, 32, 26, 36, 30, 22, 18, 28, 24, 14];
  // Scale against the actual peak (not a $1 floor) so sub-dollar earnings still
  // produce full-height, clearly visible bars.
  const max = Math.max(...data, 0);
  const baseline = y + height;
  ctx.strokeStyle = "#eef1f5";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i += 1) {
    const gy = y + (height / 2) * i;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }

  const gap = 9;
  const barW = (width - gap * (data.length - 1)) / data.length;
  data.forEach((value, i) => {
    const barH = max > 0 && value > 0 ? Math.max((value / max) * height, 7) : 0;
    const bx = x + i * (barW + gap);
    const barGradient = ctx.createLinearGradient(bx, baseline - barH, bx, baseline);
    barGradient.addColorStop(0, "#4f8cff");
    barGradient.addColorStop(1, "#2563eb");
    ctx.fillStyle = barGradient;
    roundRect(ctx, bx, baseline - barH, barW, barH, 7);
    ctx.fill();
  });
}

function drawExportPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
) {
  drawExportPanel(ctx, x, y, width, height, height / 2, "#ffffff", "rgba(18,24,38,0.14)");
  ctx.fillStyle = "#16181d";
  ctx.font = "600 18px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x + width / 2, y + height / 2 + 6);
  ctx.textAlign = "left";
}

function drawExportPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke = "rgba(30,40,62,0.12)",
) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawExportGradientPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: CanvasGradient,
  stroke = "rgba(30,40,62,0.12)",
) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
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

/** Loads a same-origin image for canvas drawing; resolves null on failure. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function OnchainCard({ address }: { address: string | null }) {
  const balance = useNativeBalance(address);
  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Card>
      {address && (
        <WithdrawDialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} walletAddress={address} />
      )}
      <CardHeader
        title="Payout connection"
        action={
          address ? (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setWithdrawOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--river-deep)] hover:underline"
              >
                <ArrowRight size={14} aria-hidden="true" /> Withdraw
              </button>
              <button
                type="button"
                onClick={() => balance.refetch()}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--river-deep)] hover:underline"
              >
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
            </div>
          ) : undefined
        }
      />
      {!address ? (
        <div className="p-4 sm:p-5">
          <div role="alert" className="flex flex-col gap-3 rounded-[10px] border border-[#f0ddbf] bg-[#fdf6ec] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f6e6cf] text-[#9a6516]">
                <AlertTriangle size={18} aria-hidden="true" />
              </span>
              <div>
                <div className="text-sm font-semibold text-[#7b4e12]">You can’t receive payments yet</div>
                <p className="mt-1 text-sm leading-6 text-[#8a6326]">Confirm the secure Privy connection Rubicon uses for payouts to start earning from agent reads.</p>
              </div>
            </div>
            <Link href="/dashboard/settings" className="button button-primary shrink-0 self-start text-sm sm:self-center">
              Confirm connection <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 px-3 pb-3">
          <p className="px-2 text-xs text-[var(--muted)]">Withdrawable earnings are sent through your confirmed payout connection.</p>
          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
          {/* Wallet address */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-5">
            <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Wallet address</div>
            <div className="mt-2 flex items-center gap-2">
              <span className="mono text-sm font-medium">{shortWallet(address)}</span>
              <button type="button" onClick={copy} className="text-[var(--muted)] transition-colors hover:text-[var(--ink)]" aria-label="Copy address">
                <Copy size={14} aria-hidden="true" />
              </button>
              {copied && <span className="text-xs text-[var(--green)]">copied</span>}
            </div>
            <a
              href={explorerAddressUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--river-deep)] hover:underline"
            >
              View on {ACTIVE_CHAIN.blockExplorers?.default.name ?? "explorer"} <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>

          {/* Network */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-5">
            <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Network</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium">
              <Link2 size={15} className="text-[var(--river)]" aria-hidden="true" /> {ACTIVE_CHAIN.name}
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">Chain ID {ACTIVE_CHAIN.id}</div>
          </div>

          {/* Balance */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-5">
            <div className="mono text-[0.66rem] uppercase tracking-[0.14em] text-[var(--muted)]">Balance</div>
            <div className="mt-2 text-2xl font-semibold tracking-[-0.01em]">
              {balance.status === "loading" ? (
                <span className="text-base font-normal text-[var(--muted)]">Loading…</span>
              ) : balance.status === "error" ? (
                <span className="text-base font-normal text-[#8d2f2d]">Unavailable</span>
              ) : (
                <>
                  {formatBalance(balance.value)}
                  <span className="ml-1.5 text-sm font-medium text-[var(--muted)]">{balance.symbol}</span>
                </>
              )}
            </div>
            {balance.status === "error" && <div className="mt-1 text-xs text-[var(--muted)]">Could not reach the RPC. Try Refresh.</div>}
          </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString();
}

/* ---------- momentum (week-over-week) ---------- */

interface WeeklyDeltas {
  /** Percent change vs the prior week, or null when there's no prior baseline. */
  earnings: number | null;
  words: number | null;
  reads: number | null;
}

/** Compares the last 7 days against the 7 days before, for the stat-tile hints. */
function buildWeeklyDeltas(activity: PaymentActivity[]): WeeklyDeltas {
  const now = Date.now();
  const week = 7 * 86_400_000;
  const cur = { earnings: 0, words: 0, reads: 0 };
  const prev = { earnings: 0, words: 0, reads: 0 };
  for (const row of activity) {
    if (row.status === "failed") continue;
    const t = new Date(row.date).getTime();
    if (Number.isNaN(t)) continue;
    const age = now - t;
    const bucket = age < week ? cur : age < 2 * week ? prev : null;
    if (!bucket) continue;
    bucket.earnings += atomicToUsd(row.creatorAmount);
    bucket.words += row.wordsRead;
    bucket.reads += 1;
  }
  const pct = (a: number, b: number): number | null => (b <= 0 ? (a > 0 ? 100 : null) : ((a - b) / b) * 100);
  return {
    earnings: pct(cur.earnings, prev.earnings),
    words: pct(cur.words, prev.words),
    reads: pct(cur.reads, prev.reads),
  };
}

function buildActivityCalendar(activity: PaymentActivity[], weeks = 12): Array<{ date: string; count: number }> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - weeks * 7 + 1);
  start.setHours(0, 0, 0, 0);
  const counts = new Map<string, number>();

  for (const row of activity) {
    const date = new Date(row.date);
    if (Number.isNaN(date.getTime()) || date < start || date > now) continue;
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const days: Array<{ date: string; count: number }> = [];
  const cursor = new Date(start);
  while (cursor <= now) {
    const key = cursor.toISOString().slice(0, 10);
    days.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function DeltaHint({ pct, onDark = false }: { pct: number | null; onDark?: boolean }) {
  const muted = onDark ? "text-white/55" : "text-[var(--muted)]";
  if (pct === null) return null;
  if (Math.abs(pct) < 1) return <span className={muted}>Flat vs last week</span>;
  const up = pct > 0;
  const color = up
    ? onDark
      ? "text-[var(--gain-on-dark)]"
      : "text-[var(--gain)]"
    : onDark
      ? "text-[var(--loss-on-dark)]"
      : "text-[var(--loss)]";
  return (
    <span className={`font-medium ${color}`}>
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

/** Local YYYY-MM-DD key so day buckets line up with the creator's calendar. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Buckets payment activity into the trailing 14 days for the trend chart. */
function buildTrend(activity: PaymentActivity[], metric: "earnings" | "words", days = 14): TrendBar[] {
  const buckets = new Map<string, { earnings: number; words: number; date: Date }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.set(dayKey(d), { earnings: 0, words: 0, date: d });
  }
  for (const row of activity) {
    if (row.status === "failed") continue;
    const parsed = new Date(row.date);
    if (Number.isNaN(parsed.getTime())) continue;
    const bucket = buckets.get(dayKey(parsed));
    if (!bucket) continue;
    bucket.earnings += atomicToUsd(row.creatorAmount);
    bucket.words += row.wordsRead;
  }
  return [...buckets.values()].map(({ earnings, words, date }) => {
    const value = metric === "earnings" ? earnings : words;
    return {
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      fullLabel: date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
      value,
      detail:
        metric === "earnings"
          ? `${formatInt(words)} words`
          : earnings > 0
            ? formatUsdNumber(earnings)
            : undefined,
    };
  });
}

/** Top-earning articles as a compact three-segment donut, with the remainder folded into "Other". */
function buildEarningsSlices(articles: Article[]): DonutSlice[] {
  const earners = articles
    .map((a) => ({ title: a.title, value: atomicToUsd(a.usage.earnings) }))
    .filter((a) => a.value > 0)
    .sort((a, b) => b.value - a.value);
  if (earners.length === 0) return [];

  const top = earners.slice(0, 2);
  const rest = earners.slice(2);
  const slices: DonutSlice[] = top.map((a, i) => ({ label: a.title, value: a.value, color: DONUT_COLORS[i] }));
  if (rest.length > 0) {
    slices.push({
      label: `${rest.length} more`,
      value: rest.reduce((sum, a) => sum + a.value, 0),
      color: DONUT_COLORS[2],
    });
  }
  return slices;
}
