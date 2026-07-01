import { describe, expect, it } from "vitest";
import { parseSubstackExport, recommendPricePerWordCents, safeExportPath } from "./substack-export";

describe("Substack export parser", () => {
  it("imports only published rows, sanitizes HTML, and reports missing files", () => {
    const csv = [
      "post_id,post_date,is_published,audience,title,subtitle,type",
      "101,2026-01-02,true,everyone,Published post,The subtitle,newsletter",
      "102,2026-01-03,FALSE,everyone,Draft post,,newsletter",
      "103,2026-01-04,TRUE,paid,Missing body,,newsletter",
    ].join("\n");
    const html = `<html><body><article><h1>Published post</h1><script>steal()</script><style>bad{}</style><h2>Evidence</h2><p>There are 42 findings in this paragraph.</p><iframe src="bad"></iframe><p><a href="https://example.com">Source</a></p></article></body></html>`;
    const result = parseSubstackExport([
      { path: "export/posts.csv", content: Buffer.from(csv) },
      { path: "export/posts/101.published-post.html", content: Buffer.from(html) },
      { path: "export/posts/102.draft-post.html", content: Buffer.from("<p>private draft</p>") },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Published post");
    expect(result[0].plainText).not.toContain("steal");
    expect(result[0].sanitizedHtml).not.toMatch(/script|iframe|style/i);
    expect(result[0].sections.map((section) => section.heading)).toContain("Evidence");
    expect(result[1]).toMatchObject({ title: "Missing body", warning: "Missing HTML file", importable: false });
  });

  it("rejects traversal and clamps recommended pricing", () => {
    expect(() => safeExportPath("../posts.csv")).toThrow(/unsafe/);
    expect(recommendPricePerWordCents({ wordCount: 100, sections: [{ heading: "x", text: "", html: "", wordCount: 0, index: 0 }], linkCount: 20, hasCode: true, hasTables: true, hasNumbers: true, hasCitations: true, audience: "paid" })).toBeLessThanOrEqual(0.08);
  });

  it("matches slug-named HTML files used by newer Substack exports", () => {
    const csv = [
      "post_id,post_date,is_published,audience,title,subtitle,type,slug",
      "201,2026-02-01,true,everyone,An article whose file exists,,newsletter,the-real-slug",
    ].join("\n");
    const result = parseSubstackExport([
      { path: "export/posts.csv", content: Buffer.from(csv) },
      { path: "export/posts/the-real-slug.html", content: Buffer.from("<article><p>The body is here.</p></article>") },
    ]);

    expect(result[0]).toMatchObject({ importable: true, warning: null, plainText: "The body is here." });
  });

  it("does not guess when two published rows share the same title", () => {
    const csv = [
      "post_id,is_published,title",
      "301,true,Repeated title",
      "302,true,Repeated title",
    ].join("\n");
    const result = parseSubstackExport([
      { path: "posts.csv", content: Buffer.from(csv) },
      { path: "posts/repeated-title.html", content: Buffer.from("<p>Ambiguous body</p>") },
    ]);

    expect(result.every((candidate) => !candidate.importable)).toBe(true);
  });
});
