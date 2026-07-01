/**
 * Local Markdown section parsing for the new-article preview flow.
 *
 * This produces an *estimated* section outline so creators can review, rename,
 * reorder, and exclude sections before publishing. The gateway re-parses the
 * submitted content and returns authoritative sections and word counts.
 */
import { estimateWordCount } from "./pricing";

export interface ParsedSection {
  title: string;
  body: string;
  wordCount: number;
}

export function parseSections(content: string): ParsedSection[] {
  const lines = content.split(/\r?\n/);
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } = { title: "Introduction", body: "" };
  let sawHeading = false;

  for (const line of lines) {
    const heading = line.match(/^(#{1,2})\s+(.+)$/);
    if (heading) {
      if (sawHeading || current.body.trim()) {
        sections.push({ ...current, body: current.body.trim() });
      }
      current = { title: heading[2].trim(), body: "" };
      sawHeading = true;
      continue;
    }
    current.body = current.body ? `${current.body}\n${line}` : line;
  }

  if (current.title || current.body.trim()) {
    sections.push({ ...current, body: current.body.trim() });
  }

  return sections
    .filter((section) => section.title || section.body)
    .map((section) => ({
      title: section.title,
      body: section.body,
      wordCount: estimateWordCount(section.body),
    }));
}
