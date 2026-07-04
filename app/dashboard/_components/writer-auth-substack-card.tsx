"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Share,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

const PARAGRAPHS: Array<Array<{ text: string; bold?: boolean }>> = [
  [
    { text: "Agents do not browse.", bold: true },
    { text: "They request the smallest passage that answers a prompt." },
  ],
  [{ text: "Rubicon lists the article, hides the rest, and settles each unlock as USDC." }],
];

const BODY_WORDS = PARAGRAPHS.flatMap((segments, para) =>
  segments.flatMap(({ text, bold = false }) =>
    text.split(" ").map((word) => ({ text: word, bold, para })),
  ),
);

const TICK_MS = 190;
const PAUSE_TICKS = 16;
// Once per cycle: the agent-read badge pops a few words in, the micropayment
// badge follows about a second later. Both hold until the cycle resets.
const AGENT_READ_STEP = 6;
const MICROPAYMENT_STEP = AGENT_READ_STEP + Math.round(1000 / TICK_MS);

const badgePop = {
  initial: { opacity: 0, y: 12, scale: 0.86 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.94 },
  transition: { type: "spring" as const, duration: 0.45, bounce: 0 },
};

export function WriterAuthSubstackCard() {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const interval = window.setInterval(() => {
      setStep((s) => (s >= BODY_WORDS.length + PAUSE_TICKS ? 0 : s + 1));
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [reduceMotion]);

  const revealed = reduceMotion ? BODY_WORDS.length : Math.min(step, BODY_WORDS.length);
  const agentReadVisible = reduceMotion || step >= AGENT_READ_STEP;
  const micropaymentVisible = reduceMotion || step >= MICROPAYMENT_STEP;

  return (
    <div className="writer-auth-showcase" aria-hidden="true">
      <AnimatePresence initial={false}>
        {agentReadVisible && (
          <motion.div
            className="writer-auth-showcase-badge writer-auth-showcase-badge-top"
            {...badgePop}
          >
            <span className="writer-auth-showcase-badge-icon">
              <Sparkles size={15} strokeWidth={2.2} />
            </span>
            <span className="writer-auth-showcase-badge-copy">
              <strong>AI agent read</strong>
              your article
            </span>
            <span className="writer-auth-showcase-badge-amount">+$0.24</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="writer-auth-substack-window">
        <div className="writer-auth-substack-titlebar">
          <span className="writer-auth-substack-dots">
            <i data-tone="red" />
            <i data-tone="yellow" />
            <i data-tone="green" />
          </span>
          <span className="writer-auth-substack-titlebar-label">Substack</span>
        </div>
        <div className="writer-auth-substack-header">
          <X size={19} strokeWidth={2.4} />
          <span className="writer-auth-substack-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative local asset inside a mock window */}
            <img src="/substacklogo.png" alt="" />
            Rubicon on Substack
          </span>
          <MoreHorizontal size={19} strokeWidth={2.4} />
        </div>
        <div className="writer-auth-substack-article">
          <h3>Why agents pay per word</h3>
          <p className="writer-auth-substack-subtitle">
            Pricing writing for autonomous readers, not ad impressions.
          </p>
          <div className="writer-auth-substack-author">
            <span className="writer-auth-substack-avatar" />
            <span className="writer-auth-substack-byline">
              <strong>Satoshi Nakamoto</strong>
              Mar 4, 2026
            </span>
          </div>
          {PARAGRAPHS.map((_, para) => (
            <p className="writer-auth-substack-body" key={para}>
              {BODY_WORDS.map(
                (word, index) =>
                  word.para === para && (
                    <span
                      key={index}
                      className={`writer-auth-substack-word${
                        index < revealed ? " is-revealed" : ""
                      }${word.bold ? " is-bold" : ""}`}
                    >
                      {word.text}{" "}
                    </span>
                  ),
              )}
            </p>
          ))}
        </div>
        <div className="writer-auth-substack-footer">
          <Heart size={20} strokeWidth={1.8} />
          <MessageCircle size={20} strokeWidth={1.8} />
          <Repeat2 size={20} strokeWidth={1.8} />
          <Share size={20} strokeWidth={1.8} />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {micropaymentVisible && (
          <motion.div
            className="writer-auth-showcase-badge writer-auth-showcase-badge-bottom"
            {...badgePop}
          >
            <span className="writer-auth-showcase-badge-icon writer-auth-showcase-badge-icon-dollar">
              $
            </span>
            <span className="writer-auth-showcase-badge-copy">
              <strong>Micropayment</strong>
              earned
            </span>
            <span className="writer-auth-showcase-badge-amount">+$0.24</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
