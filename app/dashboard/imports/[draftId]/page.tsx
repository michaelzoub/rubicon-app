"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import { atomicToUsd, usdToAtomic } from "@/lib/rubicon/pricing";
import { Card, ErrorState, LoadingState } from "../../_components/ui";
import { MarkdownEditor } from "../../_components/markdown-editor";

const inputClass = "h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]";

export default function ImportedDraftReviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const article = useRubiconQuery((c) => c.getArticle(draftId), [draftId], { queryKey: ["article"] });
  const update = useRubiconMutation((c, ...args: Parameters<typeof c.updateArticle>) => c.updateArticle(...args));
  const publish = useRubiconMutation((c, id: string) => c.publishArticle(id));
  const data = article.data;
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (!data) return;
    setTitle(data.title);
    setAuthor(data.author);
    setBody(data.body);
    setPrice(data.pricePerWordAtomic === "0" ? "" : atomicToUsd(data.pricePerWordAtomic).toString());
  }, [data]);

  const valid = Boolean(title.trim() && author.trim() && body.trim() && Number(price) > 0);

  async function save(andPublish: boolean) {
    await update.run(draftId, {
      title: title.trim(),
      author: author.trim(),
      body: body.trim(),
      pricePerWordAtomic: usdToAtomic(Number(price)),
    });
    if (andPublish) {
      await publish.run(draftId);
      router.push(`/dashboard/articles/${draftId}`);
    } else {
      article.refetch();
    }
  }

  return (
    <div className="grid gap-6">
      <Link href="/dashboard/articles" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <ArrowLeft size={15} aria-hidden="true" /> All articles
      </Link>
      <div>
        <p className="mono text-xs uppercase tracking-[0.14em] text-[var(--river)]">Imported draft</p>
        <h1 className="mt-2 text-3xl font-semibold">Review before publishing</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">We only import the article you choose. Nothing is posted or published automatically.</p>
      </div>

      {article.status === "loading" && <LoadingState />}
      {article.status === "error" && article.error && <ErrorState error={article.error} onRetry={article.refetch} />}
      {article.status === "success" && data && (
        <Card className="grid gap-5 p-6">
          {data.importMeta && (
            <div className="rounded-lg bg-[var(--river-pale)] p-4 text-sm">
              <div className="font-medium">Imported from {data.importMeta.sourcePlatform === "x" ? "X / Twitter" : "Substack"}</div>
              {data.importMeta.sourceUrl && (
                <a href={data.importMeta.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 break-all text-[var(--river-deep)] underline">
                  {data.importMeta.sourceUrl} <ExternalLink size={13} aria-hidden="true" />
                </a>
              )}
              {data.importMeta.importWarnings.map((warning) => <p key={warning} className="mt-2 text-[#7b4e12]">{warning}</p>)}
            </div>
          )}
          <label className="grid gap-2"><span className="text-sm font-medium">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></label>
          <label className="grid gap-2"><span className="text-sm font-medium">Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} /></label>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Body</span>
            <MarkdownEditor value={body} onChange={setBody} placeholder="Review the imported article…" contained />
          </div>
          <label className="grid max-w-xs gap-2">
            <span className="text-sm font-medium">Price per word (USD)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.001" className={inputClass} />
            <span className="text-xs text-[var(--muted)]">Agents pay only for the words they reveal. You can update pricing anytime.</span>
          </label>
          {(update.error || publish.error) && <p className="rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">{(update.error ?? publish.error)?.message}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => save(false)} disabled={!valid || update.pending || publish.pending} className="button button-secondary disabled:opacity-50">Save draft</button>
            <button type="button" onClick={() => save(true)} disabled={!valid || update.pending || publish.pending} className="button button-primary disabled:opacity-50">
              {(update.pending || publish.pending) && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Publish
            </button>
          </div>
          <p className="text-right text-xs text-[var(--muted)]">Agents can preview metadata, but paid content remains hidden until purchased.</p>
        </Card>
      )}
    </div>
  );
}
