"use client";

import { useSuccessCelebration, SuccessCelebration } from "./success-celebration";
import type { ReactNode } from "react";

export function CopyConfetti({ onCopy, children, className = "", ariaLabel, disabled = false }: { onCopy: () => void | Promise<void>; children: ReactNode; className?: string; ariaLabel?: string; disabled?: boolean }) {
  const celebration = useSuccessCelebration();
  return (
    <span className={`relative inline-flex ${className}`}>
      <button type="button" aria-label={ariaLabel} disabled={disabled} className={className} onClick={async () => { await onCopy(); celebration.markCompletion("success"); }}>
        {children}
      </button>
      <SuccessCelebration active={celebration.celebrating} celebrationKey={celebration.celebrationKey} />
    </span>
  );
}
