/**
 * Source of truth for the import options Rubicon offers writers.
 *
 * Both the onboarding "where do you write" step and the article compose
 * screen's "Import an existing article" section render from these lists, so
 * adding or renaming a platform here updates every surface at once. This file
 * is intentionally UI-free (no icons or components) — surfaces map an option
 * `id` to their own iconography.
 */

export type ImportOptionId = "substack" | "artemis" | "url" | "markdown";

export interface ImportOption {
  id: ImportOptionId;
  /** Full action label, e.g. "Import from Substack". */
  label: string;
  /** Short platform name for tile-style pickers, e.g. "Substack". */
  platformLabel: string;
  /** Square logo under /public, or null when a generic icon should be used. */
  logoSrc: string | null;
  /** Dashboard route that starts this flow. The compose screen handles
   * `markdown` in place with a file picker instead of navigating. */
  href: string;
}

/** Platforms with a dedicated import flow, shown as first-class choices. */
export const PLATFORM_IMPORT_OPTIONS: ImportOption[] = [
  {
    id: "substack",
    label: "Import from Substack",
    platformLabel: "Substack",
    logoSrc: "/substacklogo.png",
    href: "/dashboard/import/substack",
  },
  {
    id: "artemis",
    label: "Import from Artemis",
    platformLabel: "Artemis",
    logoSrc: "/artemislogo.png",
    // Artemis posts are imported by pasting the article URL — the generic
    // URL importer detects and parses them (unlike Substack's ZIP flow).
    href: "/dashboard/articles/import",
  },
];

/** Everything else, grouped under one heading on every surface. */
export const OTHER_IMPORT_GROUP = {
  id: "other" as const,
  label: "Other",
  heading: "Import an existing article",
  options: [
    {
      id: "url",
      label: "Import URL",
      platformLabel: "URL",
      logoSrc: null,
      href: "/dashboard/articles/import",
    },
    {
      id: "markdown",
      label: "Import Markdown",
      platformLabel: "Markdown",
      logoSrc: null,
      href: "/dashboard/articles/new",
    },
  ] satisfies ImportOption[],
};

/** Tiles for the onboarding "Where do you mostly write?" step. */
export const ONBOARDING_PLATFORM_CHOICES = [
  ...PLATFORM_IMPORT_OPTIONS.map((option) => ({
    id: option.id,
    label: option.platformLabel,
    logoSrc: option.logoSrc,
  })),
  { id: OTHER_IMPORT_GROUP.id, label: OTHER_IMPORT_GROUP.label, logoSrc: null },
] as const;

export type OnboardingPlatformId = (typeof ONBOARDING_PLATFORM_CHOICES)[number]["id"];
