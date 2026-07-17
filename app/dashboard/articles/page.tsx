"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Eye, FileText, Link2, Pause, Pencil, Play } from "lucide-react";
import type { Article } from "@/lib/rubicon/types";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import { useAnalyticsOverview } from "@/lib/analytics/hooks";
import { formatUsd } from "@/lib/rubicon/pricing";
import { isStolenXContent } from "@/lib/articles/ownership";
import {
  ArticleStatePill,
  Card,
  EmptyState,
  ErrorState,
  formatRelative,
  LoadingState,
  PageHeader,
  PrimaryLink,
  SafetyBadge,
} from "../_components/ui";
import { AgentPreviewDialog } from "./_components/agent-preview-dialog";
import { SuccessCelebration, useSuccessCelebration } from "../_components/success-celebration";

export default function ArticlesPage() {
  const reduceMotion = useReducedMotion();
  const articles = useRubiconQuery((c) => c.listArticles(), [], { queryKey: ["articles"] });
  const creator = useRubiconQuery((c) => c.getCreator(), [], { queryKey: ["creator"] });
  const analytics = useAnalyticsOverview();
  const publish = useRubiconMutation((c, id: string) => c.publishArticle(id));
  const pause = useRubiconMutation((c, id: string) => c.pauseArticle(id));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const { celebrationKey, celebrating, markCompletion } = useSuccessCelebration();

  function isStolen(article: Article): boolean {
    const source = article.importMeta?.sourcePlatform
      ? { platform: article.importMeta.sourcePlatform, authorHandle: article.importMeta.sourceAuthorHandle }
      : null;
    return isStolenXContent(source, creator.data?.username);
  }

  async function toggle(article: Article) {
    // Don't publish an imported X post that belongs to another account.
    if (article.state !== "live" && isStolen(article)) return;
    setBusyId(article.id);
    try {
      if (article.state === "live") await pause.run(article.id);
      else {
        await publish.run(article.id);
        setPublishedId(article.id);
        markCompletion("success");
      }
      articles.refetch();
    } catch {
      /* surfaced via mutation error below */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="dashboard-fade-in grid gap-4">
      <PageHeader
        title="Your articles"
        action={
          <div className="grid justify-items-start gap-1.5 sm:justify-items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/dashboard/articles/import" className="button button-secondary text-sm">
                <Link2 size={15} aria-hidden="true" /> Import from URL
              </Link>
              <PrimaryLink href="/dashboard/articles/new">New article</PrimaryLink>
            </div>
            <p className="text-xs text-[var(--muted)]">Saved as a draft first. Nothing goes live until you publish.</p>
          </div>
        }
      />

      {(articles.status === "loading" || (analytics.isPending && !analytics.data)) && <LoadingState />}
      {articles.status === "error" && articles.error && <ErrorState error={articles.error} onRetry={articles.refetch} />}
      {analytics.error && !analytics.data && <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />}

      {articles.status === "success" && (articles.data?.length ?? 0) === 0 && (
        <EmptyState
          icon={<FileText size={22} aria-hidden="true" />}
          title="No articles yet"
          description="Add your content, choose a price per word, and make it available to agents."
          action={
            <div className="grid justify-items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Link href="/dashboard/articles/import" className="button button-secondary text-sm">
                  <Link2 size={15} aria-hidden="true" /> Import from URL
                </Link>
                <PrimaryLink href="/dashboard/articles/new">New article</PrimaryLink>
              </div>
              <p className="text-xs text-[var(--muted)]">Saved as a draft first. Nothing goes live until you publish.</p>
            </div>
          }
        />
      )}

      {(publish.error || pause.error) && (
        <div className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">
          {(publish.error ?? pause.error)?.message}
        </div>
      )}

      {articles.status === "success" && (articles.data?.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {articles.data!.map((article) => {
            const stolen = isStolen(article);
            const metric = analytics.data?.topArticles.find((candidate) => candidate.articleId === article.id);
            return (
            <li
              key={article.id}
              className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--surface-muted)] sm:px-5 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/articles/${article.id}`}
                    // Post-go-live landing page: agents finishing onboarding
                    // read the live article's URL from this link.
                    {...(article.state === "live" ? { "data-testid": "live-url" } : {})}
                    className="min-w-0 break-words text-base font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] hover:underline"
                  >
                    {article.title}
                  </Link>
                  <ArticleStatePill state={article.state} />
                  {stolen && <SafetyBadge />}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
                  <span>{formatUsd(article.pricePerWordAtomic)} / word</span>
                  {metric ? (
                    <>
                      <span>{metric.wordsRead.toLocaleString()} words read</span>
                      <span>{metric.agentReads.toLocaleString()} agent reads</span>
                      <span className="font-medium text-[var(--ink)]">{formatUsd(metric.settledCreatorAmountAtomic)} earned</span>
                      <span>Last read {formatRelative(metric.lastReadAt)}</span>
                    </>
                  ) : (
                    <span>Open the article for its analytics</span>
                  )}
                </div>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 min-[520px]:flex min-[520px]:w-auto min-[520px]:flex-wrap min-[520px]:items-center lg:justify-end">
                <button type="button" onClick={() => setPreviewArticle(article)} className="button button-secondary justify-center whitespace-nowrap text-sm">
                  <Eye size={15} aria-hidden="true" /> Preview as agent
                </button>
                <Link href={`/dashboard/articles/${article.id}`} className="button button-secondary justify-center whitespace-nowrap text-sm">
                  <Pencil size={15} aria-hidden="true" /> Edit
                </Link>
                {article.state !== "archived" && article.state !== "deleted" && (
                  <div className="relative overflow-visible">
                    <SuccessCelebration active={celebrating && publishedId === article.id} celebrationKey={celebrationKey} />
                    <motion.button
                      type="button"
                      onClick={() => toggle(article)}
                      disabled={busyId === article.id || (article.state !== "live" && stolen)}
                      title={article.state !== "live" && stolen ? "This imported X post belongs to another account" : undefined}
                      className="button button-secondary relative w-full justify-center whitespace-nowrap text-sm disabled:opacity-50"
                      animate={!reduceMotion && celebrating && publishedId === article.id ? { transform: ["scale(1)", "scale(1.045)", "scale(1)"] } : { transform: "scale(1)" }}
                      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                    >
                      {celebrating && publishedId === article.id ? (
                        <><Check size={15} aria-hidden="true" /> Published</>
                      ) : article.state === "live" ? (
                        <><Pause size={15} aria-hidden="true" /> Pause</>
                      ) : (
                        <><Play size={15} aria-hidden="true" /> Publish</>
                      )}
                    </motion.button>
                  </div>
                )}
              </div>
            </li>
            );
          })}
        </ul>
        </Card>
      )}
      <AgentPreviewDialog article={previewArticle} open={Boolean(previewArticle)} onClose={() => setPreviewArticle(null)} />
    </div>
  );
}
