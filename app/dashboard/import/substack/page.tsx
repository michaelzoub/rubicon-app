"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter, useSearchParams } from "next/navigation";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, Check, FolderOpen, Info, Loader2, Upload } from "lucide-react";
import { useRubiconClient } from "@/lib/rubicon/auth";
import { Card, PageHeader } from "../../_components/ui";

interface Candidate {
  id: string; title: string; subtitle: string; publishedAt: string | null; audience: string | null;
  wordCount: number; sectionCount: number; recommendedPricePerWordCents: number;
  estimatedMaxPriceCents: number; warning: string | null; importable: boolean;
}

export default function SubstackExportPage() {
  const { getAccessToken } = usePrivy();
  const client = useRubiconClient();
  const router = useRouter();
  const params = useSearchParams();
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [onePrice, setOnePrice] = useState("0.015");
  const username = params.get("username") || (typeof window !== "undefined" ? window.localStorage.getItem("rubicon-substack-username") : "") || "";
  const selectedCount = selected.size;
  const importable = useMemo(() => candidates.filter((candidate) => candidate.importable), [candidates]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setPending(true); setError(null);
    try {
      // Guarantee the creators row exists before the server writes import rows
      // that FK to it — a new writer arriving straight from onboarding may not
      // have one yet, which would otherwise fail with "Could not save the
      // import preview."
      await client?.getCreator();
      const token = await getAccessToken();
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("paths", JSON.stringify(files.map((file) => file.webkitRelativePath || file.name)));
      const response = await fetch("/api/import/substack", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not read this export.");
      const rows = body.candidates as Candidate[];
      setJobId(body.jobId); setCandidates(rows);
      setSelected(new Set(rows.filter((row) => row.importable).map((row) => row.id)));
      setPrices(Object.fromEntries(rows.map((row) => [row.id, row.recommendedPricePerWordCents])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read this export."); }
    finally { setPending(false); }
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) { void upload(Array.from(event.target.files ?? [])); event.target.value = ""; }
  function handleDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }
  function useRecommended() { setPrices(Object.fromEntries(candidates.map((row) => [row.id, row.recommendedPricePerWordCents]))); }
  function applyOnePrice() {
    const price = Number(onePrice);
    if (!(price > 0 && price <= 0.08)) return setError("Enter a price from 0.001¢ to 0.08¢ per word.");
    setPrices((current) => ({ ...current, ...Object.fromEntries(importable.map((row) => [row.id, price])) })); setError(null);
  }
  async function commit() {
    if (!jobId || !selectedCount) return;
    setCommitting(true); setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/import/substack/commit", {
        method: "POST", headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ jobId, substackUsername: username, selections: [...selected].map((id) => ({ id, pricePerWordCents: prices[id] })) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Could not create the drafts.");
      router.push("/dashboard/articles");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the drafts."); }
    finally { setCommitting(false); }
  }

  return (
    <div className="grid gap-6">
      <Link href="/dashboard" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
        <ArrowLeft size={15} aria-hidden="true" /> Back to overview
      </Link>
      <PageHeader title="Import Substack export" description="Upload your Substack export. We’ll only import published posts and keep full article text private." />
      {!jobId && <Card className="p-5 sm:p-6">
        <div onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop}
          className={`grid min-h-64 place-items-center rounded-lg border border-dashed p-8 text-center ${dragging ? "border-[var(--river-deep)] bg-[var(--river-wash)]" : "border-[var(--line)] bg-[var(--surface-muted)]"}`}>
          <div className="grid justify-items-center gap-4">
            {pending ? <Loader2 size={28} className="animate-spin text-[var(--river-deep)]" /> : <Upload size={28} className="text-[var(--river-deep)]" />}
            <div><h2 className="font-semibold">Drop your export here</h2><p className="mt-1 text-sm text-[var(--muted)]">ZIP, or the uncompressed export folder. Maximum 50 MB.</p></div>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => zipRef.current?.click()} disabled={pending} className="button button-primary"><Archive size={16} /> Choose zip</button>
              <button type="button" onClick={() => folderRef.current?.click()} disabled={pending} className="button button-secondary"><FolderOpen size={16} /> Choose folder</button>
            </div>
          </div>
        </div>
        <input ref={zipRef} type="file" accept=".zip,application/zip" onChange={handleFiles} className="sr-only" />
        <input ref={folderRef} type="file" accept=".csv,.html,.htm" multiple onChange={handleFiles} className="sr-only" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
      </Card>}

      {error && <div className="rounded-lg border border-[#e7b8b4] bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">{error}</div>}

      {jobId && <>
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={useRecommended} className="button button-secondary text-sm">Use recommended pricing for all</button>
              <span className="group relative inline-flex items-center"><Info size={16} className="text-[var(--muted)]" aria-label="Pricing information" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-72 -translate-x-1/2 rounded-lg border border-[var(--line)] bg-white p-3 text-xs leading-5 text-[var(--muted)] group-hover:block">Recommended pricing is based on length, structure, links, data/code signals, and whether the post appears to be paid/private.</span>
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1"><span className="text-xs font-medium text-[var(--muted)]">Price per word (¢)</span><input value={onePrice} onChange={(e) => setOnePrice(e.target.value)} inputMode="decimal" className="h-10 w-36 rounded-lg border border-[var(--line)] bg-white px-3 outline-none focus:border-[var(--river-deep)]" /></label>
              <button type="button" onClick={applyOnePrice} className="button button-secondary text-sm">Set one price for all</button>
            </div>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-[var(--line)] bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>
              <th className="p-3"><span className="sr-only">Select</span></th><th className="p-3">Post</th><th className="p-3">Published</th><th className="p-3">Audience</th><th className="p-3 text-right">Words</th><th className="p-3">Price / word</th><th className="p-3 text-right">Max price</th><th className="p-3">Status</th>
            </tr></thead>
            <tbody>{candidates.map((candidate) => <tr key={candidate.id} className="border-b border-[var(--line)] last:border-0">
              <td className="p-3 align-top"><input type="checkbox" checked={selected.has(candidate.id)} disabled={!candidate.importable} onChange={(e) => setSelected((current) => { const next = new Set(current); e.target.checked ? next.add(candidate.id) : next.delete(candidate.id); return next; })} aria-label={`Import ${candidate.title}`} /></td>
              <td className="max-w-xs p-3 align-top"><div className="font-medium">{candidate.title}</div>{candidate.subtitle && <div className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{candidate.subtitle}</div>}</td>
              <td className="p-3 align-top text-[var(--muted)]">{candidate.publishedAt ? new Date(candidate.publishedAt).toLocaleDateString() : "—"}</td>
              <td className="p-3 align-top">{candidate.audience || "—"}</td><td className="p-3 text-right align-top tabular-nums">{candidate.wordCount.toLocaleString()}</td>
              <td className="p-3 align-top"><input type="number" min="0.001" max="0.08" step="0.001" disabled={!candidate.importable} value={prices[candidate.id] ?? candidate.recommendedPricePerWordCents} onChange={(e) => setPrices((current) => ({ ...current, [candidate.id]: Number(e.target.value) }))} className="h-9 w-24 rounded-lg border border-[var(--line)] px-2 tabular-nums outline-none focus:border-[var(--river-deep)]" /><div className="mt-1 text-xs text-[var(--muted)]">Recommended: {candidate.recommendedPricePerWordCents.toFixed(3)}¢</div></td>
              <td className="p-3 text-right align-top tabular-nums">${((candidate.wordCount * (prices[candidate.id] ?? candidate.recommendedPricePerWordCents)) / 100).toFixed(2)}</td>
              <td className="p-3 align-top">{candidate.warning ? <span className="text-[#8d2f2d]">{candidate.warning}</span> : <span className="inline-flex items-center gap-1 text-[#165c3e]"><Check size={14} /> Ready</span>}</td>
            </tr>)}</tbody>
          </table></div>
        </Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-[var(--muted)]">Agent only pays for the words it reads.</p><button type="button" onClick={commit} disabled={!selectedCount || committing} className="button button-primary disabled:opacity-50">{committing ? <><Loader2 size={16} className="animate-spin" /> Creating drafts…</> : `Import selected posts (${selectedCount})`}</button></div>
      </>}
    </div>
  );
}
