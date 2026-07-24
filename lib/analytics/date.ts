/**
 * Parses an analytics day (`YYYY-MM-DD`) as a calendar date in the viewer's
 * timezone. Analytics daily buckets are already date-only values, so parsing
 * them as UTC instants would shift labels west of UTC.
 */
export function parseAnalyticsDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}
