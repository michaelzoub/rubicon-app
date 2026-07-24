"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Check,
  FileText,
  Link2,
  PenLine,
  Puzzle,
} from "lucide-react";
import { useRubiconMutation, useRubiconQuery } from "@/lib/rubicon/hooks";
import {
  atomicForWords,
  formatUsd,
  usdToAtomic,
} from "@/lib/rubicon/pricing";
import { parseSections } from "@/lib/rubicon/sections";
import type { ArticleAccessMode, ArticleSourceInput, ArticleSectionInput } from "@/lib/rubicon/types";
import { isStolenXContent, normalizeHandle } from "@/lib/articles/ownership";
import { OTHER_IMPORT_GROUP, PLATFORM_IMPORT_OPTIONS } from "@/lib/import/options";
import { MarkdownEditor } from "../../_components/markdown-editor";
import { DashboardDialog } from "../../_components/overlays";
import { Card, formatDate, PageHeader, SafetyWarning, shortWallet, WalletStatePill } from "../../_components/ui";
import { takeImport } from "../_import-handoff";
import { SuccessCelebration, useSuccessCelebration } from "../../_components/success-celebration";

const PARTIAL_IMPORT_NOTICE =
  "Only public preview content was imported. Paste the full gated body below to make it available to agents.";

interface EditableSection {
  title: string;
  wordCount: number;
}

/** Imported provenance held in the wizard until the draft is saved. */
type ImportedSource = ArticleSourceInput & {
  importedAt: string;
  initialContent: string;
};

function isStillPartial(source: ImportedSource, content: string): boolean {
  if (!source.isPartial) return false;
  if (source.platform === "x") return content.trim() === source.initialContent.trim();
  return content.trim().length < 600;
}

const steps = ["Add your article", "Review sections", "Choose pricing", "Publish"] as const;

