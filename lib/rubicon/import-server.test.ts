import { describe, expect, it, vi } from "vitest";
import { createImportDraft, ImportServerError } from "./import-server";
import type { ExtensionImportPayload } from "./import";

const payload: ExtensionImportPayload = {
  sourcePlatform: "substack",
  sourceUrl: "https://writer.substack.com/p/test",
  title: "Imported title",
  subtitle: null,
  authorName: "Writer",
  authorHandle: null,
  publishedAt: null,
  body: "## One\n\nA **bold**, *italic* [source](https://example.com).",
  sections: [],
  media: [{ type: "image", url: "https://images.example/chart.png", alt: "Payment chart" }],
  rawExtractedText: null,
  warnings: [],
  isPartial: false,
};

/**
 * Minimal Supabase query-builder stub keyed by table. `creatorRow` controls
 * whether the creator existence check finds a row; every insert succeeds.
 * `inserts` records what was written so a test can assert the article shape.
 */
function fakeSupabase(opts: { creatorRow: { id: string } | null }) {
  const calls = { creatorsSelect: 0, creatorsUpsert: 0 };
  const inserts: Record<string, unknown[]> = {};

  const from = vi.fn((table: string) => {
    if (table === "creators") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.creatorsSelect += 1;
              return { data: opts.creatorRow, error: null };
            },
          }),
        }),
        // If the code ever reintroduces an upsert here it would 23502 in prod —
        // fail loudly in the test instead.
        upsert: () => {
          calls.creatorsUpsert += 1;
          return { error: null };
        },
      };
    }
    return {
      insert: async (rows: unknown) => {
        inserts[table] = (inserts[table] ?? []).concat(rows);
        return { error: null };
      },
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, calls, inserts };
}

describe("createImportDraft", () => {
  it("verifies the creator without upserting, then writes a draft article", async () => {
    const { client, calls, inserts } = fakeSupabase({ creatorRow: { id: "creator_1" } });

    const draft = await createImportDraft(client, "creator_1", payload, "https://www.rubiconpay.xyz/");

    expect(calls.creatorsSelect).toBe(1);
    // Regression guard: a bare-id upsert raises a NOT NULL (username) violation
    // in Postgres even when the row exists, which broke every import.
    expect(calls.creatorsUpsert).toBe(0);

    expect(draft.draftId).toMatch(/^article_/);
    expect(draft.reviewUrl).toBe(`https://www.rubiconpay.xyz/dashboard/imports/${draft.draftId}`);

    const article = inserts.articles?.[0] as Record<string, unknown>;
    expect(article).toMatchObject({
      creator_id: "creator_1",
      title: "Imported title",
      state: "draft",
      is_imported: true,
      source_platform: "substack",
      body: "## One\n\nA **bold**, *italic* [source](https://example.com).\n\n![Payment chart](https://images.example/chart.png)",
    });

    const revision = inserts.article_revisions?.[0] as Record<string, unknown>;
    expect(revision.body).toBe(article.body);
  });

  it("returns creator_not_found when the creator row is missing", async () => {
    const { client, calls } = fakeSupabase({ creatorRow: null });

    await expect(createImportDraft(client, "creator_1", payload, "https://x.test")).rejects.toMatchObject({
      constructor: ImportServerError,
      status: 404,
      code: "creator_not_found",
    });
    expect(calls.creatorsUpsert).toBe(0);
  });
});
