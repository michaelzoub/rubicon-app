"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import posthog from "posthog-js";
import { useCallback, useEffect, useState } from "react";
import { OBJECTION_OPTIONS, type WriterObjection, writerHomeUrl } from "./writer-objection";

const eventContext = {
  user_type: "writer",
  page: "dashboard_auth",
  section: "writer_auth_screen",
  flow_step: "auth",
  authenticated: false,
};

export function trackWriterExitIntentOpened() {
  posthog.capture("writer_exit_intent_opened", eventContext);
}

function trackWriterExitCancelled() {
  posthog.capture("writer_exit_cancelled", eventContext);
}

export function trackWriterExitConfirmed(objection?: WriterObjection) {
  if (objection) posthog.capture("writer_objection_selected", { ...eventContext, objection });
  posthog.capture("writer_exit_confirmed", { ...eventContext, ...(objection ? { objection } : {}) });
}

export function WriterObjectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduceMotion = useReducedMotion();
  const [objection, setObjection] = useState<WriterObjection | null>(null);

  useEffect(() => {
    if (open) setObjection(null);
  }, [open]);

  const cancel = useCallback(() => {
    trackWriterExitCancelled();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, open]);

  function goHome() {
    trackWriterExitConfirmed(objection ?? undefined);
    window.location.assign(writerHomeUrl());
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.01 : 0.2 }}
          onClick={cancel}
          role="presentation"
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="writer-objection-title"
            className="w-full max-w-md rounded-lg border border-black/[0.12] bg-white p-6 text-left"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="writer-objection-title" className="text-balance text-lg font-semibold tracking-[-0.01em] text-[#171717]">
              Why no list article yet?
            </h2>
            <p className="mt-1 text-pretty text-sm text-[#73757c]">Quick answer help us fix Rubicon.</p>
            <div className="mt-4 grid gap-1" role="radiogroup" aria-label="Reason for leaving">
              {OBJECTION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    objection === option.value
                      ? "bg-[#f1f1f2] font-medium text-[#171717]"
                      : "text-[#3f4147] hover:bg-[#f7f7f8]"
                  }`}
                >
                  <input
                    type="radio"
                    name="writer-objection"
                    value={option.value}
                    checked={objection === option.value}
                    onChange={() => setObjection(option.value)}
                    className="accent-[#171717]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
              <button type="button" onClick={goHome} className="rounded-md px-3.5 py-2 text-sm font-medium text-[#73757c] hover:text-[#171717] active:scale-[0.96] transition-transform">
                Go home
              </button>
              <button type="button" onClick={cancel} className="button button-primary text-sm active:scale-[0.96] transition-transform">
                Keep listing
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
