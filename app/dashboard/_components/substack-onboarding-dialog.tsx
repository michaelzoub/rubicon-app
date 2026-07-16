"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, ExternalLink, Loader2, Mail, MousePointer2, PenLine, Upload, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseSubstackSubdomain } from "@/lib/import/substack-subdomain";
import { detectImportSource } from "@/lib/import/detect";
import { ONBOARDING_PLATFORM_CHOICES, OTHER_IMPORT_GROUP, type OnboardingPlatformId } from "@/lib/import/options";
import type { ImportResult } from "@/lib/import/types";
import { stashImport } from "@/app/dashboard/articles/_import-handoff";
import { useRubiconClient } from "@/lib/rubicon/auth";
import { SubstackSuggestionLogo } from "./substack-suggestion-logo";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const SEEN_KEY = "rubicon-substack-onboarding-seen";
const SUBDOMAIN_KEY = "rubicon-substack-subdomain";
/** Legacy key the standalone import page still reads. */
const LEGACY_USERNAME_KEY = "rubicon-substack-username";

const IMPORT_EMAIL = "micacao15@gmail.com";
const PRICE_MIN = 0.0001;
const PRICE_SLIDER_MAX = 1;
const PRICE_STEP = 0.0001;
const PRICE_DEFAULT = 0.001;
const PRICE_SLIDER_MIN_EXPONENT = Math.log10(PRICE_MIN);
const PRICE_SLIDER_MAX_EXPONENT = Math.log10(PRICE_SLIDER_MAX);
const PRICE_SLIDER_STEP = 0.01;

/** Clamp a dollar price into the slider's range, snapped to atomic-USDC precision. */
function snapPrice(usd: number): number {
  const clamped = Math.min(PRICE_SLIDER_MAX, Math.max(PRICE_MIN, usd));
  return Math.round(clamped / PRICE_STEP) * PRICE_STEP;
}

function priceToSliderValue(usd: number): number {
  return Math.log10(Math.min(PRICE_SLIDER_MAX, Math.max(PRICE_MIN, usd)));
}

function sliderValueToPrice(value: number): number {
  return snapPrice(10 ** value);
}

/** Tracks an anchor's viewport position so a suggestion list can be portaled
 * to document.body — the onboarding card scrolls internally, and a dropdown
 * positioned relative to it would be clipped by (or scroll along with) that
 * container instead of floating freely below the input. */
function useAnchorRect(anchorRef: React.RefObject<HTMLElement | null>, isOpen: boolean) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const top = box.bottom + 6;
      // Fill whatever room is left to the bottom of the viewport (with a
      // small margin) instead of a fixed row count, so a tall screen shows
      // more suggestions and a short one shows fewer.
      const maxHeight = Math.max(120, window.innerHeight - top - 16);
      setRect({ top, left: box.left, width: box.width, maxHeight });
    };
    update();
    window.addEventListener("resize", update);
    // capture:true catches scrolling inside the onboarding card, which
    // doesn't bubble a scroll event to window otherwise.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, isOpen]);

  return rect;
}

type Step = "welcome" | "platform" | "connect" | "artemis" | "x" | "import" | "price" | "success";

// The "where do you mostly write" tiles come from lib/import/options — the
// shared source of truth for import options across onboarding and the compose
// screen. Substack runs the archive flow, Artemis imports by article URL, and
// "Other" offers the generic URL/Markdown paths.
type PlatformId = OnboardingPlatformId;

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
  url?: string;
}

interface ArtemisProfile {
  handle: string;
  name: string;
  avatarUrl: string | null;
}

interface ArtemisArticleSummary {
  shortId: string;
  title: string;
  subtitle: string | null;
  wordCount: number;
  publishedAt: string | null;
  url: string;
}

interface XProfile {
  handle: string;
  name: string;
  avatarUrl: string | null;
  /** Numeric X user id — the article listing endpoint keys on this, not the handle. */
  userId: string;
}

interface XArticleSummary {
  statusId: string;
  title: string;
  wordCount: number;
  publishedAt: string | null;
  url: string;
}

