export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  groupedLabels?: string[];
}

/** Monochrome ink ramp, deep → pale: rank reads by lightness, the legend carries identity. */
export const DONUT_COLORS = ["#18181b", "#47474d", "#75757c", "#a3a3ab", "#d2d2d7"];

export function buildEarningsDonutSlices(
  articles: Array<{ label: string; value: number }>,
  maxSlices = 5,
): DonutSlice[] {
  const earners = articles
    .filter((article) => Number.isFinite(article.value) && article.value > 0)
    .sort((a, b) => b.value - a.value);
  if (earners.length === 0) return [];

  const resolvedMax = Math.max(2, Math.floor(maxSlices));
  const colorFor = (index: number) => DONUT_COLORS[index % DONUT_COLORS.length];
  const toSlice = (article: { label: string; value: number }, index: number): DonutSlice => ({
    ...article,
    color: colorFor(index),
  });

  if (earners.length <= resolvedMax) return earners.map(toSlice);

  const visible = earners.slice(0, resolvedMax - 1);
  const grouped = earners.slice(resolvedMax - 1);
  if (grouped.length === 1) return earners.map(toSlice);

  return [
    ...visible.map(toSlice),
    {
      label: `${grouped.length} more articles`,
      value: grouped.reduce((sum, article) => sum + article.value, 0),
      color: colorFor(visible.length),
      groupedLabels: grouped.map((article) => article.label),
    },
  ];
}
