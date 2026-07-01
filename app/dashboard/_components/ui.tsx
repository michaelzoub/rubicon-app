"use client";

import Link from "next/link";
import { AlertTriangle, Inbox, Loader2, LogIn, RefreshCw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { RubiconError } from "@/lib/rubicon/client";
import type { ArticleState, PaymentStatus } from "@/lib/rubicon/types";
import { ARTICLE_STATE_LABELS } from "@/lib/rubicon/types";

/* ---------- layout ---------- */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[1.65rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  id,
  style,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <div id={id} style={style} className={`dashboard-card bg-[var(--card)] ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  featured = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  featured?: boolean;
}) {
  return (
    <Card
      className={`grid h-full min-h-[104px] grid-rows-[1.65rem_1fr_1.75rem] p-3.5 ${featured ? "text-white" : ""}`}
      style={featured ? { background: "var(--tile-featured)", borderColor: "transparent" } : undefined}
    >
      <div
        className={`mono flex items-start text-[0.65rem] uppercase leading-4 tracking-[0.1em] ${
          featured ? "text-white/55" : "text-[var(--muted)]"
        }`}
      >
        {label}
      </div>
      <div className="flex items-center text-[1.45rem] font-semibold leading-none tracking-[-0.025em] tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs">{hint}</div> : <div aria-hidden="true" />}
    </Card>
  );
}

/* ---------- states ---------- */

/** A soft, neutral skeleton placeholder with a calm matte shimmer. */
export function Skeleton({ className = "", rounded = "rounded-md" }: { className?: string; rounded?: string }) {
  return <div className={`rubicon-skeleton ${rounded} ${className}`} aria-hidden="true" />;
}

/** A tiny inline indicator for refresh states — keeps existing data visible. */
export function RefreshDots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} aria-label="Refreshing" role="status">
      <Loader2 size={13} className="animate-spin text-[var(--muted)]" aria-hidden="true" />
      <span className="text-xs text-[var(--muted)]">Updating…</span>
    </span>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="dashboard-card grid gap-5 bg-[var(--card)] p-4" aria-label={label} role="status">
      <span className="sr-only">{label}</span>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-24" rounded="rounded-lg" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-5 border-t border-[var(--line)] pt-3 first:border-t-0 first:pt-0">
            <div className="grid flex-1 gap-2">
              <Skeleton className={`h-3.5 ${index % 2 === 0 ? "w-2/5" : "w-1/3"}`} />
              <Skeleton className={`h-3 ${index % 2 === 0 ? "w-3/5" : "w-1/2"}`} />
            </div>
            <Skeleton className="h-6 w-16" rounded="rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shared first-paint shell for dashboard routes that do not have a more
    specific content skeleton. */
export function DashboardPageSkeleton() {
  return (
    <div className="grid gap-4" aria-label="Loading dashboard" role="status">
      <span className="sr-only">Loading dashboard…</span>
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3.5 w-72 max-w-[60vw]" />
        </div>
        <Skeleton className="h-8 w-28" rounded="rounded-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="grid min-h-[104px] content-between gap-5 p-4">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-7 w-28" />
          </Card>
        ))}
      </div>
      <LoadingState label="Loading page…" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="dashboard-card flex flex-col items-center bg-[var(--card)] px-6 py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-[10px] border border-[var(--river-line)] bg-[var(--river-pale)] text-[var(--river)]">
        {icon ?? <Inbox size={22} aria-hidden="true" />}
      </span>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: RubiconError; onRetry?: () => void }) {
  const isAuth = error.kind === "auth";
  const isConfig = error.code === "not_configured";
  return (
    <div className="flex flex-col items-center rounded-[10px] border border-[#f0ddbf] bg-[#fdf6ec] px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-[10px] bg-[#f6e6cf] text-[#9a6516]">
        {isAuth ? <LogIn size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-[#7b4e12]">
        {isAuth ? "Your session expired" : isConfig ? "Supabase isn’t connected yet" : "We couldn’t load this"}
      </h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8a6326]">{error.message}</p>
      {onRetry && !isConfig && (
        <button type="button" onClick={onRetry} className="button button-secondary mt-5">
          <RefreshCw size={15} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

/* ---------- safety ---------- */

/**
 * Loud red "bubble" warning for content-ownership problems — e.g. trying to
 * publish an imported X post that belongs to someone else. Used to block and
 * explain why posting is disabled.
 */
export function SafetyWarning({
  title = "This isn’t your content",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-[#efcbc8] bg-[#fde4e2] px-4 py-3.5 text-sm text-[#8d2f2d]"
    >
      <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d4302b] opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#c5221c]" />
      </span>
      <div className="grid gap-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle size={15} aria-hidden="true" />
          {title}
        </div>
        <div className="leading-5 text-[#9a3b37]">{children}</div>
      </div>
    </div>
  );
}

/**
 * Compact red badge for list/card contexts where a full warning bubble would be
 * too heavy, but a creator still needs a clear "stop" signal.
 */
export function SafetyBadge({ label = "Not your content" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[#fde4e2] px-2.5 py-1 text-xs font-semibold text-[#963b37]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#c5221c]" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ---------- pills ---------- */

const stateStyles: Record<ArticleState, string> = {
  draft: "bg-[#eceef4] text-[#5f6470]",
  live: "bg-[#dff5e9] text-[#176342]",
  paused: "bg-[#fff0d5] text-[#80520f]",
  archived: "bg-[#eceef4] text-[#5f6470]",
  deleted: "bg-[#fde4e2] text-[#963b37]",
};

export function ArticleStatePill({ state }: { state: ArticleState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${stateStyles[state]}`}>
      <span className="h-1.5 w-1.5 rounded-sm bg-current opacity-70" />
      {ARTICLE_STATE_LABELS[state]}
    </span>
  );
}

const paymentStyles: Record<PaymentStatus, string> = {
  settled: "bg-[#dff5e9] text-[#176342]",
  pending: "bg-[#fff0d5] text-[#80520f]",
  failed: "bg-[#fde4e2] text-[#963b37]",
};

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${paymentStyles[status]}`}>
      {status}
    </span>
  );
}

export function WalletStatePill({ verified }: { verified: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
        verified
          ? "bg-[#e8f6ef] text-[#165c3e]"
          : "bg-[var(--surface-muted)] text-[var(--muted)]"
      }`}
    >
      {verified ? "Verified" : "Unverified"}
    </span>
  );
}

/* ---------- misc ---------- */

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="button button-primary text-sm">
      {children}
    </Link>
  );
}

export function shortWallet(address: string | null | undefined): string {
  if (!address) return "Not connected";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
