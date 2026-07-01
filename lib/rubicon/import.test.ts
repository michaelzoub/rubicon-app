import { describe, expect, it } from "vitest";
import { composeArticleBody, sanitizeText, validateImportPayload } from "./import";

const base = {
  sourcePlatform: "substack",
  sourceUrl: "https://writer.substack.com/p/test",
  title: "A post",
  subtitle: null,
  authorName: "Writer",
  authorHandle: null,
  publishedAt: null,
  body: "Useful body",
  sections: [],
  media: [],
  rawExtractedText: "Useful body",
  warnings: [],
};

describe("extension import payload", () => {
  it("validates and sanitizes page-derived content", () => {
    const result = validateImportPayload({ ...base, title: "<b>Safe</b>", body: "Hello<script>alert(1)</script> world" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ title: "Safe", body: "Hello world", isPartial: false });
  });

  it("rejects unsupported platforms and empty content", () => {
    expect(validateImportPayload({ ...base, sourcePlatform: "medium" })).toMatchObject({ ok: false, code: "invalid_platform" });
    expect(validateImportPayload({ ...base, body: null, rawExtractedText: null })).toMatchObject({ ok: false, code: "empty_content" });
  });

  it("removes active markup and composes section markdown", () => {
    expect(sanitizeText('<img src=x onerror="bad">Text', 100)).toBe("Text");
    const result = validateImportPayload({ ...base, body: null, rawExtractedText: null, sections: [{ heading: "One", text: "Words" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(composeArticleBody(result.value)).toBe("## One\n\nWords");
  });

  it("preserves Markdown and appends only images missing from the body", () => {
    const result = validateImportPayload({
      ...base,
      body: "A **bold** and *italic* [link](https://example.com).\n\n![Inline](https://img.example/inline.png)",
      media: [
        { type: "image", url: "https://img.example/inline.png", alt: "Inline" },
        { type: "image", url: "https://img.example/missing.png", alt: "Missing [chart]" },
        { type: "video", url: "https://video.example/watch", alt: "Video" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(composeArticleBody(result.value)).toBe(
        "A **bold** and *italic* [link](https://example.com).\n\n![Inline](https://img.example/inline.png)\n\n![Missing \\[chart\\]](https://img.example/missing.png)",
      );
    }
  });
});
