"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type DialogEntry = {
  id: string;
  onClose: () => void;
  dismissOnBackdrop: boolean;
};

type OverlayContextValue = {
  root: HTMLDivElement | null;
  stack: DialogEntry[];
  register: (entry: DialogEntry) => void;
  unregister: (id: string) => void;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function DashboardOverlayProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [stack, setStack] = useState<DialogEntry[]>([]);

  const register = useCallback((entry: DialogEntry) => {
    setStack((current) => [...current.filter((item) => item.id !== entry.id), entry]);
  }, []);

  const unregister = useCallback((id: string) => {
    setStack((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    if (stack.length === 0) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [stack.length]);

  const value = useMemo(() => ({ root, stack, register, unregister }), [register, root, stack, unregister]);
  const activeDialog = stack.at(-1);

  return (
    <OverlayContext.Provider value={value}>
      {children}
      <div ref={setRoot} id="dashboard-overlay-root" className="dashboard-theme" data-dashboard-overlay-root />
      {root && createPortal(
        <AnimatePresence initial={false}>
          {activeDialog && (
            <motion.div
              key="dashboard-dialog-backdrop"
              aria-hidden="true"
              className="fixed inset-0 cursor-default bg-black/35"
              style={{ zIndex: "var(--dashboard-z-backdrop)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.16, ease: [0.23, 1, 0.32, 1] }}
              onClick={() => {
                if (activeDialog.dismissOnBackdrop) activeDialog.onClose();
              }}
            />
          )}
        </AnimatePresence>,
        root,
      )}
    </OverlayContext.Provider>
  );
}

export function DashboardDialog({
  open,
  onClose,
  children,
  ariaLabel,
  labelledBy,
  className = "",
  dismissOnBackdrop = true,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  labelledBy?: string;
  className?: string;
  dismissOnBackdrop?: boolean;
  closeDisabled?: boolean;
}) {
  const context = useContext(OverlayContext);
  if (!context) throw new Error("DashboardDialog must be rendered inside DashboardOverlayProvider.");
  const { register, root, stack, unregister } = context;

  const reduceMotion = useReducedMotion();
  const reactId = useId();
  const id = `dashboard-dialog-${reactId.replace(/:/g, "")}`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const safeClose = useCallback(() => {
    if (!closeDisabled) closeRef.current();
  }, [closeDisabled]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    register({ id, onClose: safeClose, dismissOnBackdrop: dismissOnBackdrop && !closeDisabled });
    return () => unregister(id);
  }, [closeDisabled, dismissOnBackdrop, id, open, register, safeClose, unregister]);

  const stackIndex = stack.findIndex((entry) => entry.id === id);
  const isTop = stackIndex >= 0 && stackIndex === stack.length - 1;

  useEffect(() => {
    if (!open || !isTop) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = getFocusable(dialog);
    const autofocus = dialog.querySelector<HTMLElement>("[data-autofocus]");
    (autofocus ?? focusable[0] ?? dialog).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        safeClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusable(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTop, open, safeClose]);

  useEffect(() => {
    if (open) return;
    returnFocusRef.current?.focus({ preventScroll: true });
    returnFocusRef.current = null;
  }, [open]);

  useEffect(() => () => {
    returnFocusRef.current?.focus({ preventScroll: true });
  }, []);

  if (!root) return null;

  return createPortal(
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="pointer-events-none fixed inset-0 grid place-items-center overflow-y-auto p-4 sm:p-6"
          style={{ zIndex: `calc(var(--dashboard-z-dialog) + ${Math.max(stackIndex, 0) * 2})` }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.12 : 0.16, ease: [0.23, 1, 0.32, 1] }}
          aria-hidden={!isTop}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal={isTop ? "true" : undefined}
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className={`pointer-events-auto relative my-auto max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-xl border border-[var(--line)] bg-white outline-none ${className}`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px) scale(0.98)" }}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(4px) scale(0.99)" }}
            transition={{ duration: reduceMotion ? 0.14 : 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    root,
  );
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hasAttribute("hidden")
      && element.getAttribute("aria-hidden") !== "true"
      && style.display !== "none"
      && style.visibility !== "hidden";
  });
}
