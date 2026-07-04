import { describe, expect, it } from "vitest";
import { importArtemis, parseArtemis } from "./artemisImporter";
import { ImportError } from "../types";
import type { FetchedDocument } from "../types";

// Mirrors the real payload shape served by data-svc.artemisxyz.com/articles/
// <shortId> (verified against dimefps/article/308072004776712725): Plate-style
// blocks with flat list paragraphs, inline link elements, and bold/italic
// marks that include trailing whitespace.
const ARTICLE_JSON = JSON.stringify({
  id: "06832ba7-8fc0-4df5-b1bc-e7fee8621ec8",
  short_id: "308072004776712725",
  title: "Phantom Adoption: Why Crypto's Biggest Numbers Are Lying",
  subtitle: "A framework for separating real onchain usage from manufactured growth",
  cover_image_url: "https://res.cloudinary.com/demo/cover.jpg",
  body: {
    blocks: [
      { id: "a1", type: "h2", children: [{ text: "Overview: " }] },
      {
        id: "a2",
        type: "p",
        children: [
          { text: "Crypto's biggest adoption metrics are all telling the same lie, per " },
          {
            id: "a2l",
            type: "a",
            url: "https://example.com/report",
            children: [{ text: "2025 headlines" }],
          },
          { text: "." },
        ],
      },
      {
        id: "nested-image-paragraph",
        type: "p",
        children: [
          {
            id: "nested-image",
            type: "img",
            url: "https://res.cloudinary.com/demo/nested.png",
            children: [{ text: "" }],
          },
        ],
      },
      {
        id: "a3",
        type: "p",
        children: [{ bold: true, text: "Volume Quality Score: Adjusted / Reported " }],
      },
      { id: "a4", type: "h2", children: [{ text: "Stablecoins: The Volume Illusion" }] },
      {
        id: "l1",
        type: "p",
        indent: 1,
        listStyleType: "decimal",
        children: [{ text: "Genuine payments" }],
      },
      {
        id: "l2",
        type: "p",
        indent: 1,
        listStart: 2,
        listStyleType: "decimal",
        children: [{ text: "Economically real but non-payment activity" }],
      },
      {
        id: "l3",
        type: "p",
        indent: 1,
        listStart: 3,
        listStyleType: "decimal",
        children: [{ text: "Pure automation (MEV, arbitrage loops)" }],
      },
      {
        id: "img1",
        type: "img",
        url: "https://res.cloudinary.com/demo/chart.png",
        caption: "Visa Onchain Analytics Dashboard",
        children: [{ text: "" }],
      },
      {
        id: "c1",
        type: "chart",
        title: "Arbitrum Daily Active Users",
        height: 286,
        series: [{ asset: "ARB", metric: "ADJUSTED_DAU" }],
        children: [{ text: "" }],
      },
      { id: "h3a", type: "h3", children: [{ text: "References:" }] },
      { id: "ref1", type: "p", children: [{ text: "State of Helium Q4 2025", italic: true }] },
    ],
  },
  status: "published",
  published_at: "2026-05-01T23:20:05.549340+00:00",
  author_handle: "dimefps",
  author_display_name: "Marko Stojanovic",
});

const SOURCE_URL = "https://www.artemis.ai/dimefps/article/308072004776712725";

describe("parseArtemis — full article", () => {
  const result = parseArtemis(SOURCE_URL, ARTICLE_JSON, "dimefps", "308072004776712725");

  it("extracts metadata from the data-service payload", () => {
    expect(result.sourcePlatform).toBe("artemis");
    expect(result.title).toBe("Phantom Adoption: Why Crypto's Biggest Numbers Are Lying");
    expect(result.subtitle).toBe("A framework for separating real onchain usage from manufactured growth");
    expect(result.authorName).toBe("Marko Stojanovic");
    expect(result.authorHandle).toBe("dimefps");
    expect(result.canonicalUrl).toBe(SOURCE_URL);
    expect(result.publishedAt).toBe("2026-05-01T23:20:05.549Z");
    expect(result.media).toContainEqual({ type: "image", url: "https://res.cloudinary.com/demo/cover.jpg", alt: null });
  });

  it("converts blocks to markdown agents can read", () => {
    expect(result.isPartial).toBe(false);
    expect(result.body).toContain("## Overview:");
    expect(result.body).toContain("## Stablecoins: The Volume Illusion");
    expect(result.body).toContain("### References:");
    expect(result.body).toContain("[2025 headlines](https://example.com/report)");
    // Marks with trailing whitespace stay valid markdown.
    expect(result.body).toContain("**Volume Quality Score: Adjusted / Reported**");
    expect(result.body).toContain("*State of Helium Q4 2025*");
    expect(result.body).toContain("1. Genuine payments");
    expect(result.body).toContain("2. Economically real but non-payment activity");
    expect(result.body).toContain("3. Pure automation (MEV, arbitrage loops)");
    expect(result.body).toContain("![Visa Onchain Analytics Dashboard](https://res.cloudinary.com/demo/chart.png)");
    expect(result.body).toContain("![](https://res.cloudinary.com/demo/nested.png)");
    expect(result.body).toContain("*[Chart: Arbitrum Daily Active Users]*");
  });

  it("splits heading-delimited sections and keeps image + chart media", () => {
    expect(result.sections.map((s) => s.heading)).toEqual([
      "Overview:",
      "Stablecoins: The Volume Illusion",
    ]);
    expect(result.media).toContainEqual({
      type: "image",
      url: "https://res.cloudinary.com/demo/chart.png",
      alt: "Visa Onchain Analytics Dashboard",
    });
    expect(result.media).toContainEqual({
      type: "image",
      url: "https://res.cloudinary.com/demo/nested.png",
      alt: null,
    });
    expect(result.media).toContainEqual({ type: "chart", url: null, alt: "Arbitrum Daily Active Users" });
  });

  it("warns that charts were flattened to text notes", () => {
    expect(result.warnings.some((w) => /chart/i.test(w))).toBe(true);
  });
});

describe("parseArtemis — edge cases", () => {
  it("flags an empty body as partial", () => {
    const result = parseArtemis(
      SOURCE_URL,
      JSON.stringify({ title: "T", body: { blocks: [] } }),
      "dimefps",
      "308072004776712725",
    );
    expect(result.isPartial).toBe(true);
    expect(result.body).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("throws parse_failed on non-JSON and empty payloads", () => {
    expect(() => parseArtemis(SOURCE_URL, "<!doctype html>", "dimefps", "1")).toThrow(ImportError);
    expect(() => parseArtemis(SOURCE_URL, "{}", "dimefps", "1")).toThrow(ImportError);
  });
});

describe("importArtemis", () => {
  it("fetches the data-service JSON for the article's shortId", async () => {
    let fetched: string | null = null;
    const result = await importArtemis(SOURCE_URL, {
      fetchDocument: async (url: string): Promise<FetchedDocument> => {
        fetched = url;
        return { requestedUrl: url, finalUrl: url, html: ARTICLE_JSON };
      },
    });
    expect(fetched).toBe("https://data-svc.artemisxyz.com/articles/308072004776712725");
    expect(result.title).toContain("Phantom Adoption");
  });

  it("rejects URLs without an article id", async () => {
    await expect(
      importArtemis("https://www.artemis.ai/dimefps", {
        fetchDocument: async () => {
          throw new Error("should not fetch");
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });
});
