"use client";

import { useEffect } from "react";
import { Eye, Lock, X } from "lucide-react";
import { atomicForWords, formatUsd } from "@/lib/rubicon/pricing";
import type { Article } from "@/lib/rubicon/types";

export const AGENT_PREVIEW_STORAGE_KEY = "rubicon.agentPreview.seen";
export const AGENT_PREVIEW_EVENT = "rubicon:agent-preview-seen";

type PreviewArticle = Pick<
  Article,
  "title" | "author" | "pricePerWordAtomic" | "maxArticlePriceAtomic" | "totalWords" | "sections" | "sellerAgentConfig"
>;

export function markAgentPreviewSeen() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AGENT_PREVIEW_STORAGE_KEY, "true");
  window.dispatchEvent(new Event(AGENT_PREVIEW_EVENT));
}

export function hasSeenAgentPreview() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AGENT_PREVIEW_STORAGE_KEY) === "true";
}

export function AgentPreviewDialog({
  article,
  open,
  onClose,
}: {
  article: PreviewArticle | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    markAgentPreviewSeen();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || !article) return null;

  const headings = article.sections
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((section) => section.heading)
    .filter(Boolean);
  const summary = previewSummary(article.sellerAgentConfig);
  const estimatedFullPrice = article.maxArticlePriceAtomic ?? atomicForWords(article.pricePerWordAtomic, article.totalWords);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(16,24,40,0.28)] px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="agent-preview-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close preview" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[18px] border border-[var(--line)] bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-5">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[var(--river-pale)] px-3 py-1 text-xs font-semibold text-[var(--river-deep)]">
              <Eye size={14} aria-hidden="true" /> Agent preview
            </div>
            <h2 id="agent-preview-title" className="text-xl font-semibold">{article.title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{article.author}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" aria-label="Close preview">
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-5 p-5">
          <p className="rounded-[14px] bg-[var(--river-pale)] p-4 text-sm leading-6 text-[var(--river-deep)]">
            Agents can use this preview to decide whether to pay. The full article body stays hidden until words are purchased.
          </p>

          {summary && (
            <section>
              <h3 className="text-sm font-semibold">Summary</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{summary}</p>
            </section>
          )}

          <dl className="grid gap-2 rounded-[14px] bg-[var(--surface-muted)] p-4 text-sm sm:grid-cols-2">
            <PreviewRow term="Price per word" value={`${formatUsd(article.pricePerWordAtomic)} / word`} />
            <PreviewRow term={article.maxArticlePriceAtomic ? "Max article price" : "Estimated full price"} value={formatUsd(estimatedFullPrice)} />
            <PreviewRow term="Word count" value={`${article.totalWords.toLocaleString()} words`} />
            <PreviewRow term="Sections" value={headings.length > 0 ? headings.length.toLocaleString() : "Not available"} />
          </dl>

          {headings.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold">Section headings</h3>
              <ul className="mt-2 grid gap-2">
                {headings.slice(0, 8).map((heading) => (
                  <li key={heading} className="rounded-[12px] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--ink)]">
                    {heading}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-[16px] border border-[var(--line)] bg-white">
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 text-sm font-medium">
              <Lock size={15} className="text-[var(--river)]" aria-hidden="true" /> Article body hidden
            </div>
            <div className="grid gap-3 p-4">
              <div className="h-3 w-full rounded-full bg-[var(--surface-muted)]" />
              <div className="h-3 w-11/12 rounded-full bg-[var(--surface-muted)]" />
              <div className="h-3 w-4/5 rounded-full bg-[var(--surface-muted)]" />
              <p className="pt-2 text-sm text-[var(--muted)]">Words are revealed only after payment.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{term}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}

function previewSummary(config: Record<string, unknown> | null): string | null {
  if (!config) return null;
  for (const key of ["summary", "description", "shortDescription"]) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