interface ArchiveStats {
  jobId: string;
  source: "substack" | "artemis" | "x";
  authorHandle?: string;
  authorName?: string;
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
  const queryClient = useQueryClient();
  const client = useRubiconClient();
  const { getAccessToken } = usePrivy();
  const reduceMotion = useReducedMotion();
  const [portalReady, setPortalReady] = useState(false);
  const [open, setOpen] = useState(() => {
    if (!shouldOpen) return false;
    if (forceOpen || demo) return true;
    return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY) !== "1";
  });
  const [step, setStep] = useState<Step>("welcome");

  // Step 1 — where do you mostly write
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  // Step 2 — connect
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle", subdomain: null });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchAbortRef = useRef<AbortController | null>(null);
  const connectFieldRef = useRef<HTMLDivElement>(null);
  const suggestionsRect = useAnchorRect(connectFieldRef, suggestionsOpen && suggestions.length > 0);
  /** Set when a suggestion is picked so the resulting input change doesn't reopen the dropdown. */
  const skipSearchRef = useRef(false);

  // Artemis path — selecting a writer loads their archive into the shared
  // pricing step. Pasting one article link keeps the one-off draft flow.
  const [artemisInput, setArtemisInput] = useState("");
  const [artemisSuggestions, setArtemisSuggestions] = useState<ArtemisProfile[]>([]);
  const [artemisSuggestionsOpen, setArtemisSuggestionsOpen] = useState(false);
  const [artemisActiveSuggestion, setArtemisActiveSuggestion] = useState(-1);
  const [artemisProfile, setArtemisProfile] = useState<ArtemisProfile | null>(null);
  const [artemisArticles, setArtemisArticles] = useState<ArtemisArticleSummary[] | null>(null);
  const [artemisLoadingArticles, setArtemisLoadingArticles] = useState(false);
  const [artemisPending, setArtemisPending] = useState(false);
  const [artemisError, setArtemisError] = useState<string | null>(null);
  const [artemisChecking, setArtemisChecking] = useState(false);
  const artemisSearchAbortRef = useRef<AbortController | null>(null);
  const artemisFieldRef = useRef<HTMLDivElement>(null);
  const artemisSuggestionsRect = useAnchorRect(artemisFieldRef, artemisSuggestionsOpen && artemisSuggestions.length > 0);

  // X path — mirrors Artemis: pick a writer to bulk-import their X Articles, or
  // paste one article link for the one-off draft flow.
  const [xInput, setXInput] = useState("");
  const [xSuggestions, setXSuggestions] = useState<XProfile[]>([]);
  const [xSuggestionsOpen, setXSuggestionsOpen] = useState(false);
  const [xActiveSuggestion, setXActiveSuggestion] = useState(-1);
  const [xProfile, setXProfile] = useState<XProfile | null>(null);
  const [xArticles, setXArticles] = useState<XArticleSummary[] | null>(null);
  const [xLoadingArticles, setXLoadingArticles] = useState(false);
  const [xPending, setXPending] = useState(false);
  const [xError, setXError] = useState<string | null>(null);
  const [xChecking, setXChecking] = useState(false);
  const xSearchAbortRef = useRef<AbortController | null>(null);
  const xFieldRef = useRef<HTMLDivElement>(null);
  const xSuggestionsRect = useAnchorRect(xFieldRef, xSuggestionsOpen && xSuggestions.length > 0);

  // Step 3 — import archive
  const [subdomain, setSubdomain] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 4 — price
  const [archive, setArchive] = useState<ArchiveStats | null>(null);
  const [price, setPrice] = useState(PRICE_DEFAULT);
  const [isFree, setIsFree] = useState(false);
  /** Raw text in the price readout while it's being typed in; null shows the
   * canonical price. Agents (and keyboards) set the number field, sliders and
   * the recommended shortcut clear it. */
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Every parsed post starts selected; writers can exclude posts before they
   * become live articles and therefore accessible to buyer agents. */
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  /** Raw per-post price inputs; empty/invalid entries fall back to the global price. */
  const [postPrices, setPostPrices] = useState<Record<string, string>>({});
  const [goingLive, setGoingLive] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [publishedCount, setPublishedCount] = useState(0);

  function effectivePostPrice(postId: string): number {
    if (isFree) return 0;
    const raw = postPrices[postId];
    if (raw === undefined || raw.trim() === "") return price;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : price;
  }

  const [demoPressing, setDemoPressing] = useState(false);
  const navigatingRef = useRef(false);

  useEffect(() => setPortalReady(true), []);

  // The onboarding experience owns the viewport while open. Render it outside
  // the dashboard grid, freeze document scrolling, and make the underlying
  // dashboard inert so there is only one visible/interactive page.
  useEffect(() => {
    if (!open || !portalReady) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const dashboardRoot = document.querySelector<HTMLElement>("[data-dashboard-root]");
    const previousAriaHidden = dashboardRoot?.getAttribute("aria-hidden") ?? null;
    const wasInert = dashboardRoot?.hasAttribute("inert") ?? false;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    dashboardRoot?.setAttribute("inert", "");
    dashboardRoot?.setAttribute("aria-hidden", "true");
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (dashboardRoot) {
        if (!wasInert) dashboardRoot.removeAttribute("inert");
        if (previousAriaHidden === null) dashboardRoot.removeAttribute("aria-hidden");
        else dashboardRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
    };
  }, [open, portalReady]);

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
    // The demo video only shows the Substack path, so it skips the platform question.
    const timer = window.setTimeout(() => setStep(demo ? "connect" : "platform"), reduceMotion ? 500 : 2600);
    return () => window.clearTimeout(timer);
  }, [demo, open, reduceMotion, step]);

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
          setSelectedPostIds(body.pendingArchive.posts.map((post) => post.id));
          setStep("price");
        } else {
          setStep((current) => (current === "welcome" || current === "platform" || current === "connect" ? "import" : current));
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

  // Artemis writer typeahead. A pasted link or anything URL-shaped skips the
  // search — the link itself already identifies the article.
  useEffect(() => {
    if (!open || step !== "artemis" || demo || artemisProfile) return;
    const query = artemisInput.trim();
    if (query.length < 2 || /[/]/.test(query) || /\./.test(query)) {
      setArtemisSuggestions([]);
      setArtemisSuggestionsOpen(false);
      setArtemisChecking(false);
      return;
    }
    setArtemisChecking(true);
    const timer = window.setTimeout(async () => {
      artemisSearchAbortRef.current?.abort();
      const controller = new AbortController();
      artemisSearchAbortRef.current = controller;
      try {
        const response = await fetch(`/api/artemis/search?query=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = await response.json().catch(() => null) as { suggestions?: ArtemisProfile[] } | null;
        if (controller.signal.aborted) return;
        const rows = body?.suggestions ?? [];
        setArtemisSuggestions(rows);
        setArtemisSuggestionsOpen(rows.length > 0);
        setArtemisActiveSuggestion(-1);
        setArtemisChecking(false);
      } catch (cause) {
        // Suggestions are best-effort; pasting a link always works. A
        // superseded request's abort must not clear the newer one's spinner.
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setArtemisChecking(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [artemisInput, artemisProfile, demo, open, step]);

  // X writer typeahead. A pasted link or anything URL-shaped skips the search —
  // the link itself already identifies the article.
  useEffect(() => {
    if (!open || step !== "x" || demo || xProfile) return;
    const query = xInput.trim().replace(/^@/, "");
    if (query.length < 2 || /[/]/.test(query) || /\./.test(query)) {
      setXSuggestions([]);
      setXSuggestionsOpen(false);
      setXChecking(false);
      return;
    }
    setXChecking(true);
    const timer = window.setTimeout(async () => {
      xSearchAbortRef.current?.abort();
      const controller = new AbortController();
      xSearchAbortRef.current = controller;
      try {
        const response = await fetch(`/api/x/search?query=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = await response.json().catch(() => null) as { suggestions?: XProfile[] } | null;
        if (controller.signal.aborted) return;
        const rows = body?.suggestions ?? [];
        setXSuggestions(rows);
        setXSuggestionsOpen(rows.length > 0);
        setXActiveSuggestion(-1);
        setXChecking(false);
      } catch (cause) {
        // Suggestions are best-effort; pasting a link always works. A
        // superseded request's abort must not clear the newer one's spinner.
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setXChecking(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [xInput, xProfile, demo, open, step]);

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

  /** Step 1 → the platform's import flow, or out to the dashboard. */
  function continueFromPlatform() {
    if (!platform) return;
    if (platform === "substack") setStep("connect");
    else if (platform === "artemis") setStep("artemis");
    else if (platform === "x") setStep("x");
    else close();
  }

  /** Leave onboarding for one of the "Other" import flows. */
  function exitToImportOption(href: string) {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    window.localStorage.setItem(SEEN_KEY, "1");
    router.push(href);
  }

  /** A pasted article link short-circuits the search → pick flow entirely. */
  const artemisUrlDetected = detectImportSource(artemisInput.trim()) === "artemis";

  /** Import an Artemis article URL, then hand off to the draft editor. */
  async function importArtemisArticle(url: string) {
    if (demo) return;
    if (artemisPending || navigatingRef.current) return;
    setArtemisPending(true);
    setArtemisError(null);
    try {
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => null) as
        | (ImportResult & { error?: { message?: string } })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error?.message || "Couldn't import that Artemis article. Try again.");
      }
      // Same handoff as "Import from URL": nothing is saved or published until
      // the writer reviews the draft in the editor.
      stashImport(body);
      window.localStorage.setItem(SEEN_KEY, "1");
      navigatingRef.current = true;
      router.push("/dashboard/articles/new?imported=1");
    } catch (cause) {
      setArtemisError(cause instanceof Error ? cause.message : "Couldn't import that Artemis article.");
      setArtemisPending(false);
    }
  }

  /** Select a writer, load every published article, then open bulk pricing. */
  async function chooseArtemisProfile(profile: ArtemisProfile) {
    setArtemisProfile(profile);
    setArtemisSuggestions([]);
    setArtemisSuggestionsOpen(false);
    setArtemisActiveSuggestion(-1);
    setArtemisArticles(null);
    setArtemisError(null);
    setArtemisLoadingArticles(true);
    try {
      const response = await fetch(`/api/artemis/articles?handle=${encodeURIComponent(profile.handle)}`);
      const body = await response.json().catch(() => null) as
        | { articles?: ArtemisArticleSummary[]; error?: { message?: string } }
        | null;
      if (!response.ok || !body?.articles) {
        throw new Error(body?.error?.message || "Couldn't load articles from Artemis. Try again.");
      }
      setArtemisArticles(body.articles);
      if (body.articles.length === 0) return;
      const totalWordCount = body.articles.reduce((sum, article) => sum + article.wordCount, 0);
      setArchive({
        jobId: `artemis:${profile.handle}`,
        source: "artemis",
        authorHandle: profile.handle,
        authorName: profile.name,
        postCount: body.articles.length,
        totalWordCount,
        averageWordCount: Math.round(totalWordCount / body.articles.length),
        recommendedPriceUsd: 0,
        posts: body.articles.map((article) => ({
          id: article.shortId,
          title: article.title,
          wordCount: article.wordCount,
          url: article.url,
        })),
      });
      setSelectedPostIds(body.articles.map((article) => article.shortId));
      setPostPrices({});
      setDrawerOpen(false);
      setStep("price");
    } catch (cause) {
      setArtemisError(cause instanceof Error ? cause.message : "Couldn't load articles from Artemis.");
      setArtemisProfile(null);
    } finally {
      setArtemisLoadingArticles(false);
    }
  }

  /** Back from the article list to the writer search, keeping the query. */
  function changeArtemisProfile() {
    setArtemisProfile(null);
    setArtemisArticles(null);
    setArtemisError(null);
  }

  function submitArtemis() {
    if (artemisUrlDetected) void importArtemisArticle(artemisInput.trim());
  }

  /** A pasted X article link short-circuits the search → pick flow entirely. */
  const xUrlDetected = detectImportSource(xInput.trim()) === "x";

  /** Import a single X article URL, then hand off to the draft editor. */
  async function importXArticle(url: string) {
    if (demo) return;
    if (xPending || navigatingRef.current) return;
    setXPending(true);
    setXError(null);
    try {
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => null) as
        | (ImportResult & { error?: { message?: string } })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error?.message || "Couldn't import that X article. Try again.");
      }
      // Same handoff as "Import from URL": nothing is saved or published until
      // the writer reviews the draft in the editor.
      stashImport(body);
      window.localStorage.setItem(SEEN_KEY, "1");
      navigatingRef.current = true;
      router.push("/dashboard/articles/new?imported=1");
    } catch (cause) {
      setXError(cause instanceof Error ? cause.message : "Couldn't import that X article.");
      setXPending(false);
    }
  }

  /** Select a writer, load their published X Articles, then open bulk pricing. */
  async function chooseXProfile(profile: XProfile) {
    setXProfile(profile);
    setXSuggestions([]);
    setXSuggestionsOpen(false);
    setXActiveSuggestion(-1);
    setXArticles(null);
    setXError(null);
    setXLoadingArticles(true);
    try {
      const response = await fetch(`/api/x/articles?userId=${encodeURIComponent(profile.userId)}&handle=${encodeURIComponent(profile.handle)}`);
      const body = await response.json().catch(() => null) as
        | { articles?: XArticleSummary[]; error?: { message?: string } }
        | null;
      if (!response.ok || !body?.articles) {
        throw new Error(body?.error?.message || "Couldn't load articles from X right now. Try again, or paste an individual article link below.");
      }
      setXArticles(body.articles);
      if (body.articles.length === 0) return;
      const totalWordCount = body.articles.reduce((sum, article) => sum + article.wordCount, 0);
      setArchive({
        jobId: `x:${profile.handle}`,
        source: "x",
        authorHandle: profile.handle,
        authorName: profile.name,
        postCount: body.articles.length,
        totalWordCount,
        averageWordCount: Math.round(totalWordCount / body.articles.length),
        recommendedPriceUsd: 0,
        posts: body.articles.map((article) => ({
          id: article.statusId,
          title: article.title,
          wordCount: article.wordCount,
          url: article.url,
        })),
      });
      setSelectedPostIds(body.articles.map((article) => article.statusId));
      setPostPrices({});
      setDrawerOpen(false);
      setStep("price");
    } catch (cause) {
      setXError(cause instanceof Error ? cause.message : "Couldn't load articles from X right now. Try again, or paste an individual article link below.");
      setXProfile(null);
    } finally {
      setXLoadingArticles(false);
    }
  }

  /** Back from the article list to the writer search, keeping the query. */
  function changeXProfile() {
    setXProfile(null);
    setXArticles(null);
    setXError(null);
  }

  function submitX() {
    if (xUrlDetected) void importXArticle(xInput.trim());
  }

  /** Step 3 → 2: re-choose the publication, prefilled so lookup re-verifies. */
  function backToConnect() {
    skipSearchRef.current = true;
    setInput(subdomain ?? "");
    setConnectError(null);
    setStep("connect");
  }

  /** Step 4 → 3: swap in a different export ZIP. */
  function backToImport() {
    setPriceError(null);
    if (archive?.source === "artemis") {
      changeArtemisProfile();
      setStep("artemis");
      return;
    }
    if (archive?.source === "x") {
      changeXProfile();
      setStep("x");
      return;
    }
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
        source: "substack",
        postCount: importable.length,
        totalWordCount,
        averageWordCount: Math.round(totalWordCount / importable.length),
        recommendedPriceUsd: totalWordCount > 0 ? weightedCents / totalWordCount / 100 : 0,
        posts: importable.map((row) => ({ id: row.id, title: row.title, wordCount: Number(row.wordCount || 0) })),
      });
      setSelectedPostIds(importable.map((row) => row.id));
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
    if (!archive || selectedPostIds.length === 0 || goingLive || navigatingRef.current) return;
    setGoingLive(true);
    setPriceError(null);
    try {
      // Substack creates the creator row during its connect step. Artemis and X
      // have no equivalent connect request, so guarantee the FK owner exists
      // before the server inserts articles for a newly authenticated writer.
      if (!client) throw new Error("Could not prepare your creator account. Refresh and try again.");
      await client.getCreator();
      const token = await getAccessToken();
      // Artemis and X share the identical bulk-URL commit payload; only the
      // endpoint differs. Substack posts its export-job shape instead.
      const isBulkUrl = archive.source === "artemis" || archive.source === "x";
      const endpoint = archive.source === "artemis"
        ? "/api/artemis/commit"
        : archive.source === "x"
          ? "/api/x/commit"
          : "/api/import/substack/commit";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(isBulkUrl
          ? {
              handle: archive.authorHandle,
              authorName: archive.authorName,
              selections: archive.posts
                .filter((post) => selectedPostIds.includes(post.id))
                .map((post) => ({ id: post.id, url: post.url, pricePerWordCents: Number((effectivePostPrice(post.id) * 100).toFixed(4)) })),
              globalPricePerWordCents: Number(((isFree ? 0 : price) * 100).toFixed(4)),
              accessMode: isFree ? "free" : "paid",
            }
          : {
              jobId: archive.jobId,
              substackUsername: subdomain,
              // Per-post selections carry any drawer overrides; the global price is
              // still persisted as the creator's default.
              ...(archive.posts.length
                ? { selections: archive.posts
                    .filter((post) => selectedPostIds.includes(post.id))
                    .map((post) => ({ id: post.id, pricePerWordCents: Number((effectivePostPrice(post.id) * 100).toFixed(4)) })) }
                : { applyToAll: true }),
              globalPricePerWordCents: Number(((isFree ? 0 : price) * 100).toFixed(4)),
              accessMode: isFree ? "free" : "paid",
              goLive: true,
            }),
      });
      const body = await response.json().catch(() => null) as { imported?: number; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "Could not publish your archive.");

      // The import uses a server route rather than useRubiconMutation, so it
      // must explicitly invalidate the dashboard cache. Await active refetches
      // before navigating so Articles and Overview read the persisted import
      // immediately instead of retaining their cached empty state.
      await queryClient.invalidateQueries({ queryKey: ["rubicon"] });

      window.localStorage.setItem(SEEN_KEY, "1");
      window.localStorage.removeItem(SUBDOMAIN_KEY);
      setPublishedCount(body?.imported ?? selectedPostIds.length);
      setGoingLive(false);
      setStep("success");
    } catch (cause) {
      setPriceError(cause instanceof Error ? cause.message : "Could not publish your archive.");
      setGoingLive(false);
    }
  }

  function close() {
    window.localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
  }

  function viewArticles() {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.push("/dashboard/articles");
  }

  if (!open) return null;

  const settingsUrl = subdomain ? `https://${subdomain}.substack.com/publish/settings#import-export-settings` : null;
  const mailtoHref = `mailto:${IMPORT_EMAIL}?subject=${encodeURIComponent(`Rubicon import — ${subdomain ?? ""}`)}&body=${encodeURIComponent("Attach your Substack export ZIP here, or forward the export email from Substack to this address.")}`;
  const cardClass = "relative z-10 w-full max-h-[calc(100dvh-0.5rem)] overflow-y-auto overscroll-contain rounded-lg border border-black/[0.06] bg-white p-8 max-sm:max-h-dvh max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-5 max-sm:py-7";
  const sliderValue = priceToSliderValue(price);
  const sliderPercent = ((sliderValue - PRICE_SLIDER_MIN_EXPONENT) / (PRICE_SLIDER_MAX_EXPONENT - PRICE_SLIDER_MIN_EXPONENT)) * 100;
  const recommendedPrice = archive && archive.recommendedPriceUsd > 0 ? snapPrice(archive.recommendedPriceUsd) : null;
  const selectedPosts = archive?.posts.filter((post) => selectedPostIds.includes(post.id)) ?? [];
  const selectedWordCount = selectedPosts.reduce((sum, post) => sum + post.wordCount, 0);
  // The archive total honours drawer overrides; the average-post tile tracks
  // the global slider so the two stay easy to compare.
  const archiveTotalUsd = archive
    ? archive.posts.length
      ? selectedPosts.reduce((sum, post) => sum + post.wordCount * effectivePostPrice(post.id), 0)
      : archive.totalWordCount * (isFree ? 0 : price)
    : 0;
  const overrideCount = archive
    ? selectedPosts.filter((post) => Math.abs(effectivePostPrice(post.id) - (isFree ? 0 : price)) > 1e-9).length
    : 0;

  const onboardingPage = (
    <div
      className="dashboard-theme fixed inset-0 z-50 isolate grid h-dvh items-center justify-items-center overflow-hidden bg-white p-1 max-sm:items-end max-sm:justify-items-stretch max-sm:p-0"
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

        {step === "platform" && (
          <motion.section
            key="platform"
            role="dialog"
            aria-modal="true"
            aria-labelledby="writing-platform-title"
            className={`${cardClass} max-w-lg`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">
                Step 1{platform ? ` of ${platform === "artemis" || platform === "x" ? 3 : 4}` : ""}
              </p>
              <h1 id="writing-platform-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Where do you mostly write?</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">We’ll tailor the import to your platform.</p>
            </div>

            <div className="mt-7 grid grid-cols-4 gap-3 max-sm:grid-cols-2" role="radiogroup" aria-labelledby="writing-platform-title">
              {ONBOARDING_PLATFORM_CHOICES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={platform === option.id}
                  data-testid={`platform-${option.id}`}
                  onClick={() => setPlatform(option.id)}
                  className={`relative grid aspect-square w-full place-content-center justify-items-center gap-3 rounded-lg border-2 p-5 transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] ${
                    platform === option.id
                      ? "border-[var(--ink)] bg-white"
                      : "border-transparent bg-[var(--surface-muted)] hover:bg-[var(--hovered)]"
                  }`}
                >
                  {platform === option.id && (
                    <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-[var(--ink)] text-white" aria-hidden="true">
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  )}
                  {option.logoSrc ? (
                    <Image src={option.logoSrc} alt="" width={40} height={40} className="rounded-md" />
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-md bg-white text-[var(--muted)]" aria-hidden="true">
                      <PenLine size={20} strokeWidth={1.75} />
                    </span>
                  )}
                  <span className={`text-sm ${platform === option.id ? "font-semibold" : "font-medium"}`}>{option.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 min-h-10 text-sm leading-5" role="status" aria-live="polite">
              {platform === "other" && (
                <div className="grid gap-2">
                  <span className="font-medium">{OTHER_IMPORT_GROUP.heading}</span>
                  <div className="flex flex-wrap gap-2">
                    {OTHER_IMPORT_GROUP.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-testid={`other-import-${option.id}`}
                        onClick={() => exitToImportOption(option.href)}
                        className="button button-secondary text-sm"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              data-testid="platform-continue-button"
              onClick={continueFromPlatform}
              disabled={!platform}
              className="button button-primary mt-5 w-full justify-center py-3 disabled:opacity-40"
            >
              {platform === "other" ? <>Go to my dashboard <ArrowRight size={16} /></> : <>Continue <ArrowRight size={16} /></>}
            </button>
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
            {!demo && (
              <button type="button" onClick={() => setStep("platform")} className="dashboard-icon-button absolute left-4 top-4" aria-label="Back to choose where you write">
                <ArrowLeft size={15} />
              </button>
            )}
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 2 of 4</p>
              <h1 id="substack-onboarding-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Connect your Substack</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Type your profile or publication name, or paste its link.</p>
            </div>

            <div className="relative mt-7" ref={connectFieldRef}>
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
                className="h-12 w-full rounded-lg border border-transparent bg-[var(--surface-muted)] px-3.5 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[rgba(22,24,29,0.2)]"
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
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex max-w-full items-center overflow-hidden pl-3.5 text-sm">
                  <span className="invisible whitespace-pre">{input || "creator"}</span>
                  <span className="text-[var(--quiet)]">.substack.com</span>
                </span>
              )}
              {suggestionsOpen && suggestions.length > 0 && suggestionsRect && createPortal(
                <ul
                  id="substack-suggestions"
                  role="listbox"
                  style={{ position: "fixed", top: suggestionsRect.top, left: suggestionsRect.left, width: suggestionsRect.width, maxHeight: suggestionsRect.maxHeight }}
                  className="dashboard-theme z-[60] overflow-y-auto rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg"
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
                        <SubstackSuggestionLogo src={suggestion.logoUrl} name={suggestion.name || suggestion.subdomain} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{suggestion.name || suggestion.subdomain}</span>
                          <span className="block truncate text-xs text-[var(--muted)]">
                            <span className="mono">{suggestion.subdomain}.substack.com</span>
                            {suggestion.subscribers ? ` · ${suggestion.subscribers}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>,
                document.body
              )}
            </div>

            <div id="substack-lookup-feedback" className="mt-3 min-h-10 text-sm leading-5" role="status" aria-live="polite">
              {lookup.status === "checking" && (
                <span className="inline-flex items-center gap-1.5 text-[var(--quiet)]">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Checking…
                </span>
              )}
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

        {step === "artemis" && (
          <motion.section
            key="artemis"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artemis-onboarding-title"
            className={`${cardClass} max-w-md`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <button type="button" onClick={() => setStep("platform")} className="dashboard-icon-button absolute left-4 top-4" aria-label="Back to choose where you write">
              <ArrowLeft size={15} />
            </button>
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 2 of 3</p>
              <h1 id="artemis-onboarding-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Import from Artemis</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Find your Artemis profile to import its published articles, or paste one article link.</p>
            </div>

            {!artemisProfile ? (
              <div className="relative mt-7" ref={artemisFieldRef}>
                <label htmlFor="artemis-search-input" className="sr-only">
                  Artemis writer name, handle, or article link
                </label>
                <input
                  id="artemis-search-input"
                  data-testid="artemis-search-input"
                  value={artemisInput}
                  onChange={(event) => {
                    setArtemisInput(event.target.value);
                    if (artemisError) setArtemisError(null);
                  }}
                  onKeyDown={(event) => {
                    if (artemisSuggestionsOpen && artemisSuggestions.length > 0) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setArtemisActiveSuggestion((index) => (index + 1) % artemisSuggestions.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setArtemisActiveSuggestion((index) => (index <= 0 ? artemisSuggestions.length - 1 : index - 1));
                        return;
                      }
                      if (event.key === "Escape") {
                        setArtemisSuggestionsOpen(false);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        // Enter picks the highlighted writer, or the only match.
                        const pick = artemisActiveSuggestion >= 0
                          ? artemisSuggestions[artemisActiveSuggestion]
                          : artemisSuggestions.length === 1
                            ? artemisSuggestions[0]
                            : null;
                        if (pick) void chooseArtemisProfile(pick);
                        return;
                      }
                    }
                    if (event.key === "Enter" && artemisUrlDetected) submitArtemis();
                  }}
                  onBlur={() => setArtemisSuggestionsOpen(false)}
                  placeholder="Your name, @handle, or article link"
                  className="h-12 w-full rounded-lg border border-transparent bg-[var(--surface-muted)] px-3.5 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[rgba(22,24,29,0.2)]"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={artemisSuggestionsOpen && artemisSuggestions.length > 0}
                  aria-autocomplete="list"
                  aria-controls="artemis-suggestions"
                  aria-describedby="artemis-feedback"
                />
                {artemisSuggestionsOpen && artemisSuggestions.length > 0 && artemisSuggestionsRect && createPortal(
                  <ul
                    id="artemis-suggestions"
                    role="listbox"
                    style={{ position: "fixed", top: artemisSuggestionsRect.top, left: artemisSuggestionsRect.left, width: artemisSuggestionsRect.width, maxHeight: artemisSuggestionsRect.maxHeight }}
                    className="dashboard-theme z-[60] overflow-y-auto rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg"
                  >
                    {artemisSuggestions.map((suggestion, index) => (
                      <li key={suggestion.handle} role="option" aria-selected={index === artemisActiveSuggestion}>
                        <button
                          type="button"
                          // preventDefault keeps focus in the input so onBlur
                          // doesn't close the list before the click lands.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void chooseArtemisProfile(suggestion)}
                          onMouseEnter={() => setArtemisActiveSuggestion(index)}
                          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${index === artemisActiveSuggestion ? "bg-[var(--surface-muted)]" : ""}`}
                        >
                          <SubstackSuggestionLogo src={suggestion.avatarUrl} name={suggestion.name} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                            <span className="mono block truncate text-xs text-[var(--muted)]">@{suggestion.handle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>,
                  document.body
                )}
              </div>
            ) : (
              <div className="mt-7 flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] px-4 py-3" aria-busy={artemisLoadingArticles}>
                <SubstackSuggestionLogo src={artemisProfile.avatarUrl} name={artemisProfile.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{artemisProfile.name}</span>
                  <span className="mono block truncate text-xs text-[var(--muted)]">@{artemisProfile.handle}</span>
                </span>
                {artemisLoadingArticles ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted)]" role="status">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    <span className="sr-only">Loading articles…</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={changeArtemisProfile}
                    className="shrink-0 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                  >
                    Change
                  </button>
                )}
              </div>
            )}

            {artemisProfile && artemisArticles && artemisArticles.length === 0 && (
              <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-5 text-center text-sm text-[var(--muted)]">
                No published articles yet on this profile.
              </p>
            )}

            <div id="artemis-feedback" className="mt-3 min-h-6 text-sm leading-5" role="status" aria-live="polite">
              {!artemisProfile && artemisChecking && !artemisUrlDetected && !artemisError && (
                <span className="inline-flex items-center gap-1.5 text-[var(--quiet)]">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Checking…
                </span>
              )}
              {!artemisProfile && artemisUrlDetected && !artemisError && (
                <span className="inline-flex items-start gap-1.5 text-[#165c3e]">
                  <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Artemis article link detected</span>
                </span>
              )}
              {artemisError && <span role="alert" className="text-[#8d2f2d]">{artemisError}</span>}
            </div>

            {!artemisProfile && (
              <button
                type="button"
                data-testid="artemis-import-button"
                onClick={submitArtemis}
                disabled={artemisPending || !artemisUrlDetected}
                className="button button-primary mt-4 w-full justify-center py-3 disabled:opacity-40"
              >
                {artemisPending ? <><Loader2 size={16} className="animate-spin" /> Importing…</> : <>Import article <ArrowRight size={16} /></>}
              </button>
            )}
          </motion.section>
        )}

        {step === "x" && (
          <motion.section
            key="x"
            role="dialog"
            aria-modal="true"
            aria-labelledby="x-onboarding-title"
            className={`${cardClass} max-w-md`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <button type="button" onClick={() => setStep("platform")} className="dashboard-icon-button absolute left-4 top-4" aria-label="Back to choose where you write">
              <ArrowLeft size={15} />
            </button>
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--quiet)]">Step 2 of 3</p>
              <h1 id="x-onboarding-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Import from X</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Find your X profile to import its published Articles, or paste one article link.</p>
            </div>

            {!xProfile ? (
              <div className="relative mt-7" ref={xFieldRef}>
                <label htmlFor="x-search-input" className="sr-only">
                  X handle, name, or article link
                </label>
                <input
                  id="x-search-input"
                  data-testid="x-search-input"
                  value={xInput}
                  onChange={(event) => {
                    setXInput(event.target.value);
                    if (xError) setXError(null);
                  }}
                  onKeyDown={(event) => {
                    if (xSuggestionsOpen && xSuggestions.length > 0) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setXActiveSuggestion((index) => (index + 1) % xSuggestions.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setXActiveSuggestion((index) => (index <= 0 ? xSuggestions.length - 1 : index - 1));
                        return;
                      }
                      if (event.key === "Escape") {
                        setXSuggestionsOpen(false);
                        return;
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        // Enter picks the highlighted writer, or the only match.
                        const pick = xActiveSuggestion >= 0
                          ? xSuggestions[xActiveSuggestion]
                          : xSuggestions.length === 1
                            ? xSuggestions[0]
                            : null;
                        if (pick) void chooseXProfile(pick);
                        return;
                      }
                    }
                    if (event.key === "Enter" && xUrlDetected) submitX();
                  }}
                  onBlur={() => setXSuggestionsOpen(false)}
                  placeholder="@handle or X article link"
                  className="h-12 w-full rounded-lg border border-transparent bg-[var(--surface-muted)] px-3.5 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[rgba(22,24,29,0.2)]"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  role="combobox"
                  aria-expanded={xSuggestionsOpen && xSuggestions.length > 0}
                  aria-autocomplete="list"
                  aria-controls="x-suggestions"
                  aria-describedby="x-feedback"
                />
                {xSuggestionsOpen && xSuggestions.length > 0 && xSuggestionsRect && createPortal(
                  <ul
                    id="x-suggestions"
                    role="listbox"
                    style={{ position: "fixed", top: xSuggestionsRect.top, left: xSuggestionsRect.left, width: xSuggestionsRect.width, maxHeight: xSuggestionsRect.maxHeight }}
                    className="dashboard-theme z-[60] overflow-y-auto rounded-lg border border-[var(--line)] bg-white py-1 shadow-lg"
                  >
                    {xSuggestions.map((suggestion, index) => (
                      <li key={suggestion.handle} role="option" aria-selected={index === xActiveSuggestion}>
                        <button
                          type="button"
                          // preventDefault keeps focus in the input so onBlur
                          // doesn't close the list before the click lands.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void chooseXProfile(suggestion)}
                          onMouseEnter={() => setXActiveSuggestion(index)}
                          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${index === xActiveSuggestion ? "bg-[var(--surface-muted)]" : ""}`}
                        >
                          <SubstackSuggestionLogo src={suggestion.avatarUrl} name={suggestion.name} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{suggestion.name}</span>
                            <span className="mono block truncate text-xs text-[var(--muted)]">@{suggestion.handle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>,
                  document.body
                )}
              </div>
            ) : (
              <div className="mt-7 flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] px-4 py-3" aria-busy={xLoadingArticles}>
                <SubstackSuggestionLogo src={xProfile.avatarUrl} name={xProfile.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{xProfile.name}</span>
                  <span className="mono block truncate text-xs text-[var(--muted)]">@{xProfile.handle}</span>
                </span>
                {xLoadingArticles ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted)]" role="status">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    <span className="sr-only">Loading articles…</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={changeXProfile}
                    className="shrink-0 text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
                  >
                    Change
                  </button>
                )}
              </div>
            )}

            {xProfile && xArticles && xArticles.length === 0 && (
              <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-5 text-center text-sm text-[var(--muted)]">
                No published Articles yet on this profile.
              </p>
            )}

            <div id="x-feedback" className="mt-3 min-h-6 text-sm leading-5" role="status" aria-live="polite">
              {!xProfile && xChecking && !xUrlDetected && !xError && (
                <span className="inline-flex items-center gap-1.5 text-[var(--quiet)]">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Checking…
                </span>
              )}
              {!xProfile && xUrlDetected && !xError && (
                <span className="inline-flex items-start gap-1.5 text-[#165c3e]">
                  <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>X article link detected</span>
                </span>
              )}
              {!xProfile && !xChecking && !xUrlDetected && !xError && xInput.trim().length >= 2 && xSuggestions.length === 0 && (
                <span className="text-[var(--quiet)]">
                  No results? Paste an <span className="mono">x.com</span> article link to import a single article.
                </span>
              )}
              {xError && <span role="alert" className="text-[#8d2f2d]">{xError}</span>}
            </div>

            {!xProfile && (
              <button
                type="button"
                data-testid="x-import-button"
                onClick={submitX}
                disabled={xPending || !xUrlDetected}
                className="button button-primary mt-4 w-full justify-center py-3 disabled:opacity-40"
              >
                {xPending ? <><Loader2 size={16} className="animate-spin" /> Importing…</> : <>Import article <ArrowRight size={16} /></>}
              </button>
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
              <p className="text-xs font-medium text-[var(--quiet)]">Step 3 of 4</p>
              <h1 id="substack-import-title" className="mt-2 text-balance text-2xl font-semibold tracking-[-0.02em]">Import your archive</h1>
              <p className="mt-2 text-pretty text-sm text-[var(--muted)]">Download your export from Substack, then upload it here.</p>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-[var(--muted)]" aria-hidden="true">1</span>
                  <h2 className="text-sm font-semibold">Request your export</h2>
                </div>
                <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                  <p className="text-sm leading-5 text-[var(--muted)]">This opens your export section directly — click ‘New export’, Substack will prepare it in a few minutes.</p>
                  <a href={settingsUrl ?? "#"} target="_blank" rel="noreferrer" data-testid="export-settings-link" className="button button-primary mt-3 w-full justify-center text-sm">
                    Open my export settings <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <ExportSettingsPreview />
                  <p className="mt-2 text-xs leading-4 text-[var(--muted)]">When it’s done, the ZIP appears in the Download column right on that page — no need to wait for Substack’s email.</p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-[var(--muted)]" aria-hidden="true">2</span>
                  <h2 className="text-sm font-semibold">Send it to us</h2>
                </div>

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadState.phase === "uploading" || uploadState.phase === "parsing"}
                  data-testid="drop-zone"
                  className={`grid min-h-32 w-full flex-1 place-items-center rounded-lg border-2 border-dashed p-6 text-center transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] ${
                    dragging
                      ? "border-[var(--ink)] bg-[#eaeaec]"
                      : "border-[var(--line)] bg-[var(--surface-muted)] hover:border-[var(--quiet)] hover:bg-[var(--hovered)]"
                  }`}
                >
                  {uploadState.phase === "uploading" || uploadState.phase === "parsing" ? (
                    <span className="grid justify-items-center gap-2.5">
                      <Loader2 size={22} className="animate-spin text-[var(--muted)]" aria-hidden="true" />
                      <span className="text-sm text-[var(--muted)]" role="status">
                        {uploadState.phase === "parsing" ? "Reading your archive…" : <>Uploading… <span className="tabular-nums">{uploadState.percent}%</span></>}
                      </span>
                      <span className="h-1 w-44 overflow-hidden rounded-full bg-[#e4e4e7]">
                        <span
                          className="block h-full rounded-full bg-[#18181b] transition-[width] duration-200"
                          style={{ width: `${uploadState.phase === "parsing" ? 100 : uploadState.percent}%` }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="grid justify-items-center gap-2">
                      <Upload size={28} className="text-[var(--muted)]" aria-hidden="true" />
                      <span className="text-sm font-medium text-[var(--ink)]">Drop your ZIP here</span>
                      <span className="text-xs text-[var(--muted)]">or click to browse</span>
                    </span>
                  )}
                </button>

                <div className="rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="text-center text-xs text-[var(--muted)]">Prefer email? Attach the file or forward Substack’s export email.</p>
                  <a href={mailtoHref} data-testid="email-export-link" className="button button-secondary mt-2 w-full justify-center text-sm">
                    <Mail size={14} aria-hidden="true" /> Email my export
                  </a>
                </div>
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
              <p className="text-xs font-medium text-[var(--quiet)]">
                {archive.source === "artemis" || archive.source === "x" ? "Step 3 of 3" : "Step 4 of 4"}
              </p>
              <h1 id="substack-price-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Set your price</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Choose what goes live, then set one price or fine-tune each post.</p>
            </div>

            <div className="mt-7">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg bg-[var(--surface-muted)] px-4 py-3">
                <input
                  type="checkbox"
                  checked={isFree}
                  onChange={(event) => {
                    setIsFree(event.target.checked);
                    setPriceDraft(null);
                  }}
                  className="h-4 w-4 accent-[var(--ink)]"
                  data-testid="free-access-checkbox"
                />
                <span className="text-sm font-medium">Make these articles free</span>
              </label>

              <fieldset disabled={isFree} className="mt-5 disabled:opacity-40">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">Price per word</span>
                  <span className="mono text-sm font-semibold tabular-nums">
                    $
                    <input
                      type="number"
                      inputMode="decimal"
                      min={PRICE_MIN}
                      step={PRICE_STEP}
                      value={priceDraft ?? price.toFixed(4)}
                      onChange={(event) => {
                        setPriceDraft(event.target.value);
                        const parsed = Number(event.target.value);
                        if (Number.isFinite(parsed) && parsed >= PRICE_MIN) setPrice(parsed);
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
                  min={PRICE_SLIDER_MIN_EXPONENT}
                  max={PRICE_SLIDER_MAX_EXPONENT}
                  step={PRICE_SLIDER_STEP}
                  value={sliderValue}
                  onChange={(event) => {
                    setPrice(sliderValueToPrice(Number(event.target.value)));
                    setPriceDraft(null);
                  }}
                  className="substack-price-slider mt-3 w-full"
                  style={{ background: `linear-gradient(to right, #18181b ${sliderPercent}%, #e4e4e7 ${sliderPercent}%)` }}
                  aria-label="Price per word slider"
                  aria-valuetext={`$${price.toFixed(4)} per word`}
                />
                <div className="mt-1 flex justify-between text-[0.65rem] tabular-nums text-[var(--quiet)]">
                  <span>${PRICE_MIN}</span>
                  <span>${PRICE_SLIDER_MAX}</span>
                </div>
              </fieldset>
              {!isFree && recommendedPrice !== null && (
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
                <div className="text-xs font-medium leading-4 text-[var(--muted)]">Your average post</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]">
                  ${(archive.averageWordCount * (isFree ? 0 : price)).toFixed(2)}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">{archive.averageWordCount.toLocaleString()} words</div>
              </div>
              <div className="rounded-lg bg-[var(--surface-muted)] p-4">
                <div className="text-xs font-medium leading-4 text-[var(--muted)]">Full archive</div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]">
                  ${archiveTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]" role="status" data-testid="import-summary">
                  {selectedPosts.length.toLocaleString()} of {archive.postCount.toLocaleString()} posts · {selectedWordCount.toLocaleString()} words
                </div>
              </div>
            </div>

            {archive.posts.length > 0 && (
              <div className={`mt-3 rounded-lg bg-[var(--surface-muted)] ${isFree ? "opacity-40" : ""}`}>
                <button
                  type="button"
                  onClick={() => setDrawerOpen((current) => !current)}
                  aria-expanded={drawerOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">Choose and price posts</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">Only selected posts become accessible to agents.</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="rounded-md bg-white px-1.5 py-0.5 font-medium">{selectedPosts.length}/{archive.posts.length} selected</span>
                    {overrideCount > 0 && <span className="rounded-md bg-white px-1.5 py-0.5 font-medium">{overrideCount} adjusted</span>}
                    <ChevronDown size={16} className={`transition-transform ${drawerOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </span>
                </button>
                {drawerOpen && (
                  <ul className="max-h-52 overflow-y-auto border-t border-[var(--line)]">
                    {archive.posts.map((post) => (
                      <li key={post.id} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5 last:border-b-0">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedPostIds.includes(post.id)}
                            onChange={(event) => setSelectedPostIds((current) => event.target.checked
                              ? [...current, post.id]
                              : current.filter((id) => id !== post.id))}
                            className="h-4 w-4 shrink-0 accent-[var(--ink)]"
                            aria-label={`Import ${post.title || "untitled post"}`}
                          />
                          <div className={`min-w-0 ${selectedPostIds.includes(post.id) ? "" : "opacity-50"}`}>
                            <div className="truncate text-sm font-medium">{post.title || "Untitled post"}</div>
                            <div className="mt-0.5 text-xs tabular-nums text-[var(--muted)]">
                              {post.wordCount.toLocaleString()} words · ${(post.wordCount * effectivePostPrice(post.id)).toFixed(2)}
                            </div>
                          </div>
                        </label>
                        <label className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
                          $
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step={PRICE_STEP}
                            value={postPrices[post.id] ?? price.toFixed(4)}
                            disabled={isFree || !selectedPostIds.includes(post.id)}
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
              disabled={goingLive || selectedPostIds.length === 0}
              className="button button-primary mt-5 w-full justify-center py-3 disabled:opacity-40"
            >
              {goingLive ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : selectedPostIds.length === 0 ? "Select at least one post" : <>Go live with {selectedPosts.length} {selectedPosts.length === 1 ? "post" : "posts"} <ArrowRight size={16} /></>}
            </button>
          </motion.section>
        )}

        {step === "success" && (
          <motion.section
            key="success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="substack-success-title"
            className={`${cardClass} max-w-md text-center`}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.24, ease: EASE_OUT }}
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--ink)]" aria-hidden="true">
              <Check size={23} strokeWidth={2.25} />
            </div>
            <h1 id="substack-success-title" className="mt-5 text-2xl font-semibold tracking-[-0.02em]">
              {publishedCount === 1 ? "Your article is live" : `${publishedCount} articles are live`}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Agents can now discover and access {publishedCount === 1 ? "it" : "them"}.</p>
            <button
              type="button"
              data-testid="view-articles-button"
              onClick={viewArticles}
              className="button button-primary mt-7 w-full justify-center py-3"
            >
              View {publishedCount === 1 ? "article" : "articles"} <ArrowRight size={16} />
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );

  if (!portalReady) return <OnboardingEntryScreen />;
  return createPortal(onboardingPage, document.body);
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
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-white p-3" aria-hidden="true">
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
