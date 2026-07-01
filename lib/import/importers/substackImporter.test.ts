import { describe, expect, it } from "vitest";
import { importSubstack, parseSubstack } from "./substackImporter";
import type { FetchedDocument } from "../types";

const LONG_BODY = "Distributed systems force hard tradeoffs between consistency and availability. ".repeat(12);

const FULL_POST_HTML = `<!doctype html><html><head>
  <title>The Title — by Jane Doe</title>
  <meta property="og:title" content="On Distributed Systems" />
  <meta property="og:description" content="A practical look at consensus." />
  <meta property="og:image" content="https://cdn.substack.com/image/cover.png" />
  <meta property="article:published_time" content="2025-03-04T10:00:00.000Z" />
  <meta name="author" content="Jane Doe" />
  <link rel="canonical" href="https://jane.substack.com/p/on-distributed-systems" />
  <script type="application/ld+json">
    {"@type":"NewsArticle","headline":"On Distributed Systems","author":{"name":"Jane Doe"},"datePublished":"2025-03-04T10:00:00.000Z"}
  </script>
</head><body>
  <article>
    <div class="available-content">
      <div class="body markup">
        <h2>Consensus</h2>
        <p>${LONG_BODY} <strong>Bold claim</strong>, <em>careful caveat</em>, and <a href="https://example.com/source">a source</a>.</p>
        <blockquote><p>Agents should preserve quoted context.</p></blockquote>
        <figure><img src="https://cdn.substack.com/image/chart.png" alt="Consensus chart"><figcaption>Consensus over time</figcaption></figure>
        <ol><li>Observe</li><li>Verify</li></ol>
        <h2>Replication</h2>
        <p>Replication keeps copies in sync. ${LONG_BODY}</p>
        <div data-component-name="DigestPostEmbed">Related article</div>
        <p>Disclosure outside the article.</p>
      </div>
    </div>
    <div class="post-footer">footer junk we should not import</div>
  </article>
</body></html>`;

const PAYWALLED_HTML = `<!doctype html><html><head>
  <meta property="og:title" content="Members Only Deep Dive" />
  <meta property="og:description" content="The first few lines, then it's gated." />
  <link rel="canonical" href="https://jane.substack.com/p/members-only" />
  <script type="application/ld+json">{"@type":"Article","author":{"name":"Jane Doe"},"audience":"only_paid"}</script>
</head><body>
  <article>
    <div class="available-content">
      <div class="body markup"><p>Here is the short public preview before the wall.</p></div>
    </div>
    <div class="paywall">
      <p>This post is for paid subscribers</p>
    </div>
  </article>
</body></html>`;

describe("parseSubstack — full public post", () => {
  const result = parseSubstack(
    "https://jane.substack.com/p/on-distributed-systems",
    FULL_POST_HTML,
    "https://jane.substack.com/p/on-distributed-systems",
  );

  it("extracts metadata from og tags, canonical, and JSON-LD", () => {
    expect(result.sourcePlatform).toBe("substack");
    expect(result.title).toBe("On Distributed Systems");
    expect(result.subtitle).toBe("A practical look at consensus.");
    expect(result.authorName).toBe("Jane Doe");
    expect(result.authorHandle).toBe("jane");
    expect(result.canonicalUrl).toBe("https://jane.substack.com/p/on-distributed-systems");
    expect(result.publishedAt).toBe("2025-03-04T10:00:00.000Z");
    expect(result.media).toContainEqual({ type: "image", url: "https://cdn.substack.com/image/cover.png", alt: null });
  });

  it("converts the body to markdown, splits sections, and excludes the footer", () => {
    expect(result.isPartial).toBe(false);
    expect(result.body).toContain("## Consensus");
    expect(result.body).toContain("## Replication");
    expect(result.body).toContain("**Bold claim**");
    expect(result.body).toContain("*careful caveat*");
    expect(result.body).toContain("[a source](https://example.com/source)");
    expect(result.body).toContain("> Agents should preserve quoted context.");
    expect(result.body).toContain("![Consensus chart](https://cdn.substack.com/image/chart.png)");
    expect(result.body).toContain("1. Observe");
    expect(result.body).toContain("2. Verify");
    expect(result.body).not.toContain("footer junk");
    expect(result.body).not.toContain("Related article");
    expect(result.body).not.toContain("Disclosure outside");
    const headings = result.sections.map((s) => s.heading);
    expect(headings).toContain("Consensus");
    expect(headings).toContain("Replication");
  });
});

describe("parseSubstack — paywalled post", () => {
  const result = parseSubstack(
    "https://jane.substack.com/p/members-only",
    PAYWALLED_HTML,
    "https://jane.substack.com/p/members-only",
  );

  it("imports the public preview and flags the import as partial", () => {
    expect(result.isPartial).toBe(true);
    expect(result.previewText).toContain("short public preview");
    expect(result.warnings.join(" ")).toMatch(/paywall/i);
    // Metadata is still imported even when the body is gated.
    expect(result.title).toBe("Members Only Deep Dive");
    expect(result.authorName).toBe("Jane Doe");
  });
});

describe("importSubstack — with injected fetcher", () => {
  it("uses the provided fetchDocument (no network)", async () => {
    const doc: FetchedDocument = {
      requestedUrl: "https://jane.substack.com/p/on-distributed-systems",
      finalUrl: "https://jane.substack.com/p/on-distributed-systems",
      html: FULL_POST_HTML,
    };
    const result = await importSubstack("https://jane.substack.com/p/on-distributed-systems", {
      fetchDocument: async () => doc,
    });
    expect(result.title).toBe("On Distributed Systems");
    expect(result.isPartial).toBe(false);
  });
});
