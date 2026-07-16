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

import { motion, useReducedMotion } from "framer-motion";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DonutSlice } from "./chart-data";

export { buildEarningsDonutSlices, DONUT_COLORS, type DonutSlice } from "./chart-data";

/* ---------- animated number ---------- */

/**
 * Stable number formatting for dashboard metrics. Values intentionally do not
 * re-animate on refresh, avoiding repeated motion and digit churn.
 */
export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (n: number) => string;
}) {
  return <>{format(value)}</>;
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

/* ---------- trend line ---------- */

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

export function ChartFrame({ children, height, className = "" }: { children: ReactNode; height: number | string; className?: string }) {
  return <div className={`dashboard-data-viz w-full select-none ${className}`} style={{ height }} data-chart-frame>{children}</div>;
}

export function ChartTooltip({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="min-w-40 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-left">
      <div className="dashboard-meta">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      {detail && <div className="dashboard-meta mt-1">{detail}</div>}
    </div>
  );
}

export function ChartEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="relative flex h-full min-h-44 items-center justify-center overflow-hidden border-t border-dashed border-[var(--line)] px-5 text-center">
      <div>
        <p className="text-sm font-medium text-[var(--ink)]">{title}</p>
        {description && <p className="dashboard-meta mt-1 max-w-sm text-pretty">{description}</p>}
      </div>
    </div>
  );
}

export function ChartLoadingState({ label = "Loading chart" }: { label?: string }) {
  return (
    <div className="grid h-full min-h-44 content-end gap-4 border-t border-[var(--line)] p-4" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {[72, 46, 63, 38].map((width) => <span key={width} className="rubicon-skeleton h-px" style={{ width: `${width}%` }} />)}
    </div>
  );
}

/**
 * Compact analytics line chart with restrained axes and a detailed hover state.
 * The values remain the real daily series; the chart only adds enough structure
 * to make changes over time legible at a glance.
 */
export function TrendChart({
  bars,
  formatValue,
  height = 168,
}: {
  bars: TrendBar[];
  formatValue: (n: number) => string;
  height?: number | string;
}) {
  const reduce = useReducedMotion();
  const animateOnFirstData = useFirstDataAnimation(bars.length > 0);
  const max = Math.max(...bars.map((b) => b.value), 0);
  const data = bars.map((bar, index) => ({ ...bar, index }));

  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 4" />
          <XAxis
            dataKey="label"
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={42}
            tick={{ fill: "var(--quiet)", fontSize: 10 }}
            tickMargin={9}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={48}
            domain={[0, max > 0 ? "auto" : 1]}
            tick={{ fill: "var(--quiet)", fontSize: 10 }}
            tickFormatter={formatValue}
            tickCount={4}
          />
          <Tooltip
            cursor={{ stroke: "var(--quiet)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as TrendBar;
              return <ChartTooltip label={point.fullLabel} value={formatValue(point.value)} detail={point.detail} />;
            }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none", pointerEvents: "none", zIndex: "var(--dashboard-z-popover)" }}
          />
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--river)"
            strokeWidth={1.25}
            dot={false}
            activeDot={{ r: 3, fill: "var(--ink)", stroke: "white", strokeWidth: 1.5 }}
            isAnimationActive={!reduce && animateOnFirstData}
            animationDuration={240}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ---------- donut ---------- */

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
  const activeStroke = stroke + 2;
  const safetyInset = 2;
  const radius = (size - activeStroke - safetyInset * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const centerContentMaxWidth = Math.max(0, size - activeStroke - safetyInset * 2 - stroke);

  let offsetAcc = 0;

  return (
    <div className="grid w-full min-w-0 grid-cols-1 items-center justify-items-center gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:justify-items-stretch sm:gap-5" data-donut>
      <div className="relative shrink-0 overflow-hidden" style={{ width: size, height: size }} data-donut-chart>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
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
                  strokeWidth={isActive ? activeStroke : stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${dash} ${gap}`}
                  strokeDashoffset={dashOffset}
                  initial={reduce ? false : { strokeDasharray: `0 ${circumference}` }}
                  animate={{ strokeDasharray: `${dash} ${gap}`, opacity: dim ? 0.35 : 1 }}
                  transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : i * 0.025, ease: [0.23, 1, 0.32, 1] }}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
                  onPointerMove={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((cur) => (cur === i ? null : cur))}
                  tabIndex={0}
                  aria-label={`${slice.label}: ${((slice.value / total) * 100).toFixed(1)}%`}
                  data-donut-segment
                  data-active={isActive ? "true" : "false"}
                  style={{ cursor: "pointer", transition: reduce ? "none" : "stroke-width var(--dashboard-motion-fast) var(--dashboard-ease-out)" }}
                />
              );
            })}
        </svg>
        {showCenter && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="min-w-0" style={{ maxWidth: centerContentMaxWidth }}>
              <div className="truncate text-lg font-semibold tracking-[-0.01em]" title={centerValue}>{centerValue}</div>
              <div className="truncate text-[0.68rem] text-[var(--muted)]" title={centerLabel}>{centerLabel}</div>
            </div>
          </div>
        )}
      </div>

      {/* legend */}
      <ul className="w-full min-w-0 space-y-1 overflow-hidden" aria-label={`${centerLabel} breakdown`}>
        {slices.map((slice, i) => {
          const pct = total > 0 ? (slice.value / total) * 100 : 0;
          const fullLabel = slice.groupedLabels?.length
            ? `${slice.label}: ${slice.groupedLabels.join(", ")}`
            : slice.label;
          return (
            <li
              key={i}
              className={`flex min-h-8 items-center gap-2.5 rounded-[5px] px-2 py-1 transition-[background-color,color,opacity] duration-150 motion-reduce:transition-none ${active === i ? "bg-black/[0.035]" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
              onPointerMove={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((cur) => (cur === i ? null : cur))}
              tabIndex={0}
              data-donut-legend-row
              data-active={active === i ? "true" : "false"}
              title={fullLabel}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{slice.label}</span>
              <span className="mono w-12 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--muted)]">{pct.toFixed(1)}%</span>
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
  strokeWidth = 1.25,
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
  const animateOnFirstData = useFirstDataAnimation(values.length > 1);
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
              return <ChartTooltip label={point?.label ?? "Unknown date"} value={`${metricLabel}: ${formatValue(value)}`} detail={point?.detail} />;
            }}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none", pointerEvents: "none", zIndex: "var(--dashboard-z-popover)" }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={strokeWidth}
            dot={false}
            activeDot={{ r: 3, fill: color, stroke: "white", strokeWidth: 1.5 }}
            isAnimationActive={!reduce && animateOnFirstData}
            animationDuration={220}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function useFirstDataAnimation(hasData: boolean) {
  const hasAnimated = useRef(false);
  const shouldAnimate = hasData && !hasAnimated.current;
  useEffect(() => {
    if (hasData) hasAnimated.current = true;
  }, [hasData]);
  return shouldAnimate;
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
