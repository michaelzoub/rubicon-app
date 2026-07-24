# Dashboard UI conventions

Use these rules for dashboard work. Preserve the current sidebar, restrained button treatment, and onboarding quality bar.

## Typography

- Page titles use `PageHeader`.
- Panel and card titles use `CardHeader`, `PanelHeader`, or the `dashboard-panel-title` class: dark primary text, 14px, semibold.
- Supporting descriptions, date ranges, rankings, and metadata use `dashboard-meta` or `var(--muted)`.
- KPI labels may stay muted. Dynamic values and aligned numeric columns use `tabular-nums`.
- Do not add one-off title colors or nearby helper copy that repeats the visible controls.

## Panels and rows

- Use `Card`/`DashboardPanel` for bordered dashboard surfaces.
- Use `CardHeader`/`PanelHeader` for a title plus optional trailing action.
- Dense activity rows use a stable grid, a minimum 40px row height, hairline separators, tabular numeric columns, truncation, and a quiet background hover.
- Empty states are short, specific, and use the shared `EmptyState` or `ChartEmptyState`.

## Charts

- Use the Recharts primitives in `app/dashboard/_components/charts.tsx`.
- Main line charts and sparklines share the same line weight, axis color, grid, active dot, and `ChartTooltip`.
- Charts animate only when data first appears. Ordinary refreshes must not replay the line animation or animate metric values.
- Loading, empty, sparse, zero, and error states must be explicit. Do not draw decorative stand-ins for missing data.

## Metrics and icons

- Use Lucide, the existing icon library. Default dashboard action icons are 14–16px with a 1.75–1.8 stroke width.
- Never use text or Unicode arrows for trends or navigation.
- Use `MetricTrend` for positive, negative, and neutral KPI comparisons.
- Interactive controls should provide a 40px desktop hit area and a subtle `scale(0.96)` pressed state.

## Motion

- Fast feedback: 140ms. Dialogs and small state changes: 160–200ms. User-initiated motion stays below 300ms.
- Entrances use `cubic-bezier(0.23, 1, 0.32, 1)` with opacity and a small transform.
- Avoid bounce, layout-shifting animation, `transition: all`, and repeated animation on refresh.
- Respect `prefers-reduced-motion`; keep useful opacity changes but remove movement.

## Dialogs and layering

- Render dashboard dialogs with `DashboardDialog` inside `DashboardOverlayProvider`.
- The provider owns the single backdrop, document scroll lock, stack order, Escape handling, focus trap, and focus restoration.
- When one workflow replaces another, close the current dialog before opening the next. Do not add arbitrary z-index values.
- Onboarding is the exception: it is an exclusive full-screen flow with its own body portal and must not overlap dashboard dialogs.

Layer tokens live in `app/dashboard/dashboard.css`:

| Layer | Token | Value |
| --- | --- | ---: |
| Content | `--dashboard-z-content` | 0 |
| Sticky UI | `--dashboard-z-sticky` | 20 |
| Dropdowns | `--dashboard-z-dropdown` | 30 |
| Popovers/tooltips | `--dashboard-z-popover` | 40 |
| Shared backdrop | `--dashboard-z-backdrop` | 80 |
| Dialogs and dialog stack | `--dashboard-z-dialog` | 90+ |
| Notifications | `--dashboard-z-notification` | 110 |

## Flat visual system

- Dashboard surfaces are flat, border-led, and shadow-free.
- Use spacing, type, fill, and border changes for hierarchy. Do not add glow, bokeh, blurred decoration, or elevation shadows.
- Keep the existing sidebar background and navigation treatment.
