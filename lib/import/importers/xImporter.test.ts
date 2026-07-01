import { describe, expect, it } from "vitest";
import { buildXApiResult, buildXResult, importX, parseXUrl } from "./xImporter";
import { ImportError } from "../types";

describe("parseXUrl", () => {
  it("extracts handle and status id, normalizing to x.com", () => {
    expect(parseXUrl("https://twitter.com/jack/status/20?s=46")).toEqual({
      handle: "jack",
      statusId: "20",
      canonicalUrl: "https://x.com/jack/status/20",
    });
    expect(parseXUrl("https://x.com/Naval/status/1234567890").canonicalUrl).toBe(
      "https://x.com/Naval/status/1234567890",
    );
  });

  it("rejects non-status URLs", () => {
    expect(() => parseXUrl("https://x.com/jack")).toThrow(ImportError);
  });
});

describe("buildXResult", () => {
  const parsed = parseXUrl("https://x.com/jack/status/20");

  it("enriches from public og metadata and strips the duplicated handle from the author name", () => {
    const html = `<html><head>
      <meta property="og:title" content="Jack Dorsey (@jack) on X" />
      <meta property="og:description" content="just setting up my twttr" />
      <meta property="og:image" content="https://pbs.twimg.com/x.jpg" />
    </head></html>`;
    const result = buildXResult("https://x.com/jack/status/20", parsed, html);
    expect(result.authorHandle).toBe("@jack");
    expect(result.authorName).toBe("Jack Dorsey");
    expect(result.title).toBe("Jack Dorsey on X");
    expect(result.body).toBe("just setting up my twttr");
    expect(result.isPartial).toBe(false);
    expect(result.media).toContainEqual({ type: "image", url: "https://pbs.twimg.com/x.jpg", alt: null });
  });

  it("falls back to metadata-only when the body can't be fetched", () => {
    const result = buildXResult("https://x.com/jack/status/20", parsed, null);
    expect(result.sourcePlatform).toBe("x");
    expect(result.authorHandle).toBe("@jack");
    expect(result.canonicalUrl).toBe("https://x.com/jack/status/20");
    expect(result.body).toBeNull();
    expect(result.isPartial).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/paste/i);
  });

  it("does not treat a media-only t.co link as imported post text", () => {
    const html = `<html><head>
      <meta property="og:description" content="https://t.co/OSdeRERg5t" />
    </head></html>`;
    const result = buildXResult("https://x.com/jack/status/20", parsed, html);
    expect(result.body).toBeNull();
    expect(result.previewText).toBeNull();
    expect(result.sections).toEqual([]);
    expect(result.isPartial).toBe(true);
  });

  it("keeps a short but readable post", () => {
    const html = `<html><head><meta property="og:description" content="hello" /></head></html>`;
    const result = buildXResult("https://x.com/jack/status/20", parsed, html);
    expect(result.body).toBe("hello");
    expect(result.isPartial).toBe(false);
  });
});

describe("importX — fetch failure falls back gracefully", () => {
  it("returns a metadata-only draft when fetchDocument throws", async () => {
    const result = await importX("https://x.com/jack/status/20", {
      fetchDocument: async () => {
        throw new ImportError("fetch_failed", "blocked");
      },
    });
    expect(result.isPartial).toBe(true);
    expect(result.authorHandle).toBe("@jack");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to structured data for a native X Article", async () => {
    const requests: string[] = [];
    const result = await importX("https://x.com/wenkafka/status/2066170830191530243", {
      fetchDocument: async (url) => {
        requests.push(url);
        if (url.includes("api.fxtwitter.com")) {
          return {
            requestedUrl: url,
            finalUrl: url,
            html: JSON.stringify({
              tweet: {
                text: "",
                author: { name: "kafka", screen_name: "wenkafka" },
                created_at: "Sun Jun 14 14:48:08 +0000 2026",
                article: {
                  title: "The war against frontier labs: decentralizing AI",
                  content: {
                    blocks: [
                      { type: "unstyled", text: "Opening paragraph." },
                      { type: "atomic", text: " " },
                      { type: "header-two", text: "The issue with the current market" },
                      { type: "blockquote", text: "First line\nSecond line" },
                    ],
                  },
                  cover_media: { media_info: { original_img_url: "https://pbs.twimg.com/cover.jpg" } },
                },
              },
            }),
          };
        }
        return {
          requestedUrl: url,
          finalUrl: url,
          html: '<meta property="og:description" content="https://t.co/article" />',
        };
      },
    });

    expect(requests).toHaveLength(2);
    expect(result.title).toBe("The war against frontier labs: decentralizing AI");
    expect(result.body).toBe(
      "Opening paragraph.\n\n## The issue with the current market\n\n> First line\n> Second line",
    );
    expect(result.publishedAt).toBe("2026-06-14T14:48:08.000Z");
    expect(result.isPartial).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.media).toContainEqual({
      type: "image",
      url: "https://pbs.twimg.com/cover.jpg",
      alt: null,
    });
  });
});

describe("buildXApiResult", () => {
  it("rejects malformed or empty structured responses", () => {
    const parsed = parseXUrl("https://x.com/jack/status/20");
    expect(buildXApiResult(parsed.canonicalUrl, parsed, "not json")).toBeNull();
    expect(buildXApiResult(parsed.canonicalUrl, parsed, '{"tweet":{"text":""}}')).toBeNull();
  });

  it("preserves X Article inline formatting, links, images, and captions", () => {
    const parsed = parseXUrl("https://x.com/wenkafka/status/2069445106382332284");
    const result = buildXApiResult(parsed.canonicalUrl, parsed, JSON.stringify({
      tweet: {
        author: { name: "kafka", screen_name: "wenkafka" },
        article: {
          title: "Turn Your Writing into Agent Revenue",
          content: {
            blocks: [
              {
                type: "unstyled",
                text: "Note: Rubicon links here and earns exactly.",
                inlineStyleRanges: [
                  { offset: 0, length: 5, style: "Bold" },
                  { offset: 29, length: 14, style: "Italic" },
                ],
                entityRanges: [{ offset: 14, length: 10, key: 0 }],
              },
              { type: "header-one", text: "Getting familiar with the dashboard" },
              { type: "atomic", text: " ", entityRanges: [{ offset: 0, length: 1, key: 1 }] },
            ],
            entityMap: [
              { key: "0", value: { type: "LINK", data: { url: "https://www.rubiconpay.xyz/" } } },
              { key: "1", value: { type: "MEDIA", data: { caption: "The dashboard", mediaItems: [{ mediaId: "image-1" }] } } },
            ],
          },
          media_entities: [
            { media_id: "image-1", media_info: { original_img_url: "https://pbs.twimg.com/dashboard.png" } },
          ],
        },
      },
    }));

    expect(result?.body).toContain("**Note:**");
    expect(result?.body).toContain("[links here](https://www.rubiconpay.xyz/)");
    expect(result?.body).toContain("*earns exactly.*");
    expect(result?.body).toContain("# Getting familiar with the dashboard");
    expect(result?.body).toContain("![](https://pbs.twimg.com/dashboard.png)");
    expect(result?.body).toContain("*The dashboard*");
  });
});
