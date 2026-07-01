"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, FileText, Link2, Pause, Pencil, Play } from "lucide-react";
import type { Article } from "@/lib/rubicon/types";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import { formatUsd } from "@/lib/rubicon/pricing";
import { isStolenXContent } from "@/lib/articles/ownership";
import {
  ArticleStatePill,
  EmptyState,
  ErrorState,
  formatRelative,
  LoadingState,
  PageHeader,
  PrimaryLink,
  SafetyBadge,
} from "../_components/ui";
import { AgentPreviewDialog } from "./_components/agent-preview-dialog";

export default function ArticlesPage() {
  const articles = useRubiconQuery((c) => c.listArticles(), [], { queryKey: ["articles"] });
  const creator = useRubiconQuery((c) => c.getCreator(), [], { queryKey: ["creator"] });
  const publish = useRubiconMutation((c, id: string) => c.publishArticle(id));
  const pause = useRubiconMutation((c, id: string) => c.pauseArticle(id));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);

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
      else await publish.run(article.id);
      articles.refetch();
    } catch {
      /* surfaced via mutation error below */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Your articles"
        description="Everything you’ve published for agents to read."
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

      {articles.status === "loading" && <LoadingState />}
      {articles.status === "error" && articles.error && <ErrorState error={articles.error} onRetry={articles.refetch} />}

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
        <ul className="grid min-w-0 gap-2 p-2">
          {articles.data!.map((article) => {
            const stolen = isStolen(article);
            return (
            <li
              key={article.id}
              className="flex flex-col gap-4 py-5 first:pt-0 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/dashboard/articles/${article.id}`}
                    className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere] hover:underline"
                  >
                    {article.title}
                  </Link>
                  <ArticleStatePill state={article.state} />
                  {stolen && <SafetyBadge />}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted)]">
                  <span>{formatUsd(article.pricePerWordAtomic)} / word</span>
                  <span>{article.usage.wordsRead.toLocaleString()} words read</span>
                  <span>{article.usage.agentReads.toLocaleString()} agent reads</span>
                  <span className="font-medium text-[var(--ink)]">{formatUsd(article.usage.earnings)} earned</span>
                  <span>Last read {formatRelative(article.usage.lastReadAt)}</span>
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
                  <button
                    type="button"
                    onClick={() => toggle(article)}
                    disabled={busyId === article.id || (article.state !== "live" && stolen)}
                    title={article.state !== "live" && stolen ? "This imported X post belongs to another account" : undefined}
                    className="button button-secondary justify-center whitespace-nowrap text-sm disabled:opacity-50"
                  >
                    {article.state === "live" ? (
                      <>
                        <Pause size={15} aria-hidden="true" /> Pause
                      </>
                    ) : (
                      <>
                        <Play size={15} aria-hidden="true" /> Publish
                      </>
                    )}
                  </button>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      <AgentPreviewDialog article={previewArticle} open={Boolean(previewArticle)} onClose={() => setPreviewArticle(null)} />
    </div>
  );
}
