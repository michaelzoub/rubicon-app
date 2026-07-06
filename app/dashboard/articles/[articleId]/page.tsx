"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Eye, Loader2, Pause, Play, Trash2, X } from "lucide-react";
import type { ArticleAccessMode, ArticleDetail } from "@/lib/rubicon/types";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import {
  atomicToUsd,
  formatUsd,
  usdToAtomic,
} from "@/lib/rubicon/pricing";
import { isStolenXContent, normalizeHandle } from "@/lib/articles/ownership";
import {
  ArticleStatePill,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  formatDate,
  formatRelative,
  LoadingState,
  PaymentStatusPill,
  SafetyWarning,
  StatTile,
} from "../../_components/ui";
import { AgentPreviewDialog } from "../_components/agent-preview-dialog";
import { MarkdownEditor } from "../../_components/markdown-editor";

export default function ArticleDetailPage() {
  const params = useParams<{ articleId: string }>();
  const articleId = params.articleId;
  const router = useRouter();
  const article = useRubiconQuery<ArticleDetail>((c) => c.getArticle(articleId), [articleId], { queryKey: ["article"] });
  const creator = useRubiconQuery((c) => c.getCreator(), [], { queryKey: ["creator"] });

  const publish = useRubiconMutation((c, id: string) => c.publishArticle(id));
  const pause = useRubiconMutation((c, id: string) => c.pauseArticle(id));
  const archive = useRubiconMutation((c, id: string) => c.archiveArticle(id));
  const remove = useRubiconMutation((c, id: string) => c.deleteArticle(id));
  const update = useRubiconMutation((c, ...args: Parameters<typeof c.updateArticle>) => c.updateArticle(...args));

  const data = article.data;

  // Content-ownership guard for imported X posts: block publishing when the
  // original author handle doesn't match the logged-in creator's username.
  const ownershipSource =
    data?.importMeta?.sourcePlatform
      ? { platform: data.importMeta.sourcePlatform, authorHandle: data.importMeta.sourceAuthorHandle }
      : null;
  const ownershipMismatch = isStolenXContent(ownershipSource, creator.data?.username);

  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const agentPreviewArticle = data
    ? {
        title: data.title,
        author: data.author,
        pricePerWordAtomic: data.pricePerWordAtomic,
        maxArticlePriceAtomic: data.maxArticlePriceAtomic,
        totalWords: data.totalWords,
        sections: data.sections,
        sellerAgentConfig: data.sellerAgentConfig,
      }
    : null;

  return (
    <div className="grid gap-6">
      <Link href="/dashboard/articles" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        <ArrowLeft size={15} aria-hidden="true" /> All articles
      </Link>

      {article.status === "loading" && <LoadingState />}
      {article.status === "error" && article.error && <ErrorState error={article.error} onRetry={article.refetch} />}

      {article.status === "success" && data && (
        <>
          <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">{data.title}</h1>
                <ArticleStatePill state={data.state} />
                {data.accessMode === "free" && (
                  <span className="mono rounded-full bg-[#e8f6ef] px-2.5 py-1 text-[0.66rem] uppercase tracking-[0.12em] text-[#165c3e]">
                    Free
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => setPreviewOpen(true)} className="button button-secondary text-sm">
                <Eye size={15} aria-hidden="true" /> Preview as agent
              </button>
              <button type="button" onClick={() => setEditing((v) => !v)} className="button button-secondary text-sm">
                {editing ? "Close" : "Edit article"}
              </button>
              {data.state !== "archived" && data.state !== "deleted" && (
                <button
                  type="button"
                  onClick={async () => {
                    // Never let an imported X post that isn't theirs go live.
                    if (data.state !== "live" && ownershipMismatch) return;
                    if (data.state === "live") await pause.run(data.id);
                    else await publish.run(data.id);
                    article.refetch();
                  }}
                  disabled={publish.pending || pause.pending || (data.state !== "live" && ownershipMismatch)}
                  className="button button-secondary text-sm disabled:opacity-50"
                >
                  {data.state === "live" ? <><Pause size={15} aria-hidden="true" /> Pause</> : <><Play size={15} aria-hidden="true" /> Publish</>}
                </button>
              )}
              {data.state !== "archived" && data.state !== "deleted" && (
                <button
                  type="button"
                  onClick={async () => {
                    await archive.run(data.id);
                    router.push("/dashboard/articles");
                  }}
                  disabled={archive.pending}
                  className="button button-secondary text-sm text-[#8d2f2d] disabled:opacity-50"
                >
                  <Archive size={15} aria-hidden="true" /> Archive
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="button button-secondary text-sm text-[#8d2f2d]"
              >
                <Trash2 size={15} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
          {data.state !== "live" && data.state !== "archived" && data.state !== "deleted" && (
            <p className="-mt-4 text-sm text-[var(--muted)]">
              Agents can preview metadata, but paid content remains hidden until purchased.
            </p>
          )}
          {ownershipMismatch && (
            <SafetyWarning>
              This article was imported from{" "}
              <strong>@{normalizeHandle(data.importMeta?.sourceAuthorHandle)}</strong> on X, which doesn’t
              match your account <strong>@{normalizeHandle(creator.data?.username)}</strong>. It can’t be
              published — monetizing someone else’s content isn’t allowed.
            </SafetyWarning>
          )}
          <AgentPreviewDialog article={agentPreviewArticle} open={previewOpen} onClose={() => setPreviewOpen(false)} />

          {(publish.error || pause.error || archive.error || remove.error) && (
            <div className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">
              {(publish.error ?? pause.error ?? archive.error ?? remove.error)?.message}
            </div>
          )}

          {deleteOpen && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-article-title"
              onClick={() => !remove.pending && setDeleteOpen(false)}
            >
              <div className="w-full max-w-md rounded-lg border border-[var(--line)] bg-white p-6" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="delete-article-title" className="text-lg font-semibold">Delete this article?</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                      This permanently removes “{data.title}” and its associated records from Supabase. This can’t be undone.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(false)}
                    disabled={remove.pending}
                    className="dashboard-icon-button shrink-0"
                    aria-label="Close delete confirmation"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button type="button" onClick={() => setDeleteOpen(false)} disabled={remove.pending} className="button button-secondary text-sm">
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="confirm-delete-article"
                    onClick={async () => {
                      try {
                        await remove.run(data.id);
                        router.push("/dashboard/articles");
                      } catch {
                        // The mutation error remains visible above the article.
                      }
                    }}
                    disabled={remove.pending}
                    className="button border border-[#8d2f2d] bg-[#8d2f2d] text-sm text-white hover:bg-[#742624] disabled:opacity-50"
                  >
                    {remove.pending ? <><Loader2 size={15} className="animate-spin" /> Deleting…</> : <><Trash2 size={15} /> Delete permanently</>}
                  </button>
                </div>
                {remove.error && <p className="mt-3 text-sm text-[#8d2f2d]" role="alert">{remove.error.message}</p>}
              </div>
            </div>
          )}

          {editing && (
            <EditPanel
              article={data}
              pending={update.pending}
              error={update.error?.message ?? null}
              onSave={async (input) => {
                await update.run(data.id, input);
                setEditing(false);
                article.refetch();
              }}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Words read" value={data.usage.wordsRead.toLocaleString()} />
            <StatTile label="Agent reads" value={data.usage.agentReads.toLocaleString()} />
            <StatTile label="Earnings" value={data.accessMode === "free" ? "—" : formatUsd(data.usage.earnings)} />
            <StatTile
              label={data.accessMode === "free" ? "Access" : "Price per word"}
              value={data.accessMode === "free" ? "Free" : formatUsd(data.pricePerWordAtomic)}
              hint={`${data.totalWords.toLocaleString()} words total`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Section usage" />
              {data.sectionUsage.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No reads yet" description="When agents read, you’ll see which sections they found useful." />
                </div>
              ) : (
                <ul className="grid max-h-80 gap-1 overflow-y-auto overflow-x-hidden p-2">
                  {data.sectionUsage.map((s) => {
                    const max = Math.max(...data.sectionUsage.map((x) => x.wordsRead), 1);
                    return (
                      <li key={s.sectionId} className="px-5 py-3">
                        <div className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words font-medium">{s.heading}</span>
                          <span className="shrink-0 text-[var(--muted)]">{s.wordsRead.toLocaleString()} words</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                          <div className="h-full rounded-full bg-[var(--river)]" style={{ width: `${(s.wordsRead / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Recent seller-agent sessions" />
              {data.sessions.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No sessions yet" description="Each time a buyer agent reads through your seller agent, it appears here." />
                </div>
              ) : (
                <ul className="grid max-h-80 gap-1 overflow-y-auto p-2">
                  {data.sessions.map((session) => (
                    <li key={session.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{formatRelative(session.startedAt)}</div>
                        <div className="text-xs text-[var(--muted)]">{session.wordsRead.toLocaleString()} words read</div>
                      </div>
                      <span className="shrink-0 font-semibold">{formatUsd(session.earnings)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Payment activity" />
            {data.paymentActivity.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No payments yet" description="Paid words for this article will be listed here." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Words read</th>
                      <th className="px-5 py-3 font-medium">Writer amount</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Settlement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.paymentActivity.map((row) => (
                      <tr key={row.id} className="transition-colors hover:bg-[var(--surface-muted)]">
                        <td className="px-5 py-3">{formatDate(row.date)}</td>
                        <td className="px-5 py-3">{row.wordsRead.toLocaleString()}</td>
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
        </>
      )}
    </div>
  );
}

function EditPanel({
  article,
  pending,
  error,
  onSave,
}: {
  article: ArticleDetail;
  pending: boolean;
  error: string | null;
  onSave: (input: { title: string; author: string; body: string; accessMode: ArticleAccessMode; pricePerWordAtomic: string; maxArticlePriceAtomic: string | null }) => void;
}) {
  const [title, setTitle] = useState(article.title);
  const [author, setAuthor] = useState(article.author);
  const [body, setBody] = useState(article.body);
  const [accessMode, setAccessMode] = useState<ArticleAccessMode>(article.accessMode);
  const [pricePerWord, setPricePerWord] = useState(atomicToUsd(article.pricePerWordAtomic).toString());
  const [maxPrice, setMaxPrice] = useState(article.maxArticlePriceAtomic ? atomicToUsd(article.maxArticlePriceAtomic).toString() : "");

  useEffect(() => {
    setTitle(article.title);
    setAuthor(article.author);
    setBody(article.body);
    setAccessMode(article.accessMode);
    setPricePerWord(atomicToUsd(article.pricePerWordAtomic).toString());
    setMaxPrice(article.maxArticlePriceAtomic ? atomicToUsd(article.maxArticlePriceAtomic).toString() : "");
  }, [article]);

  const isFree = accessMode === "free";

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Edit article</h2>
      <div className="mt-4 grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Article title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]" />
        </label>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Article body</span>
          <MarkdownEditor value={body} onChange={setBody} placeholder="Edit your article…" contained />
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className="h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]" />
        </label>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Access</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Article access">
            {(["paid", "free"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={accessMode === mode}
                data-testid={`edit-access-${mode}`}
                onClick={() => setAccessMode(mode)}
                className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                  accessMode === mode
                    ? "border-[var(--river)] bg-[var(--river-pale)] text-[var(--river-deep)]"
                    : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--muted)] hover:border-[var(--river-line)]"
                }`}
              >
                {mode === "paid" ? "Paid per word" : "Free for all agents"}
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--muted)]">
            {isFree
              ? "Free articles are delivered in full to any agent and earn nothing. Publishing needs no wallet."
              : "Paid articles require a verified receiving wallet and a positive price to publish."}
          </span>
        </div>
        <div className={`grid gap-4 sm:grid-cols-2 ${isFree ? "opacity-40" : ""}`}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Price per word ($)</span>
            <input value={isFree ? "" : pricePerWord} onChange={(e) => setPricePerWord(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={isFree ? "Free" : "0.0001"} disabled={isFree} className="h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]" />
            <span className="text-xs text-[var(--muted)]">Agents pay only for the words they reveal. You can update pricing anytime.</span>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Maximum article price ($)</span>
            <input value={isFree ? "" : maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder={isFree ? "—" : "No cap"} disabled={isFree} className="h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]" />
          </label>
        </div>
      </div>
      {error && <p className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">{error}</p>}
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          disabled={pending || !title.trim() || !author.trim() || !body.trim() || (!isFree && !(Number(usdToAtomic(Number(pricePerWord))) > 0))}
          onClick={() =>
            onSave({
              title: title.trim(),
              author: author.trim(),
              body: body.trim(),
              accessMode,
              // A free article carries no price; store "0" so a later switch to
              // paid starts from a clean, deliberately-priced state.
              pricePerWordAtomic: isFree ? "0" : usdToAtomic(Number(pricePerWord)),
              maxArticlePriceAtomic: isFree ? null : maxPrice ? usdToAtomic(Number(maxPrice)) : null,
            })
          }
          className="button button-primary disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Card>
  );
}
