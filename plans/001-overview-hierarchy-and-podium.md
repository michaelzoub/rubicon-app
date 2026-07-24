# Plan 001: Make the overview hierarchy and top-article podium intentional

> **Executor instructions**: Follow this plan step by step. Do not alter any `.button`, `.button-primary`, `.button-secondary`, `button`, or button-adjacent styles or markup. The user explicitly excluded button styling. If an adjustment would require doing so, stop and report it.
>
> **Drift check (run first)**: `git diff --stat 4574c9e..HEAD -- app/dashboard/_components/overview-content.tsx app/dashboard/_components/ui.tsx app/globals.css app/dashboard/_components/shell.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `4574c9e`, 2026-07-16

## Why this matters

The overview is the dashboard’s primary decision surface. Its chart and top-article ranking now sit together, but the podium’s three blocks share a fixed height and the loading skeleton still describes the previous chart-plus-sidebar composition. That leaves the key ranking illustration less visually decisive than its role, and produces a noticeable layout handoff when data arrives.

The dashboard’s governing presentation is flat and border-led: the last scoped CSS layer forces cards to a `#e9eaec` border with no shadow. Keep that identity everywhere except inside the podium itself, where restrained geometric depth is the requested, semantic visualization—not a dashboard-wide surface treatment.

## Current state

- `app/dashboard/_components/overview-content.tsx:161-221` builds the loaded overview in this order: metrics, chart/podium, earnings breakdown, activity map, two lists.
- `app/dashboard/_components/overview-content.tsx:244-306` still reserves a separate right-hand wallet sidebar in `OverviewSkeleton`, which no longer exists in the loaded composition.
- `app/dashboard/_components/overview-content.tsx:311-446` renders a three-place podium. Each place has the same `h-[7.25rem]` block height; only its top face uses perspective. The ranking order correctly places second, first, third left-to-right.
- `app/dashboard/_components/ui.tsx:78-103` is the shared stat-tile composition. Its sparkline is a deliberately low-opacity background layer, so it should not be redesigned while fixing the overview layout.
- `app/globals.css:6469-6506` is the final winning dashboard rule set: cards are flat, border-led, no-shadow; the main surface is neutral; all button and input shadows are removed. Preserve these decisions.
- `app/dashboard/_components/shell.tsx:201-213` owns the shared canvas/sidebar/main frame. It is out of scope unless visual validation proves an overview fix cannot work inside the current content width.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `pnpm exec tsc --noEmit --incremental false` | exit 0 with no TypeScript errors |
| Unit tests | `pnpm test` | exit 0 with all tests passing |
| Production build | `pnpm build` | exit 0 |
| Diff sanity | `git diff --check` | no output and exit 0 |

## Suggested executor toolkit

- Use the installed `better-ui` guidance for concentric radii, exact transition properties, and respecting reduced motion.
- Use the installed `rubicon-flat-ui` guidance if available. Its flat, border-led rule governs the shared dashboard; do not introduce card shadows, glow, or decorative wallpaper changes.

## Scope

**In scope**

- `app/dashboard/_components/overview-content.tsx`
- Optional: narrowly scoped podium selectors in `app/globals.css`, if utility classes cannot express the final visual cleanly.

**Out of scope**

- Any `button` styling or button markup, including the payout trigger, export, content-protection control, and sidebar controls.
- `app/dashboard/_components/shell.tsx`; do not change sidebar position, navigation, or desktop/mobile chrome.
- Shared `Card`, `StatTile`, or global dashboard-card rules in `app/dashboard/_components/ui.tsx` and `app/globals.css`.
- Analytics data, ranking calculations, ordering semantics, links, or labels.

## Steps

### Step 1: Reconcile loading and loaded overview geometry

In `OverviewSkeleton`, replace the obsolete `xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]` main/sidebar scaffold with the loaded overview’s vertical sequence: stat tiles, a chart-plus-secondary-card row, optional full-width sections, and paired lists. The secondary skeleton should represent the top-articles podium, not payout/wallet content.

Keep the skeleton compact and flat, use existing `Card` and `Skeleton`, and do not add controls. At `xl`, align its chart/podium proportion with the loaded `lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,1fr)]` track; below that breakpoint, stack naturally without horizontal overflow.

**Verify**: `pnpm exec tsc --noEmit --incremental false` → exit 0.

### Step 2: Give the three winners a true, data-respecting 3D podium

In `TopArticlesPodium` and `PodiumPlace`, retain current semantic order and the visual ordering `[second, first, third]`. Change only the visual podium construction so rank 1 is visibly tallest, rank 2 intermediate, and rank 3 shortest. The correct data reading must remain unchanged: all three display title, earnings, share, and link to the same article target.

Use separate front, top, and one side face for each plinth. The top face can keep perspective, but set an explicit perspective context on the podium scene and use a consistent transform origin. The side face should be a subtle shade of the same medal color, not a card shadow. Keep ranks 1–3 gold/silver/bronze, preserve the low-contrast runner list, and use concentric radii: the outer plinth cap must have a visibly larger radius than its inset medal.

Do not animate the podium on load. A short transform/color transition for hover is permitted only if it is directly tied to the article link, names exact transitioned properties, and is disabled by the existing reduced-motion convention.

**Verify**: `pnpm exec tsc --noEmit --incremental false` → exit 0.

### Step 3: Protect responsive readability

At 320px, 768px, 1024px, and 1440px, confirm that the three-place display keeps titles and earnings readable without overlap; the runner rows retain a usable title column; and long article titles truncate rather than grow the card horizontally. At three-or-fewer ranked articles, the component must not render empty runner-list chrome.

Use a local authenticated dashboard fixture or existing seeded account. If neither is available, add no fake data and stop after recording the unverified viewport states in the PR.

**Verify**: `pnpm build` → exit 0.

## Test plan

- Existing dashboard analytics tests must remain unchanged and pass: `pnpm test`.
- Manually inspect an overview with 0, 1, 2, 3, and 6 top articles. Confirm the calculation/order are unchanged, only presentation changes.
- Inspect loading, loaded, and reduced-motion states. There must be no horizontal scroll at 320px and no visual jump from an obsolete sidebar skeleton.

## Done criteria

- [ ] The loaded and loading overview use the same major geometry.
- [ ] Rank 1 is the tallest podium plinth; rank 2 and rank 3 are progressively shorter.
- [ ] The podium uses geometric faces for local depth, while shared dashboard cards remain flat and border-led.
- [ ] No button styling or button markup is modified.
- [ ] `pnpm exec tsc --noEmit --incremental false`, `pnpm test`, `pnpm build`, and `git diff --check` all succeed.
- [ ] No files outside the in-scope list are modified, except this plan’s status row.

## STOP conditions

- Stop if the in-scope code does not match the current-state excerpts; it is actively changing.
- Stop if making the podium legible requires modifying global cards, sidebar, or button styles.
- Stop if no authenticated/local fixture exists for responsive visual inspection; do not invent static production-looking analytics data.
- Stop if a visual change would alter rank calculation, article routing, payout behavior, or accessibility semantics.

## Maintenance notes

- Keep the podium data-driven. Future additions must express rank through the same style map rather than hardcoded article identities.
- If rank four or more becomes a primary use case, redesign the runner list separately; do not make the three-winner podium denser.