export default function NewArticlePage() {
  const router = useRouter();
  const creator = useRubiconQuery((c) => c.getCreator(), [], { queryKey: ["creator"] });
  const wallet = useRubiconQuery((c) => c.getWallet(), [], { queryKey: ["wallet"] });
  const createArticle = useRubiconMutation((c, ...args: Parameters<typeof c.createArticle>) => c.createArticle(...args));
  const publishArticle = useRubiconMutation((c, id: string) => c.publishArticle(id));

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [sections, setSections] = useState<EditableSection[]>([]);
  const lastParsed = useRef<string>("");

  const [pricePerWord, setPricePerWord] = useState("");
  const [accessMode, setAccessMode] = useState<ArticleAccessMode>("paid");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [source, setSource] = useState<ImportedSource | null>(null);
  const [published, setPublished] = useState(false);
  const { celebrationKey, celebrating, markCompletion } = useSuccessCelebration();

  // Pull in a stashed "Import from URL" result once, on mount. This is the only
  // place a draft is assembled from imported data — saving still goes through
  // the normal create flow, so nothing is persisted without review.
  const appliedImport = useRef(false);
  useEffect(() => {
    if (appliedImport.current) return;
    appliedImport.current = true;
    const imported = takeImport();
    if (!imported) return;

    if (imported.title) setTitle(imported.title);
    if (imported.authorName) setAuthor(imported.authorName);
    const initialBody = imported.body ?? imported.previewText ?? "";
    if (initialBody) {
      setContent(initialBody);
      lastParsed.current = "";
    }
    setSource({
      platform: imported.sourcePlatform,
      url: imported.sourceUrl,
      authorName: imported.authorName,
      authorHandle: imported.authorHandle,
      publishedAt: imported.publishedAt,
      warnings: imported.warnings,
      isPartial: imported.isPartial,
      importedAt: new Date().toISOString(),
      initialContent: initialBody,
    });
  }, []);

  // Prefill the schema-required author from the creator display name once,
  // unless an import already supplied one.
  const prefilledAuthor = useRef(false);
  useEffect(() => {
    if (prefilledAuthor.current) return;
    if (source) {
      prefilledAuthor.current = true;
      return;
    }
    const displayName = creator.data?.displayName;
    if (!displayName) return;
    setAuthor(displayName);
    prefilledAuthor.current = true;
  }, [creator.data?.displayName, source]);

  function enterReview() {
    if (content !== lastParsed.current) {
      const parsed = parseSections(content);
      setSections(parsed.map((s) => ({ title: s.title, wordCount: s.wordCount })));
      lastParsed.current = content;
    }
    setStep(1);
  }

  // Content-ownership guard: an imported X post may only be published by the
  // account that wrote it. A confirmed handle/username mismatch blocks every
  // path that would put this content live.
  const ownershipMismatch = isStolenXContent(source, creator.data?.username);
  const safetyNotice = ownershipMismatch ? (
    <SafetyWarning>
      This post was written by <strong>@{normalizeHandle(source?.authorHandle)}</strong>, which doesn’t
      match your account <strong>@{normalizeHandle(creator.data?.username)}</strong>. You can’t publish or
      save someone else’s X post as your own — that would be stealing their content.
    </SafetyWarning>
  ) : null;

  const isFree = accessMode === "free";
  const includedWords = sections.reduce((sum, s) => sum + s.wordCount, 0);
  const atomicPerWord = isFree ? "0" : pricePerWord ? usdToAtomic(Number(pricePerWord)) : "0";
  const estFullPrice = atomicForWords(atomicPerWord, includedWords);

  function buildInput() {
    const sectionInput: ArticleSectionInput[] = sections.map((s, i) => ({
      heading: s.title,
      ordinal: i,
    }));
    return {
      title: title.trim(),
      author: author.trim(),
      body: content,
      sections: sectionInput,
      accessMode,
      pricePerWordAtomic: atomicPerWord,
      maxArticlePriceAtomic: null,
      source: source
        ? {
            platform: source.platform,
            url: source.url,
            authorName: source.authorName,
            authorHandle: source.authorHandle,
            publishedAt: source.publishedAt,
            warnings: source.warnings,
            // Once the creator has pasted a real body over a preview-only
            // import, the draft is no longer partial.
            isPartial: isStillPartial(source, content),
          }
        : null,
    };
  }

  async function submit(publish: boolean) {
    setSubmitError(null);
    setSavedDraftId(null);
    if (ownershipMismatch) {
      setSubmitError(
        "This imported X post belongs to another account, so it can’t be saved or published here.",
      );
      return;
    }
    try {
      const article = await createArticle.run(buildInput());
      if (publish) {
        try {
          await publishArticle.run(article.id);
          setPublished(true);
          markCompletion("success");
        } catch (err) {
          setSavedDraftId(article.id);
          setSubmitError(
            err instanceof Error
              ? `Draft saved, but publishing failed: ${err.message}`
              : "Draft saved, but publishing failed. Try publishing it from the article page.",
          );
          return;
        }
      }
      if (publish) await new Promise((resolve) => window.setTimeout(resolve, 850));
      router.push(`/dashboard/articles/${article.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save the article.");
    }
  }

  const submitting = createArticle.pending || publishArticle.pending;

  return (
    <div key={step} className={step === 0 ? "article-compose-page" : "dashboard-fade-in grid gap-4"}>
      {step === 0 ? null : (
        <>
          <PageHeader title="New article" description="Saved as a draft first. Nothing goes live until you publish." />
          <Stepper
            current={step}
            onSelect={(target) => {
              if (target <= step) setStep(target);
            }}
          />
        </>
      )}

      {step === 0 && (
        <StepAddArticle
          title={title}
          author={author}
          content={content}
          source={source}
          ownershipMismatch={ownershipMismatch}
          safetyNotice={safetyNotice}
          onTitle={setTitle}
          onAuthor={setAuthor}
          onContent={setContent}
          onNext={enterReview}
        />
      )}

      {step === 1 && (
        <StepReviewSections
          sections={sections}
          onChange={setSections}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <StepPricing
          accessMode={accessMode}
          pricePerWord={pricePerWord}
          atomicPerWord={atomicPerWord}
          includedWords={includedWords}
          estFullPrice={estFullPrice}
          onAccessMode={setAccessMode}
          onPrice={setPricePerWord}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <StepPublish
          title={title}
          accessMode={accessMode}
          includedWords={includedWords}
          sectionCount={sections.length}
          atomicPerWord={atomicPerWord}
          estFullPrice={estFullPrice}
          walletAddress={wallet.data?.address ?? null}
          walletVerified={wallet.data?.verified ?? false}
          submitting={submitting}
          error={submitError}
          savedDraftId={savedDraftId}
          published={published}
          celebrating={celebrating}
          celebrationKey={celebrationKey}
          ownershipMismatch={ownershipMismatch}
          safetyNotice={safetyNotice}
          onBack={() => setStep(2)}
          onSaveDraft={() => submit(false)}
          onPublish={() => submit(true)}
        />
      )}
    </div>
  );
}

function Stepper({ current, onSelect }: { current: number; onSelect: (step: number) => void }) {
  return (
    <ol className="article-stepper flex flex-wrap gap-1.5" aria-label="Article publishing progress">
      {steps.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <li key={label}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              disabled={i > current}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                active
                  ? "border-[var(--ink)] bg-white text-[var(--ink)]"
                  : done
                    ? "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                    : "border-transparent bg-[var(--surface-muted)] text-[var(--muted)] disabled:cursor-not-allowed"
              }`}
            >
              <span className="mono text-xs text-[var(--muted)]">{i + 1}</span>
              <span>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

const inputClass =
  "h-11 rounded-lg bg-[var(--surface-muted)] px-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]";

const SOURCE_LABELS: Record<ImportedSource["platform"], string> = {
  substack: "Substack",
  x: "X / Twitter",
  artemis: "Artemis",
};

function ImportedSourceBanner({ source, partial }: { source: ImportedSource; partial: boolean }) {
  const status = partial
    ? source.platform === "x"
      ? "Text needed"
      : "Partial preview"
    : "Imported";
  const author =
    source.authorName && source.authorHandle
      ? `${source.authorName} (${source.authorHandle})`
      : source.authorName ?? source.authorHandle ?? "Unknown";
  return (
    <div className="rounded-xl bg-[var(--river-pale)] p-4 text-sm text-[var(--river-deep)]">
      <div className="flex items-center gap-2 font-medium">
        <Link2 size={15} aria-hidden="true" />
        Imported from {SOURCE_LABELS[source.platform]}
        <span className="rounded-full bg-white/60 px-2 py-0.5 text-[0.68rem]">
          {status}
        </span>
      </div>
      <dl className="mt-3 grid gap-1.5 text-[var(--ink)] sm:grid-cols-2">
        <SourceRow term="Source">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="truncate underline underline-offset-2">
            {source.url}
          </a>
        </SourceRow>
        <SourceRow term="Original author">
          {author}
        </SourceRow>
        <SourceRow term="Published">{source.publishedAt ? formatDate(source.publishedAt) : "—"}</SourceRow>
        <SourceRow term="Imported">{formatDate(source.importedAt)}</SourceRow>
      </dl>
    </div>
  );
}

function SourceRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-[var(--muted)]">{term}:</dt>
      <dd className="min-w-0 truncate font-medium">{children}</dd>
    </div>
  );
}

function StepAddArticle({
  title,
  author,
  content,
  source,
  ownershipMismatch,
  safetyNotice,
  onTitle,
  onAuthor,
  onContent,
  onNext,
}: {
  title: string;
  author: string;
  content: string;
  source: ImportedSource | null;
  ownershipMismatch: boolean;
  safetyNotice: React.ReactNode;
  onTitle: (v: string) => void;
  onAuthor: (v: string) => void;
  onContent: (v: string) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onContent(text);
    if (!title) onTitle(file.name.replace(/\.(md|markdown|txt)$/i, ""));
  }

  const ready = title.trim() && author.trim() && content.trim() && !ownershipMismatch;
  const stillPartial = source ? isStillPartial(source, content) : false;

  return (
    <div className="substack-compose">
      <header className="substack-compose-topbar">
        <Link href="/dashboard/articles" className="substack-compose-back" aria-label="Back to articles">
          <ArrowLeft size={21} aria-hidden="true" />
        </Link>
        <div className="substack-compose-status">
          <span aria-hidden="true" />
          Draft
        </div>
        <div className="substack-compose-actions">
          <button type="button" className="substack-compose-preview" disabled>
            Preview
          </button>
          <button type="button" onClick={onNext} disabled={!ready} className="substack-compose-continue">
            Continue
          </button>
        </div>
      </header>

      <main className="substack-compose-main">
        {safetyNotice && <div className="mb-7">{safetyNotice}</div>}
        {source && (
          <div className="mb-7 grid gap-3">
            <ImportedSourceBanner source={source} partial={stillPartial} />
            {stillPartial && (
              <div className="rounded-lg bg-[#fdf6ec] px-4 py-3 text-sm leading-5 text-[#7b4e12]">
                {/* Prefer the importer's source-specific guidance; fall back to the
                    generic preview-only notice when it didn't supply one. */}
                {source.warnings[0] ?? PARTIAL_IMPORT_NOTICE}
              </div>
            )}
          </div>
        )}

        <section className="grid gap-3" aria-label="Import article">
          <span className="text-sm font-semibold">{OTHER_IMPORT_GROUP.heading}</span>
          <button
            type="button"
            onClick={() => setImportPickerOpen(true)}
            className="button button-primary w-fit text-sm"
            aria-haspopup="dialog"
            aria-expanded={importPickerOpen}
          >
            <FileText size={15} aria-hidden="true" /> Choose an import source
          </button>
        </section>

        <input ref={fileRef} type="file" accept=".md,.markdown,.txt" onChange={onUpload} className="hidden" />

        <ImportSourcePicker
          open={importPickerOpen}
          onClose={() => setImportPickerOpen(false)}
          onSelectMarkdown={() => {
            setImportPickerOpen(false);
            fileRef.current?.click();
          }}
        />

        <div className="substack-compose-divider" aria-hidden="true">
          <span />
          <span>or</span>
          <span />
        </div>

        <section className="substack-manual-editor" aria-labelledby="manual-writing-title">
          <div className="substack-manual-editor-label">
            <PenLine size={15} aria-hidden="true" />
            <span id="manual-writing-title">Write manually</span>
          </div>
          <div className="substack-compose-meta">
            <textarea
              ref={titleRef}
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder="Title"
              rows={1}
              maxLength={120}
              className="substack-title-input"
            />
            <input
              value={author}
              onChange={(e) => onAuthor(e.target.value)}
              placeholder="Add author..."
              className="substack-subtitle-input"
            />
          </div>
          <MarkdownEditor
            value={content}
            onChange={onContent}
            placeholder="Start writing..."
          />
        </section>
      </main>
    </div>
  );
}

function ImportSourcePicker({
  open,
  onClose,
  onSelectMarkdown,
}: {
  open: boolean;
  onClose: () => void;
  onSelectMarkdown: () => void;
}) {
  const cardClass =
    "relative grid min-h-36 place-content-center justify-items-center gap-3 rounded-lg border-2 border-transparent bg-[var(--surface-muted)] p-4 text-center transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-[var(--hovered)] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]";

  return (
    <DashboardDialog open={open} onClose={onClose} labelledBy="import-source-title" className="max-w-2xl p-6 sm:p-8">
      <div className="text-center">
        <p className="text-xs font-medium text-[var(--quiet)]">Import an existing article</p>
        <h2 id="import-source-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          Where would you like to import from?
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Choose a source to continue with its import flow.</p>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {PLATFORM_IMPORT_OPTIONS.map((option) => (
          <Link key={option.id} href={option.href} onClick={onClose} className={cardClass}>
            {option.logoSrc && <Image src={option.logoSrc} alt="" width={40} height={40} className="rounded-md" />}
            <span className="text-sm font-medium">{option.platformLabel}</span>
          </Link>
        ))}
        <Link href={OTHER_IMPORT_GROUP.options[0].href} onClick={onClose} className={cardClass}>
          <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-[var(--muted)]" aria-hidden="true">
            <Link2 size={20} strokeWidth={1.75} />
          </span>
          <span className="text-sm font-medium">Import URL</span>
        </Link>
        <button type="button" onClick={onSelectMarkdown} className={cardClass}>
          <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-[var(--muted)]" aria-hidden="true">
            <FileText size={20} strokeWidth={1.75} />
          </span>
          <span className="text-sm font-medium">Import Markdown</span>
        </button>
        <a
          href="https://chromewebstore.google.com/detail/rubicon/allmdpfkdgdcjfgeijembjfpnkfpocab"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className={cardClass}
        >
          <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-[var(--muted)]" aria-hidden="true">
            <Puzzle size={20} strokeWidth={1.75} />
          </span>
          <span className="text-sm font-medium">Chrome extension</span>
        </a>
      </div>

      <button type="button" onClick={onClose} className="button button-secondary mt-6 w-full justify-center text-sm">
        Cancel
      </button>
    </DashboardDialog>
  );
}

function StepReviewSections({
  sections,
  onChange,
  onBack,
  onNext,
}: {
  sections: EditableSection[];
  onChange: (s: EditableSection[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  function update(index: number, patch: Partial<EditableSection>) {
    onChange(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function move(index: number, dir: -1 | 1) {
    const next = [...sections];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Sections agents can navigate</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Section titles help your seller agent guide buyers without revealing unpaid text. Rename, reorder, or exclude any section.
      </p>

      {sections.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-[var(--line)] bg-white p-5 text-center text-sm text-[var(--muted)]">
          No headers or subheaders detected. Your article will be offered as a single section. Use Header or Subheader to split it.
        </p>
      ) : (
        <ul className="mt-5 overflow-hidden rounded-lg border border-[var(--line)] bg-white divide-y divide-[var(--line)]">
          {sections.map((section, index) => (
            <li
              key={index}
              className="grid gap-3 p-3.5 sm:grid-cols-[auto_1fr] sm:items-center"
            >
              <div className="flex flex-col">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30" aria-label="Move up">
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === sections.length - 1} className="text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-30" aria-label="Move down">
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="min-w-0">
                <input
                  value={section.title}
                  onChange={(e) => update(index, { title: e.target.value })}
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 font-medium outline-none transition focus:border-[var(--river-line)] focus:bg-white focus:ring-2 focus:ring-[var(--river-line)]"
                />
                <div className="mt-1 text-xs text-[var(--muted)]">{section.wordCount.toLocaleString()} words</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex justify-between pt-2">
        <button type="button" onClick={onBack} className="button button-secondary">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <button type="button" onClick={onNext} className="button button-primary">
          Choose pricing <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

function StepPricing({
  accessMode,
  pricePerWord,
  atomicPerWord,
  includedWords,
  estFullPrice,
  onAccessMode,
  onPrice,
  onBack,
  onNext,
}: {
  accessMode: ArticleAccessMode;
  pricePerWord: string;
  atomicPerWord: string;
  includedWords: number;
  estFullPrice: string;
  onAccessMode: (v: ArticleAccessMode) => void;
  onPrice: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const isFree = accessMode === "free";
  // Free articles need no price; paid articles need a positive one.
  const valid = isFree || Number(atomicPerWord) > 0;
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Choose access</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Offer it free to any agent, or charge for exactly the words they read.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Article access">
        <AccessOption
          selected={!isFree}
          onSelect={() => onAccessMode("paid")}
          title="Paid"
          description="Agents pay per word. Requires a verified wallet to publish."
          testid="access-paid"
        />
        <AccessOption
          selected={isFree}
          onSelect={() => onAccessMode("free")}
          title="Free"
          description="Any agent can read it at no charge. No wallet needed."
          testid="access-free"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-5">
          <Field label="Price per word" hint="Agents pay only for the words they reveal. You can update pricing anytime.">
            <div className={`flex h-11 items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 transition focus-within:border-[var(--river-line)] focus-within:ring-2 focus-within:ring-[var(--river-line)] ${isFree ? "opacity-40" : ""}`}>
              <span className="shrink-0 text-[var(--muted)]">$</span>
              <input
                value={isFree ? "" : pricePerWord}
                onChange={(e) => onPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder={isFree ? "Free" : "0.0001"}
                disabled={isFree}
                className="h-full min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-[var(--muted)]"
              />
            </div>
          </Field>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-4">
          <div className="text-xs font-medium text-[var(--muted)]">
            {isFree ? "Access preview" : "Pricing preview"}
          </div>
          {isFree ? (
            <dl className="mt-3 divide-y divide-[var(--line)] text-sm">
              <Row term="Access" value="Free for all agents" />
              <Row term="Price per word" value="$0.00" />
              <Row term="Earnings" value="—" />
            </dl>
          ) : (
            <dl className="mt-3 divide-y divide-[var(--line)] text-sm">
              <Row term="Price per word" value={formatUsd(atomicPerWord)} />
              <Row term="Estimated full-article price" value={`${formatUsd(estFullPrice)}`} />
              <Row term="Earnings for 100 words" value={formatUsd(atomicForWords(atomicPerWord, 100))} />
              <Row term="Earnings for 1,000 words" value={formatUsd(atomicForWords(atomicPerWord, 1000))} />
              <Row term="Rubicon platform fee" value="0%" />
            </dl>
          )}
          <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs leading-5 text-[var(--muted)]">
            {isFree
              ? "Free articles are delivered in full to any agent and earn nothing. You can switch to paid later."
              : "Estimates use a preview word count. Billing always reflects the exact words an agent reads, measured by Rubicon."}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-between pt-2">
        <button type="button" onClick={onBack} className="button button-secondary">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <button type="button" onClick={onNext} disabled={!valid} className="button button-primary disabled:opacity-50">
          Review <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

function AccessOption({
  selected,
  onSelect,
  title,
  description,
  testid,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testid}
      onClick={onSelect}
      className={`article-access-option grid gap-1 rounded-lg border p-4 text-left transition ${
        selected
          ? "border-[var(--river)] bg-[var(--river-pale)]"
          : "border-[var(--line)] bg-white hover:border-[var(--river-line)]"
      }`}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs leading-5 text-[var(--muted)]">{description}</span>
    </button>
  );
}

function StepPublish({
  title,
  accessMode,
  includedWords,
  sectionCount,
  atomicPerWord,
  estFullPrice,
  walletAddress,
  walletVerified,
  submitting,
  error,
  savedDraftId,
  published,
  celebrating,
  celebrationKey,
  ownershipMismatch,
  safetyNotice,
  onBack,
  onSaveDraft,
  onPublish,
}: {
  title: string;
  accessMode: ArticleAccessMode;
  includedWords: number;
  sectionCount: number;
  atomicPerWord: string;
  estFullPrice: string;
  walletAddress: string | null;
  walletVerified: boolean;
  submitting: boolean;
  error: string | null;
  savedDraftId: string | null;
  published: boolean;
  celebrating: boolean;
  celebrationKey: number;
  ownershipMismatch: boolean;
  safetyNotice: React.ReactNode;
  onBack: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const isFree = accessMode === "free";
  // Only paid articles need a verified wallet to publish; free articles pay out
  // nothing, so a missing/unverified wallet never blocks them.
  const walletBlocksPublish = !isFree && !walletVerified;
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Review and publish</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">Confirm the details below. You can save a draft or publish it live to agents.</p>

      {safetyNotice && <div className="mt-5">{safetyNotice}</div>}

      <dl className="mt-5 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-white px-4 text-sm">
        <Row term="Article title" value={title || "Untitled"} />
        <Row term="Access" value={isFree ? "Free for all agents" : "Paid per word"} />
        <Row term="Word count" value={includedWords.toLocaleString()} />
        <Row term="Sections" value={sectionCount.toLocaleString()} />
        {!isFree && <Row term="Price per word" value={formatUsd(atomicPerWord)} />}
        {!isFree && <Row term="Estimated full price" value={formatUsd(estFullPrice)} />}
        {!isFree && (
          <Row
            term="Receiving wallet"
            value={
              <span className="flex items-center gap-2">
                <span className="mono">{shortWallet(walletAddress)}</span>
                {walletAddress && <WalletStatePill verified={walletVerified} />}
              </span>
            }
          />
        )}
        <Row term="Platform fee" value="0%" />
        <Row term="Article status" value="Draft until published" />
      </dl>

      {walletBlocksPublish && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--river-line)] bg-[var(--river-pale)] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>Finish creator settings before publishing a paid article.</p>
          <Link href="/dashboard/settings#payout-connection" className="button button-primary shrink-0 text-sm">
            Finish creator settings <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#8d2f2d]">
          <p>{error}</p>
          {savedDraftId && (
            <Link href={`/dashboard/articles/${savedDraftId}`} className="mt-2 inline-flex font-medium underline underline-offset-2">
              Open saved draft
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-2">
        <button type="button" onClick={onBack} className="button button-secondary">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onSaveDraft} disabled={submitting || ownershipMismatch} className="button button-secondary disabled:opacity-50">
            Save draft
          </button>
          <div className="relative overflow-visible">
            <SuccessCelebration active={celebrating} celebrationKey={celebrationKey} />
            <motion.button
              type="button"
              onClick={onPublish}
              disabled={submitting || walletBlocksPublish || ownershipMismatch || published}
              className="button button-primary relative disabled:opacity-50"
              animate={!reduceMotion && published ? { transform: ["scale(1)", "scale(1.045)", "scale(1)"] } : { transform: "scale(1)" }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              {published ? <><Check size={16} aria-hidden="true" /> Published</> : submitting ? "Publishing…" : "Publish article"}
            </motion.button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-right text-xs text-[var(--muted)]">
        {isFree
          ? "Free articles are delivered in full to any agent that asks."
          : "Agents can preview metadata, but paid content remains hidden until purchased."}
      </p>
    </Card>
  );
}

function Row({ term, value, hint }: { term: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2.5">
      <dt className="min-w-0 text-[var(--muted)]">{term}</dt>
      <dd className="min-w-0 break-words text-right font-medium">
        {value}
        {hint && <span className="ml-2 text-xs font-normal text-[var(--muted)]">{hint}</span>}
      </dd>
    </div>
  );
}
