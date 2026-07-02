"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Loader2, Mail, MousePointer2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseSubstackSubdomain } from "@/lib/import/substack-subdomain";
import { useRubiconClient } from "@/lib/rubicon/auth";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const SEEN_KEY = "rubicon-substack-onboarding-seen";
const SUBDOMAIN_KEY = "rubicon-substack-subdomain";
/** Legacy key the standalone import page still reads. */
const LEGACY_USERNAME_KEY = "rubicon-substack-username";

const IMPORT_EMAIL = "micacao15@gmail.com";
const PRICE_MIN = 0.0001;
const PRICE_MAX = 0.02;
const PRICE_STEP = 0.0001;
const PRICE_DEFAULT = 0.001;

/** Clamp a dollar price into the slider's range, snapped to its step. */
function snapPrice(usd: number): number {
  const clamped = Math.min(PRICE_MAX, Math.max(PRICE_MIN, usd));
  return Math.round(clamped / PRICE_STEP) * PRICE_STEP;
}

type Step = "welcome" | "connect" | "import" | "price";

interface LookupState {
  status: "idle" | "checking" | "found" | "missing";
  subdomain: string | null;
  name?: string | null;
  logoUrl?: string | null;
}

interface Suggestion {
  subdomain: string;
  name: string;
  authorName: string | null;
  logoUrl: string | null;
  subscribers: string | null;
}

interface ArchivePost {
  id: string;
  title: string;
  wordCount: number;
}

interface ArchiveStats {
  jobId: string;
  postCount: number;
  totalWordCount: number;
  averageWordCount: number;
  /** Word-weighted mean of the per-post recommendations, in dollars per word. */
  recommendedPriceUsd: number;
  posts: ArchivePost[];
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; percent: number }
  | { phase: "parsing" }
  | { phase: "error"; message: string };

/**
 * First-paint surface while auth and creator state resolve. It deliberately
 * matches the opening onboarding frame so a new writer never sees dashboard
 * chrome before the flow begins.
 */
export function OnboardingEntryScreen() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-white" role="status" aria-label="Loading Rubicon">
      <Image className="animate-pulse" src="/w_logo.png" alt="" width={52} height={52} priority />
    </div>
  );
}

