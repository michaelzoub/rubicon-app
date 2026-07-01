"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Link2, Loader2 } from "lucide-react";
import { detectImportSource } from "@/lib/import/detect";
import type { ImportResult } from "@/lib/import/types";
import { Card, PageHeader } from "../../_components/ui";
import { stashImport } from "../_import-handoff";

type ImportErrorBody = { error?: { code?: string; message?: string } };

const inputClass =
  "h-11 w-full rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]";

const sourceLabels: Record<string, string> = {
  substack: "Substack post detected",
  x: "X / Twitter post detected",
};

export default function ImportFromUrlPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Instant, client-side source hint so creators know a URL is recognized
  // before they submit. The server re-validates and is authoritative.
  const detected = useMemo(() => (url.trim() ? detectImportSource(url.trim()) : null), [url]);

  async function runImport() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ImportErrorBody;
        setError(messageForError(res.status, body.error?.code, body.error?.message));
        return;
      }

      const result = (await res.json()) as ImportResult;
      stashImport(result);
      router.push("/dashboard/articles/new?imported=1");
    } catch {
      setError("Couldn't reach the import service. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = url.trim() !== "" && detected !== "unsupported" && !pending;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Import from URL"
        description="We only import the article you choose. Nothing is posted or published automatically."
      />

      <Card className="p-6">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Post URL</span>
          <div className="flex items-center rounded-lg bg-[var(--surface-muted)] focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--river-line)]">
            <span className="pl-3 text-[var(--muted)]">
              <Link2 size={16} aria-hidden="true" />
            </span>
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) runImport();
              }}
              placeholder="https://author.substack.com/p/your-post  or  https://x.com/handle/status/123"
              className={`${inputClass} bg-transparent`}
              inputMode="url"
              autoFocus
            />
          </div>
        </label>

        {url.trim() !== "" && (
          <p className="mt-3 text-sm">
            {detected && detected !== "unsupported" ? (
              <span className="text-[#165c3e]">{sourceLabels[detected]}</span>
            ) : (
              <span className="text-[var(--muted)]">
                Paste a full Substack (<code className="mono">/p/…</code>) or X (
                <code className="mono">/status/…</code>) post URL.
              </span>
            )}
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">{error}</div>
        )}

        <div className="mt-6 flex items-center justify-between pt-2">
          <Link href="/dashboard/articles/new" className="button button-secondary text-sm">
            <ArrowLeft size={16} aria-hidden="true" /> Write manually instead
          </Link>
          <button
            type="button"
            onClick={runImport}
            disabled={!canSubmit}
            className="button button-primary disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Importing…
              </>
            ) : (
              <>
                Import <ArrowRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </Card>

      <Card className="p-6 text-sm leading-6 text-[var(--muted)]">
        <h2 className="text-sm font-semibold text-[var(--ink)]">What gets imported</h2>
        <ul className="mt-2 grid gap-1.5">
          <li>Public title, subtitle, author, publish date, and canonical link.</li>
          <li>The readable public body, converted to clean Markdown and split into sections.</li>
          <li>
            Paywalled Substack posts import the public preview only — you'll be prompted to paste the
            gated body before publishing.
          </li>
          <li>X posts import the public text and media metadata. Nothing is published automatically.</li>
        </ul>
      </Card>
    </div>
  );
}

function messageForError(status: number, code?: string, message?: string): string {
  switch (code) {
    case "invalid_url":
      return message || "That doesn't look like a valid URL.";
    case "unsupported_source":
      return "We can only import from Substack or X/Twitter URLs right now.";
    case "blocked_url":
      return "That URL can't be imported for security reasons.";
    case "rate_limited":
      return "The source is rate-limiting requests right now. Wait a moment and try again.";
    case "timeout":
      return "The import timed out. The source may be slow — try again.";
    case "too_large":
      return "That page is too large to import.";
    case "unavailable":
      return message || "That content is private or unavailable. Only the writer can provide gated content.";
    default:
      if (status === 429) return "Too many import requests. Try again shortly.";
      return message || "Couldn't import that URL. Try again, or write the article manually.";
  }
}
