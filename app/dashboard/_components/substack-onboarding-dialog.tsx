"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ExternalLink, MousePointer2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

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
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"welcome" | "substack">("welcome");
  const [username, setUsername] = useState("");
  const [demoPressing, setDemoPressing] = useState(false);

  useEffect(() => {
    const seen = window.localStorage.getItem("rubicon-substack-onboarding-seen") === "1";
    if (shouldOpen && (forceOpen || !seen)) {
      setStep("welcome");
      setOpen(true);
    }
  }, [forceOpen, shouldOpen]);

  useEffect(() => {
    if (!open || step !== "welcome") return;
    const timer = window.setTimeout(() => setStep("substack"), reduceMotion ? 500 : 2600);
    return () => window.clearTimeout(timer);
  }, [open, reduceMotion, step]);

  // Demo playback: once the connect step is on screen, type the username, then
  // animate a cursor press on Continue. The outer video engine loops the scene.
  useEffect(() => {
    if (!demo || step !== "substack") return;
    const target = "marachen";
    setUsername("");
    setDemoPressing(false);
    let typer = 0;
    let pressTimer = 0;
    let index = 0;
    const startTimer = window.setTimeout(() => {
      typer = window.setInterval(() => {
        index += 1;
        setUsername(target.slice(0, index));
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

  const cleanUsername = useMemo(
    () => username.trim().replace(/^https?:\/\//, "").replace(/\.substack\.com.*$/i, "").replace(/[^a-z0-9_-]/gi, ""),
    [username],
  );
  const settingsUrl = cleanUsername ? `https://${cleanUsername}.substack.com/publish/settings#import-export-settings` : null;

  function close() {
    window.localStorage.setItem("rubicon-substack-onboarding-seen", "1");
    setOpen(false);
  }

  function continueToImport() {
    if (demo) return;
    if (!cleanUsername) return;
    window.localStorage.setItem("rubicon-substack-username", cleanUsername);
    close();
    router.push(`/dashboard/import/substack?username=${encodeURIComponent(cleanUsername)}`);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-white p-5" role="presentation">
      <OnboardingTileBackground />
      <button type="button" onClick={close} className="dashboard-icon-button absolute right-5 top-5" aria-label="Close onboarding">
        <X size={17} />
      </button>

      <AnimatePresence mode="wait" initial={false}>
        {step === "welcome" ? (
          <motion.section
            key="welcome"
            aria-live="polite"
            className="relative z-10 grid justify-items-center rounded-lg bg-white/94 px-12 py-10 text-center backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.65, ease: EASE_OUT }}
          >
            <motion.div
              className="drop-shadow-[0_6px_18px_rgba(18,18,22,0.18)]"
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
        ) : (
          <motion.section
            key="substack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="substack-onboarding-title"
            className="relative z-10 w-full max-w-md rounded-lg border border-black/[0.06] bg-white/96 p-8 backdrop-blur-[2px]"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.35, ease: EASE_OUT }}
          >
            <div className="text-center">
              <h1 id="substack-onboarding-title" className="text-2xl font-semibold tracking-[-0.02em]">Connect your Substack</h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Enter the username from your publication URL.</p>
            </div>

            <label className="mt-8 block">
              <span className="text-sm font-medium">Substack username</span>
              <div className="mt-3 flex h-11 items-center border-b border-black/20 bg-transparent transition-colors duration-150 focus-within:border-black">
                <span className="select-none text-sm text-[var(--muted)]">https://</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && continueToImport()}
                  placeholder="yourname"
                  className="min-w-20 flex-1 appearance-none bg-transparent px-1 text-sm font-medium outline-none placeholder:font-normal placeholder:text-[var(--muted)] focus:outline-none focus:ring-0"
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <span className="select-none text-sm text-[var(--muted)]">.substack.com</span>
              </div>
            </label>

            <div className="mt-4 min-h-10 text-sm leading-5">
              {settingsUrl ? (
                <a href={settingsUrl} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1.5 break-all font-medium text-[var(--river-deep)] underline decoration-neutral-300 underline-offset-4 hover:decoration-[var(--river-deep)]">
                  {"Your Substack profile"} <ExternalLink size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <span className="text-[var(--muted)]">Your Substack export is under Publication settings.</span>
              )}
            </div>

            <button
              type="button"
              onClick={continueToImport}
              disabled={!cleanUsername}
              className={`button button-primary mt-6 w-full justify-center py-3 disabled:opacity-40${demo && demoPressing ? " scale-[0.97]" : ""}`}
            >
              Continue <ArrowRight size={16} />
            </button>

            {demo && (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute z-20 drop-shadow-[0_2px_5px_rgba(0,0,0,0.35)]"
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
      </AnimatePresence>
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