export function SubstackOnboardingDialog({
  shouldOpen,
  forceOpen = false,
  demo = false,
}: {
  shouldOpen: boolean;
  forceOpen?: boolean;
  /** Self-driving playback for the marketing demo video: types a username and
   * presses Continue with a cursor, and never navigates away. */
  demo?: boolean;
}) {
  const router = useRouter();
  const client = useRubiconClient();
  const { getAccessToken } = usePrivy();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(() => {
    if (!shouldOpen) return false;
    if (forceOpen || demo) return true;
    return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY) !== "1";
  });
  const [step, setStep] = useState<Step>("welcome");

  // Step 1 — connect
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle", subdomain: null });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchAbortRef = useRef<AbortController | null>(null);
  /** Set when a suggestion is picked so the resulting input change doesn't reopen the dropdown. */
  const skipSearchRef = useRef(false);

  // Step 2 — import archive
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 3 — price
  const [archive, setArchive] = useState<ArchiveStats | null>(null);
  const [price, setPrice] = useState(PRICE_DEFAULT);
  /** Raw text in the price readout while it's being typed in; null shows the
   * canonical price. Agents (and keyboards) set the number field, sliders and
   * the recommended shortcut clear it. */
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Raw per-post price inputs; empty/invalid entries fall back to the global price. */
  const [postPrices, setPostPrices] = useState<Record<string, string>>({});
  const [goingLive, setGoingLive] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  function effectivePostPrice(postId: string): number {
    const raw = postPrices[postId];
    if (raw === undefined || raw.trim() === "") return price;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(PRICE_MAX, Math.max(PRICE_MIN, parsed)) : price;
  }

  const [demoPressing, setDemoPressing] = useState(false);
  const navigatingRef = useRef(false);

  useEffect(() => {
    const seen = window.localStorage.getItem(SEEN_KEY) === "1";
    if (!shouldOpen || (!forceOpen && seen)) return;
    // A saved subdomain means step 1 already finished in an earlier session —
    // exports take minutes to generate, so writers routinely leave and return.
    // forceOpen (/dashboard-newuser) always previews the flow from the top.
    const saved = demo || forceOpen ? null : window.localStorage.getItem(SUBDOMAIN_KEY);
    if (saved) {
      setSubdomain(saved);
      setStep("import");
    } else {
      setStep("welcome");
    }
    setOpen(true);
  }, [demo, forceOpen, shouldOpen]);

  useEffect(() => {
    if (!open || step !== "welcome") return;
    const timer = window.setTimeout(() => setStep("connect"), reduceMotion ? 500 : 2600);
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion, step]);

  // Server state is authoritative for resumption: a parsed-but-unpriced export
  // jumps straight to step 3, a connected publication to step 2. Never on
  // /dashboard-newuser (forceOpen), which exists to walk the flow from step 1,
  // and never twice — a late response must not override back-navigation.
  const resumeCheckedRef = useRef(false);
  useEffect(() => {
    if (!open || demo || forceOpen || resumeCheckedRef.current) return;
    resumeCheckedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch("/api/substack/onboarding", { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const body = await response.json() as {
          subdomain: string | null;
          pendingArchive: ArchiveStats | null;
        };
        if (cancelled || !body.subdomain) return;
        setSubdomain(body.subdomain);
        window.localStorage.setItem(SUBDOMAIN_KEY, body.subdomain);
        if (body.pendingArchive) {
          setArchive(body.pendingArchive);
          setStep("price");
        } else {
          setStep((current) => (current === "welcome" || current === "connect" ? "import" : current));
        }
      } catch {
        // Resume is best-effort; the writer can always redo a step.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo, forceOpen, getAccessToken, open]);

  // Demo playback: once the connect step is on screen, type the username, then
  // animate a cursor press on Continue. The outer video engine loops the scene.
  useEffect(() => {
    if (!demo || step !== "connect") return;
    const target = "marachen";
    setInput("");
    setDemoPressing(false);
    let typer = 0;
    let pressTimer = 0;
    let index = 0;
    const startTimer = window.setTimeout(() => {
      typer = window.setInterval(() => {
        index += 1;
        setInput(target.slice(0, index));
        if (index >= target.length) {
          window.clearInterval(typer);
          pressTimer = window.setTimeout(() => setDemoPressing(true), 750);
        }
      }, 150);
    }, 650);
    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(typer);
      window.clearTimeout(pressTimer);
    };
  }, [demo, step]);

  // Parse on input, debounced, then validate server-side. Feedback only ever
  // appears after the debounce settles, never mid-keystroke.
  useEffect(() => {
    if (!open || step !== "connect") return;
    if (!input.trim()) {
      setLookup({ status: "idle", subdomain: null });
      return;
    }
    setLookup((current) => (current.status === "found" && current.subdomain === parseSubstackSubdomain(input) ? current : { status: "checking", subdomain: null }));
    const timer = window.setTimeout(async () => {
      const candidate = parseSubstackSubdomain(input);
      if (!candidate) {
        setLookup({ status: "missing", subdomain: null });
        return;
      }
      if (demo) {
        setLookup({ status: "found", subdomain: candidate });
        return;
      }
      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;
      try {
        const response = await fetch(`/api/substack/lookup?subdomain=${encodeURIComponent(candidate)}`, { signal: controller.signal });
        const body = await response.json().catch(() => null) as { exists?: boolean; subdomain?: string; name?: string; logoUrl?: string } | null;
        if (controller.signal.aborted) return;
        if (body?.exists && body.subdomain) {
          setLookup({ status: "found", subdomain: body.subdomain, name: body.name ?? null, logoUrl: body.logoUrl ?? null });
        } else {
          setLookup({ status: "missing", subdomain: candidate });
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setLookup({ status: "missing", subdomain: candidate });
        }
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [demo, input, open, step]);

  // Typeahead over Substack's profile and publication search. A pasted link
  // or typed domain already identifies it, so anything with a dot or
  // slash skips the search entirely — no suggestions duplicating the URL.
  useEffect(() => {
    if (!open || step !== "connect" || demo) return;
    const query = input.trim();
    if (skipSearchRef.current || query.length < 2 || /[./]/.test(query)) {
      skipSearchRef.current = false;
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const response = await fetch(`/api/substack/search?query=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = await response.json().catch(() => null) as { suggestions?: Suggestion[] } | null;
        if (controller.signal.aborted) return;
        const rows = body?.suggestions ?? [];
        setSuggestions(rows);
        setSuggestionsOpen(rows.length > 0);
        setActiveSuggestion(-1);
      } catch {
        // Suggestions are best-effort; typing a link always works.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [demo, input, open, step]);

  function chooseSuggestion(suggestion: Suggestion) {
    skipSearchRef.current = true;
    setInput(suggestion.subdomain);
    setSuggestions([]);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    // Search results come from Substack itself, so treat the pick as found
    // immediately; the lookup effect still re-verifies in the background.
    setLookup({ status: "found", subdomain: suggestion.subdomain, name: suggestion.name, logoUrl: suggestion.logoUrl });
  }

  /** Step 2 → 1: re-choose the publication, prefilled so lookup re-verifies. */
  function backToConnect() {
    skipSearchRef.current = true;
    setInput(subdomain ?? "");
    setConnectError(null);
    setStep("connect");
  }

  /** Step 3 → 2: swap in a different export ZIP. */
  function backToImport() {
    setPriceError(null);
    setUploadState({ phase: "idle" });
    setStep("import");
  }

  async function continueToImport() {
    if (demo) return;
    if (lookup.status !== "found" || !lookup.subdomain || connecting || navigatingRef.current) return;
    setConnecting(true);
    setConnectError(null);
    try {
      // Guarantee the creators row exists before the server writes to it — a
      // new writer arriving straight from login may not have one yet.
      await client?.getCreator();
      const token = await getAccessToken();
      const response = await fetch("/api/substack/connect", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ subdomain: lookup.subdomain, name: lookup.name ?? null, logoUrl: lookup.logoUrl ?? null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Could not save your publication.");
      window.localStorage.setItem(SUBDOMAIN_KEY, lookup.subdomain);
      window.localStorage.setItem(LEGACY_USERNAME_KEY, lookup.subdomain);
      setSubdomain(lookup.subdomain);
      setStep("import");
    } catch (cause) {
      setConnectError(cause instanceof Error ? cause.message : "Could not save your publication.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleUpload(file: File) {
    if (uploadState.phase === "uploading" || uploadState.phase === "parsing") return;
    if (!/\.zip$/i.test(file.name)) {
      setUploadState({ phase: "error", message: "Only .zip files work here — drop the export exactly as Substack sent it." });
      return;
    }
    setUploadState({ phase: "uploading", percent: 0 });
    try {
      await client?.getCreator();
      const token = await getAccessToken();
      const result = await uploadArchive(file, token, (percent) => {
        setUploadState(percent >= 100 ? { phase: "parsing" } : { phase: "uploading", percent });
      });
      if (!result.ok) throw new Error(result.body?.error?.message || "Could not read this export.");
      const rows = (result.body?.candidates ?? []) as Array<{ id: string; title: string; wordCount: number; importable: boolean; recommendedPricePerWordCents: number }>;
      const importable = rows.filter((row) => row.importable);
      if (!result.body?.jobId || importable.length === 0) {
        throw new Error("No published posts were found in this export.");
      }
      const totalWordCount = importable.reduce((sum, row) => sum + Number(row.wordCount || 0), 0);
      const weightedCents = importable.reduce((sum, row) => sum + Number(row.recommendedPricePerWordCents || 0) * Number(row.wordCount || 0), 0);
      setArchive({
        jobId: result.body.jobId,
        postCount: importable.length,
        totalWordCount,
        averageWordCount: Math.round(totalWordCount / importable.length),
        recommendedPriceUsd: totalWordCount > 0 ? weightedCents / totalWordCount / 100 : 0,
        posts: importable.map((row) => ({ id: row.id, title: row.title, wordCount: Number(row.wordCount || 0) })),
      });
      setUploadState({ phase: "idle" });
      setStep("price");
    } catch (cause) {
      setUploadState({ phase: "error", message: cause instanceof Error ? cause.message : "Could not read this export." });
    }
  }

  // Drag-and-drop works on the whole page during step 2, not just the box.
  const handleUploadRef = useRef(handleUpload);
  useEffect(() => {
    handleUploadRef.current = handleUpload;
  });
  useEffect(() => {
    if (!open || step !== "import" || demo) return;
    let depth = 0;
    const enter = (event: DragEvent) => {
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => event.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) void handleUploadRef.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      setDragging(false);
    };
  }, [demo, open, step]);

  async function goLive() {
    if (!archive || goingLive || navigatingRef.current) return;
    setGoingLive(true);
    setPriceError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/import/substack/commit", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          jobId: archive.jobId,
          substackUsername: subdomain,
          // Per-post selections carry any drawer overrides; the global price is
          // still persisted as the creator's default.
          ...(archive.posts.length
            ? { selections: archive.posts.map((post) => ({ id: post.id, pricePerWordCents: Number((effectivePostPrice(post.id) * 100).toFixed(4)) })) }
            : { applyToAll: true }),
          globalPricePerWordCents: Number((price * 100).toFixed(4)),
          goLive: true,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || "Could not publish your archive.");
      navigatingRef.current = true;
      window.localStorage.setItem(SEEN_KEY, "1");
      window.localStorage.removeItem(SUBDOMAIN_KEY);
      router.push("/dashboard/articles");
    } catch (cause) {
      setPriceError(cause instanceof Error ? cause.message : "Could not publish your archive.");
      setGoingLive(false);
    }
  }

  function close() {
    window.localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  const settingsUrl = subdomain ? `https://${subdomain}.substack.com/publish/settings#import-export-settings` : null;
  const mailtoHref = `mailto:${IMPORT_EMAIL}?subject=${encodeURIComponent(`Rubicon import — ${subdomain ?? ""}`)}&body=${encodeURIComponent("Attach your Substack export ZIP here, or forward the export email from Substack to this address.")}`;
  const cardClass = "relative z-10 w-full rounded-lg border border-black/[0.06] bg-white p-8 max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-5 max-sm:py-7";
  const sliderPercent = ((price - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
  const recommendedPrice = archive && archive.recommendedPriceUsd > 0 ? snapPrice(archive.recommendedPriceUsd) : null;
  // The archive total honours drawer overrides; the average-post tile tracks
  // the global slider so the two stay easy to compare.
  const archiveTotalUsd = archive
    ? archive.posts.length
      ? archive.posts.reduce((sum, post) => sum + post.wordCount * effectivePostPrice(post.id), 0)
      : archive.totalWordCount * price
    : 0;
  const overrideCount = archive
    ? archive.posts.filter((post) => Math.abs(effectivePostPrice(post.id) - price) > 1e-9).length
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 grid items-center justify-items-center overflow-y-auto bg-white p-5 max-sm:items-end max-sm:justify-items-stretch max-sm:p-0"
      role="presentation"
      // Machine-readable step marker for browser agents; the welcome splash
      // auto-advances, so only the three actionable steps are announced.
      data-onboarding-step={step === "welcome" ? undefined : step}
    >
      <OnboardingTileBackground />
      <button type="button" onClick={close} className="dashboard-icon-button absolute right-5 top-5 z-20" aria-label="Close onboarding">
        <X size={17} />
      </button>

      <AnimatePresence mode="wait" initial={false}>
        {step === "welcome" && (
          <motion.section
            key="welcome"
            aria-live="polite"
            className="relative z-10 grid justify-items-center rounded-lg bg-white px-12 py-10 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.65, ease: EASE_OUT }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.01 : 1.15, ease: EASE_OUT }}
            >
              <Image src="/w_logo.png" alt="Rubicon" width={68} height={68} priority />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.01 : 0.65, delay: reduceMotion ? 0 : 0.65, ease: EASE_OUT }}
            >
              <h1 className="mt-7 text-3xl font-semibold tracking-[-0.025em] text-[var(--ink)]">Welcome to Rubicon</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Making writing available to agents</p>
            </motion.div>
          </motion.section>
        )}

        {step === "connect" && (
          <motion.section
            key="connect"
            role="dialog"
            aria-modal="true"
            aria-labelledby="substack-onboarding-title"
            className={`${cardClass} max-w-md`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 1 of 3</p>
              <h1 id="substack-onboarding-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Connect your Substack</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Type your profile or publication name, or paste its link.</p>
            </div>

            <div className="relative mt-7">
              <label htmlFor="substack-publication-input" className="sr-only">
                Substack profile or publication name or link
              </label>
              <input
                id="substack-publication-input"
                data-testid="publication-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (suggestionsOpen && suggestions.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveSuggestion((index) => (index + 1) % suggestions.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveSuggestion((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
                      return;
                    }
                    if (event.key === "Escape") {
                      setSuggestionsOpen(false);
                      return;
                    }
                    if (event.key === "Enter" && activeSuggestion >= 0) {
                      event.preventDefault();
                      chooseSuggestion(suggestions[activeSuggestion]);
                      return;
                    }
                  }
                  if (event.key === "Enter") continueToImport();
                }}
                onBlur={() => setSuggestionsOpen(false)}
                placeholder="creator"
                className="h-12 w-full rounded-lg border border-transparent bg-[var(--surface-muted)] text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[rgba(22,24,29,0.2)]"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                role="combobox"
                aria-expanded={suggestionsOpen && suggestions.length > 0}
                aria-autocomplete="list"
                aria-controls="substack-suggestions"
                aria-describedby="substack-lookup-feedback"
              />
              {/* Live `.substack.com` suffix: an invisible mirror of the typed
                  text positions it right after the caret. Shown only while the
                  input reads as a bare handle — a pasted link or a multi-word
                  name hides it, so a URL is never doubled. */}
              {(input === "" || /^[a-z0-9-]+$/i.test(input.trim())) && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex max-w-full items-center overflow-hidden pl-[0.875rem] text-sm">
                  <span className="invisible whitespace-pre">{input || "creator"}</span>
                  <span className="text-[var(--quiet)]">.substack.com</span>
                </span>
              )}
              {suggestionsOpen && suggestions.length > 0 && (
                <ul
                  id="substack-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-lg bg-white py-1 shadow-[0_1px_3px_rgba(22,24,29,0.08),0_10px_30px_rgba(22,24,29,0.14)]"
                >
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion.subdomain} role="option" aria-selected={index === activeSuggestion}>
                      <button
                        type="button"
                        // preventDefault keeps focus in the input so onBlur
                        // doesn't close the list before the click lands.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseSuggestion(suggestion)}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${index === activeSuggestion ? "bg-[var(--surface-muted)]" : ""}`}
                      >
                        {suggestion.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote Substack logos aren't in next.config image domains
                          <img src={suggestion.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-xs font-semibold text-[var(--muted)]">
                            {suggestion.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                          <span className="block truncate text-xs text-[var(--muted)]">
                            <span className="mono">{suggestion.subdomain}.substack.com</span>
                            {suggestion.subscribers ? ` · ${suggestion.subscribers}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div id="substack-lookup-feedback" className="mt-3 min-h-10 text-sm leading-5" role="status" aria-live="polite">
              {lookup.status === "checking" && <span className="text-[var(--quiet)]">Checking…</span>}
              {lookup.status === "found" && lookup.subdomain && (
                <span className="inline-flex items-start gap-1.5 text-[#165c3e]">
                  <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Found <span className="mono">{lookup.subdomain}.substack.com</span></span>
                </span>
              )}
              {lookup.status === "missing" && !suggestionsOpen && (
                <span role="alert" className="text-[#8d2f2d]">
                  We couldn’t find that Substack profile or publication. Try its name, @handle, or Substack link.
                </span>
              )}
              {connectError && <span role="alert" className="mt-1 block text-[#8d2f2d]">{connectError}</span>}
            </div>

            <button
              type="button"
              data-testid="continue-button"
              onClick={continueToImport}
              disabled={lookup.status !== "found" || connecting}
              className={`button button-primary mt-5 w-full justify-center py-3 disabled:opacity-40${demo && demoPressing ? " scale-[0.97]" : ""}`}
            >
              {connecting ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <>Continue <ArrowRight size={16} /></>}
            </button>

            {demo && (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute z-20"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  left: demoPressing ? "52%" : "30%",
                  top: demoPressing ? "88%" : "62%",
                  scale: demoPressing ? 0.86 : 1,
                }}
                transition={{ left: { duration: 0.55, ease: EASE_OUT }, top: { duration: 0.55, ease: EASE_OUT }, scale: { duration: 0.16 }, opacity: { duration: 0.3 } }}
              >
                {/* shared macOS cursor: white arrow, dark outline */}
                <MousePointer2 size={20} fill="#ffffff" stroke="#16181d" strokeWidth={1.5} />
              </motion.span>
            )}
          </motion.section>
        )}

        {step === "import" && (
          <motion.section
            key="import"
            role="dialog"
            aria-modal="true"
            aria-labelledby="substack-import-title"
            className={`${cardClass} max-w-3xl`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <button type="button" onClick={backToConnect} className="dashboard-icon-button absolute left-4 top-4" aria-label="Back to connect your Substack">
              <ArrowLeft size={15} />
            </button>
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 2 of 3</p>
              <h1 id="substack-import-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Import your archive</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Grab your export from Substack, then get it to us either way.</p>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                <div className="flex items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white" aria-hidden="true">1</span>
                  <h2 className="text-sm font-semibold">Request your export</h2>
                </div>
                <p className="mt-1 text-sm leading-5 text-[var(--muted)]">This opens your export section directly — click ‘New export’, Substack will prepare it in a few minutes.</p>
                <a href={settingsUrl ?? "#"} target="_blank" rel="noreferrer" data-testid="export-settings-link" className="button button-primary mt-3 w-full justify-center text-sm">
                  Open my export settings <ExternalLink size={14} aria-hidden="true" />
                </a>
                <ExportSettingsPreview />
                <p className="mt-2 text-xs leading-4 text-[var(--muted)]">When it’s done, the ZIP appears in the Download column right on that page — no need to wait for Substack’s email.</p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-[var(--muted)]" aria-hidden="true">2</span>
                    <h2 className="text-sm font-semibold">Send it to us</h2>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-[var(--muted)]">Drop the ZIP below, or email it — attach the file or just forward Substack’s export email.</p>
                  <a href={mailtoHref} data-testid="email-export-link" className="button button-primary mt-3 text-sm">
                    <Mail size={14} aria-hidden="true" /> Email my export
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadState.phase === "uploading" || uploadState.phase === "parsing"}
                  className={`grid min-h-24 w-full flex-1 place-items-center rounded-lg p-5 text-center transition-colors ${
                    dragging ? "bg-[#eaeaec] ring-2 ring-inset ring-[var(--ink)]" : "bg-[var(--surface-muted)] hover:bg-[var(--hovered)]"
                  }`}
                >
              {uploadState.phase === "uploading" || uploadState.phase === "parsing" ? (
                <span className="grid justify-items-center gap-2">
                  <Loader2 size={18} className="animate-spin text-[var(--muted)]" aria-hidden="true" />
                  <span className="text-sm text-[var(--muted)]" role="status">
                    {uploadState.phase === "parsing" ? "Reading your archive…" : `Uploading… ${uploadState.percent}%`}
                  </span>
                  <span className="h-1 w-44 overflow-hidden rounded-full bg-[#e4e4e7]">
                    <span
                      className="block h-full rounded-full bg-[#18181b] transition-[width] duration-200"
                      style={{ width: `${uploadState.phase === "parsing" ? 100 : uploadState.percent}%` }}
                    />
                  </span>
                </span>
              ) : (
                <span className="text-sm text-[var(--muted)]">Or drop your ZIP anywhere on this page.</span>
              )}
                </button>
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              data-testid="archive-file-input"
              aria-label="Substack export ZIP file"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
                event.target.value = "";
              }}
            />
            {uploadState.phase === "error" && (
              <p className="mt-3 text-sm leading-5 text-[#8d2f2d]" role="alert">{uploadState.message}</p>
            )}
            {archive && uploadState.phase === "idle" && (
              <button
                type="button"
                onClick={() => setStep("price")}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
              >
                Keep the archive you already sent ({archive.postCount.toLocaleString()} posts) <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
          </motion.section>
        )}

        {step === "price" && archive && (
          <motion.section
            key="price"
            role="dialog"
            aria-modal="true"
            aria-labelledby="substack-price-title"
            className={`${cardClass} max-w-lg`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <button type="button" onClick={backToImport} className="dashboard-icon-button absolute left-4 top-4" aria-label="Back to import your archive">
              <ArrowLeft size={15} />
            </button>
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 3 of 3</p>
              <h1 id="substack-price-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Set your price</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">One price for everything, or fine-tune individual posts below.</p>
            </div>

            <div className="mt-7">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Price per word</span>
                <span className="mono text-sm font-semibold tabular-nums">
                  $
                  <input
                    type="number"
                    inputMode="decimal"
                    min={PRICE_MIN}
                    max={PRICE_MAX}
                    step={PRICE_STEP}
                    value={priceDraft ?? price.toFixed(4)}
                    onChange={(event) => {
                      setPriceDraft(event.target.value);
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed) && parsed > 0) setPrice(snapPrice(parsed));
                    }}
                    onBlur={() => setPriceDraft(null)}
                    className="substack-price-input"
                    data-testid="price-input"
                    aria-label="Price per word in USDC"
                  />
                  {" / word"}
                </span>
              </div>
              <input
                type="range"
                min={PRICE_MIN}
                max={PRICE_MAX}
                step={PRICE_STEP}
                value={price}
                onChange={(event) => {
                  setPrice(Number(event.target.value));
                  setPriceDraft(null);
                }}
                className="substack-price-slider mt-3 w-full"
                style={{ background: `linear-gradient(to right, #18181b ${sliderPercent}%, #e4e4e7 ${sliderPercent}%)` }}
                aria-label="Price per word in USDC"
              />
              {recommendedPrice !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setPrice(recommendedPrice);
                    setPriceDraft(null);
                  }}
                  className="mt-2 text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                >
                  Recommended for this archive: <span className="mono font-semibold text-[var(--ink)]">${recommendedPrice.toFixed(4)}</span> / word — tap to apply
                </button>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                <div className="mono text-[0.65rem] uppercase leading-4 tracking-[0.1em] text-[var(--muted)]">Your average post</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]">
                  ${(archive.averageWordCount * price).toFixed(2)}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">{archive.averageWordCount.toLocaleString()} words</div>
              </div>
              <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                <div className="mono text-[0.65rem] uppercase leading-4 tracking-[0.1em] text-[var(--muted)]">Full archive</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]">
                  ${archiveTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]" role="status" data-testid="import-summary">
                  {archive.postCount.toLocaleString()} posts · {archive.totalWordCount.toLocaleString()} words
                </div>
              </div>
            </div>

            {archive.posts.length > 0 && (
              <div className="mt-3 rounded-lg bg-[var(--surface-muted)]">
                <button
                  type="button"
                  onClick={() => setDrawerOpen((current) => !current)}
                  aria-expanded={drawerOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">Fine-tune individual posts</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">Give specific posts their own per-word price.</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
                    {overrideCount > 0 && <span className="rounded-md bg-white px-1.5 py-0.5 font-medium">{overrideCount} adjusted</span>}
                    <ChevronDown size={16} className={`transition-transform ${drawerOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </span>
                </button>
                {drawerOpen && (
                  <ul className="max-h-52 overflow-y-auto border-t border-[var(--line)]">
                    {archive.posts.map((post) => (
                      <li key={post.id} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{post.title || "Untitled post"}</div>
                          <div className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">
                            {post.wordCount.toLocaleString()} words · ${(post.wordCount * effectivePostPrice(post.id)).toFixed(2)}
                          </div>
                        </div>
                        <label className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
                          $
                          <input
                            type="number"
                            inputMode="decimal"
                            min={PRICE_MIN}
                            max={PRICE_MAX}
                            step={PRICE_STEP}
                            value={postPrices[post.id] ?? price.toFixed(4)}
                            onChange={(event) => setPostPrices((current) => ({ ...current, [post.id]: event.target.value }))}
                            className="h-8 w-24 rounded-md bg-white px-2 text-sm tabular-nums outline-none transition focus:ring-2 focus:ring-[rgba(22,24,29,0.2)]"
                            aria-label={`Price per word for ${post.title || "untitled post"}`}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {priceError && <p className="mt-3 text-sm leading-5 text-[#8d2f2d]" role="alert">{priceError}</p>}

            <button
              type="button"
              data-testid="go-live-button"
              onClick={goLive}
              disabled={goingLive}
              className="button button-primary mt-5 w-full justify-center py-3 disabled:opacity-40"
            >
              {goingLive ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : <>Go live <ArrowRight size={16} /></>}
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

/** POSTs the export ZIP with real upload progress (fetch cannot report it). */
function uploadArchive(
  file: File,
  token: string | null,
  onProgress: (percent: number) => void,
): Promise<{ ok: boolean; body: { jobId?: string; candidates?: unknown[]; error?: { message?: string } } | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/substack");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Hosting/proxy failures can replace our JSON response with HTML or an
        // empty body. Preserve a useful status instead of hiding it behind the
        // generic parser error.
        body = {
          error: {
            message: uploadHttpError(xhr.status, xhr.statusText),
          },
        };
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, body });
    };
    xhr.onerror = () => reject(new Error("Network request failed. Check your connection and try again."));
    const form = new FormData();
    form.append("files", file);
    form.append("paths", JSON.stringify([file.name]));
    xhr.send(form);
  });
}

function uploadHttpError(status: number, statusText: string): string {
  if (status === 0) return "The upload did not reach Rubicon. Check your connection and try again.";
  if (status === 401 || status === 403) return "Your session expired. Sign in again, then retry the upload.";
  if (status === 404) return "The Substack import service is not available in this deployment.";
  if (status === 413) return "The export is larger than this deployment allows.";
  if (status >= 500) return `Rubicon could not process the upload (HTTP ${status}). Try again in a moment.`;
  return `The upload failed (HTTP ${status}${statusText ? ` ${statusText}` : ""}).`;
}

/**
 * A faithful miniature of Substack's Import / Export settings panel, with the
 * Download column circled — the export lands right on that page, not only in
 * the confirmation email.
 */
function ExportSettingsPreview() {
  return (
    <div className="mt-3 rounded-lg bg-white p-3 shadow-[0_1px_2px_rgba(22,24,29,0.05),0_5px_16px_rgba(22,24,29,0.07)]" aria-hidden="true">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">Export your data</div>
          <div className="mt-0.5 truncate text-[0.68rem] leading-4 text-[var(--muted)]">Export your posts, subscriber list, and related data.</div>
        </div>
        <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-[0.68rem] font-semibold">New export</span>
      </div>
      <div className="mt-2.5">
        <div className="grid grid-cols-[1fr_auto_5rem] items-center gap-2 border-b border-[var(--line)] px-1 py-1.5 text-[0.65rem] text-[var(--muted)]">
          <span>Date</span>
          <span>Status</span>
          <span className="text-center">Download</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_5rem] items-center gap-2 px-1 py-1.5 text-[0.7rem]">
          <span className="text-[var(--muted)]">Jul 1, 4:51 PM</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-[#dff5e9] px-1.5 py-0.5 font-semibold text-[#176342]">
            <Check size={10} /> Done
          </span>
          <span className="relative mx-auto">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--ink)]">
              <Download size={12} />
            </span>
            <span className="absolute -inset-[7px] -rotate-3 rounded-[50%] border-2 border-[#963b37]" />
          </span>
        </div>
      </div>
    </div>
  );
}

const TILE_IMAGE_POSITIONS = ["0% 50%", "28% 50%", "55% 50%", "82% 50%", "100% 50%"];

function OnboardingTileBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 grid grid-cols-4 grid-rows-4 opacity-80" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => {
        const imageIndex = [1, 4, 7, 10, 14].indexOf(index);
        return (
          <div key={index} className="relative overflow-hidden border-b border-r border-black/[0.045] bg-white">
            {imageIndex >= 0 && (
              <div
                className="absolute inset-0 opacity-[0.16] saturate-[0.7]"
                style={{
                  backgroundImage: "url('/Forwriters%20banner.png')",
                  backgroundPosition: TILE_IMAGE_POSITIONS[imageIndex],
                  backgroundSize: "500% 100%",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
