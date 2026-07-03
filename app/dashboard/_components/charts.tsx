"use client";

/**
 * Lightweight data-viz primitives for the dashboard.
 *
 * Interactive charts use Recharts while small transitions use framer-motion.
 * All visuals use the dashboard theme tokens so they stay on-brand in light mode.
 *
 * Motion respects `prefers-reduced-motion`: when the user opts out we render the
 * final state immediately instead of animating.
 */

import { animate, motion, useReducedMotion } from "framer-motion";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ---------- animated number ---------- */

/**
 * Counts up to `value` whenever it changes. `format` controls how the
 * in-flight number is rendered (e.g. currency, thousands separators).
 */
export function CountUp({
  value,
  format,
  duration = 0.55,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  return <>{format(display)}</>;
}

/* ---------- entrance reveal ---------- */

/** Fades + lifts children into view on mount. `delay` staggers siblings. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.24, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- trend bars ---------- */

export interface TrendBar {
  /** Short axis label, e.g. "Jun 12". */
  label: string;
  /** Longer label used in the hover tooltip, e.g. "Thu, Jun 12". */
  fullLabel: string;
  /** Bar value in display units (already converted from atomic). */
  value: number;
  /** Secondary line in the tooltip, e.g. "1,204 words". */
  detail?: string;
}

/**
 * Vertical bar chart for a time series (earnings or reads over time). Bars grow
 * on mount and lift / brighten on hover, with a floating tooltip.
 */
export function TrendChart({
  bars,
  formatValue,
  height = 168,
}: {
  bars: TrendBar[];
  formatValue: (n: number) => string;
  height?: number;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);

  return (
    <div className="dashboard-data-viz select-none">
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {bars.map((bar, i) => {
          const pct = max > 0 ? (bar.value / max) * 100 : 0;
          const isActive = active === i;
          return (
            <div
              key={i}
              className="group relative flex h-full flex-1 cursor-default items-end"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
            >
              {/* tooltip */}
              {isActive && bar.value > 0 && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-center">
                  <div className="text-sm font-semibold text-[var(--ink)]">{formatValue(bar.value)}</div>
                  <div className="mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--muted)]">{bar.fullLabel}</div>
                  {bar.detail && <div className="text-[0.7rem] text-[var(--muted)]">{bar.detail}</div>}
                </div>
              )}
              {/* track */}
              <div className="absolute inset-x-0 bottom-0 top-0 rounded bg-[var(--surface-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
              {/* bar */}
              <motion.div
                className="relative w-full rounded rounded-b-sm"
                style={{
                  minHeight: bar.value > 0 ? 4 : 0,
                  height: `${pct}%`,
                  background: isActive ? "var(--river-deep)" : "var(--river)",
                  transformOrigin: "bottom",
                }}
                initial={reduce ? false : { transform: "scaleY(0)" }}
                animate={{ transform: "scaleY(1)" }}
                transition={{ duration: 0.38, delay: reduce ? 0 : i * 0.018, ease: [0.23, 1, 0.32, 1] }}
              />
            </div>
          );
        })}
      </div>
      {/* axis */}
      <div className="mt-2.5 flex items-center justify-between text-[0.62rem] text-[var(--muted)]">
        <span>{bars[0]?.label}</span>
        <span>{bars[Math.floor(bars.length / 2)]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/* ---------- donut ---------- */

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

/** Monochrome ink ramp, deep → pale: rank reads by lightness, the legend carries identity. */
export const DONUT_COLORS = ["#18181b", "#47474d", "#75757c", "#a3a3ab", "#d2d2d7"];

/**
 * Ring chart with a centered headline. Slices sweep in clockwise on mount and
 * the hovered slice's legend row highlights.
 */
export function Donut({
  slices,
  centerValue,
  centerLabel,
  showCenter = true,
  size = 168,
  stroke = 22,
}: {
  slices: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  showCenter?: boolean;
  size?: number;
  stroke?: number;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let offsetAcc = 0;

  return (
    <div className="grid w-full min-w-0 grid-cols-1 items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* track */}
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-muted)" strokeWidth={stroke} />
          {total > 0 &&
            slices.map((slice, i) => {
              const fraction = slice.value / total;
              // 2px of surface between adjacent slices keeps the lightness ramp readable.
              const slicePad = slices.length > 1 ? 2 : 0;
              const dash = Math.max(fraction * circumference - slicePad, 0.0001);
              const gap = circumference - dash;
              const dashOffset = -offsetAcc * circumference;
              offsetAcc += fraction;
              const isActive = active === i;
              const dim = active !== null && !isActive;
              return (
                <motion.circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={isActive ? stroke + 4 : stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={dashOffset}
                  initial={reduce ? false : { strokeDasharray: `0 ${circumference}` }}
                  animate={{ strokeDasharray: `${dash} ${gap}`, opacity: dim ? 0.35 : 1 }}
                  transition={{ duration: 0.46, delay: reduce ? 0 : 0.05 + i * 0.045, ease: [0.23, 1, 0.32, 1] }}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                  style={{ cursor: "pointer", transition: "stroke-width 180ms ease" }}
                />
              );
            })}
        </svg>
        {showCenter && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="text-xl font-semibold tracking-[-0.01em]">{centerValue}</div>
            <div className="mono text-[0.58rem] uppercase tracking-[0.12em] text-[var(--muted)]">{centerLabel}</div>
          </div>
        )}
      </div>

      {/* legend */}
      <ul className="w-full min-w-0 space-y-2.5 overflow-hidden">
        {slices.map((slice, i) => {
          const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
          return (
            <li
              key={i}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors ${active === i ? "bg-[var(--surface-muted)]" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{slice.label}</span>
              <span className="mono shrink-0 text-xs font-medium text-[var(--muted)]">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- sparkline ---------- */

/**
 * Compact Recharts line chart for stat cards. Hovering or focusing the chart
 * reveals the value and its period in a flat, border-led tooltip.
 */
export function Sparkline({
  values,
  labels,
  metricLabel,
  details,
  formatValue = (value) => String(value),
  color = "var(--ink)",
  height = 40,
  strokeWidth = 1.5,
}: {
  values: number[];
  labels?: string[];
  metricLabel: string;
  details?: string[];
  formatValue?: (value: number) => string;
  color?: string;
  height?: number;
  strokeWidth?: number;
}) {
  const reduce = useReducedMotion();
  if (values.length < 2) return null;

  const data = values.map((value, index) => ({
    value,
    label: labels?.[index] ?? `Period ${index + 1}`,
    detail: details?.[index],
  }));

  return (
    <div className="relative z-10 mt-auto w-full min-w-0 overflow-visible" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 3, bottom: 4, left: 3 }} accessibilityLayer>
          <Tooltip
            allowEscapeViewBox={{ x: true, y: true }}
            cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const value = Number(payload[0].value ?? 0);
              const point = payload[0].payload as { label?: string; detail?: string } | undefined;
              return (
                <div className="min-w-44 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[0.68rem] text-[var(--muted)]">Date</span>
                    <span className="text-xs font-medium text-[var(--ink)]">{point?.label ?? "Unknown date"}</span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-[var(--line)] pt-1.5">
                    <span className="text-[0.68rem] text-[var(--muted)]">{metricLabel}</span>
                    <span className="text-xs font-semibold tabular-nums text-[var(--ink)]">{formatValue(value)}</span>
                  </div>
                  {point?.detail && <div className="mt-1.5 border-t border-[var(--line)] pt-1.5 text-right text-[0.68rem] text-[var(--muted)]">{point.detail}</div>}
                </div>
              );
            }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none", pointerEvents: "none", zIndex: 50 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={strokeWidth}
            dot={false}
            activeDot={{ r: 3, fill: color, stroke: "white", strokeWidth: 1.5 }}
            isAnimationActive={!reduce}
            animationDuration={500}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- big-number insight tile ---------- */

/** Oversized metric card in the "performance" style — big value, quiet caption. */
export function InsightTile({
  value,
  caption,
  className = "",
}: {
  value: ReactNode;
  caption: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col justify-between rounded-lg border border-[var(--line)] bg-white p-4 ${className}`}>
      <div className="text-2xl font-semibold tracking-[-0.02em] sm:text-[1.8rem]">{value}</div>
      <div className="mt-1.5 text-xs text-[var(--muted)]">{caption}</div>
    </div>
  );
}
