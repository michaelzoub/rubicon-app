import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createDraft: vi.fn(),
  importFromUrl: vi.fn(),
  serviceClient: vi.fn(),
}));

vi.mock("@/lib/rubicon/import", async () => import("../../../../lib/rubicon/import"));
vi.mock("@/lib/rubicon/extension-tokens", async () => import("../../../../lib/rubicon/extension-tokens"));
vi.mock("../../../../lib/import", () => ({ importFromUrl: mocks.importFromUrl }));

vi.mock("@/lib/rubicon/import-server", async () => {
  const actual = await import("../../../../lib/rubicon/import-server");
  return {
    ...actual,
    authenticateExtensionToken: mocks.authenticate,
    createImportDraft: mocks.createDraft,
    serviceClient: mocks.serviceClient,
  };
});

import { POST } from "./route";

const payload = {
  sourcePlatform: "substack",
  sourceUrl: "https://writer.substack.com/p/test",
  title: "<b>Imported title</b>",
  subtitle: null,
  authorName: "Writer",
  authorHandle: null,
  publishedAt: null,
  body: "Readable body<script>alert(1)</script>",
  sections: [],
  media: [],
  rawExtractedText: "Readable body",
  warnings: [],
};

describe("POST /api/import/extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serviceClient.mockReturnValue({ kind: "supabase" });
    mocks.authenticate.mockResolvedValue("creator_1");
    mocks.createDraft.mockResolvedValue({ draftId: "article_1", reviewUrl: "https://www.rubiconpay.xyz/dashboard/imports/article_1" });
    mocks.importFromUrl.mockRejectedValue(new Error("not expected"));
  });

  it("authenticates, sanitizes, and creates a reviewable draft", async () => {
    const response = await POST(new Request("https://www.rubiconpay.xyz/api/import/extension", {
      method: "POST",
      headers: { authorization: "Bearer rbx_test-token", "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ draftId: "article_1", reviewUrl: "https://www.rubiconpay.xyz/dashboard/imports/article_1" });
    expect(mocks.authenticate).toHaveBeenCalledWith({ kind: "supabase" }, "rbx_test-token");
    expect(mocks.createDraft).toHaveBeenCalledWith(
      { kind: "supabase" },
      "creator_1",
      expect.objectContaining({ title: "Imported title", body: "Readable body" }),
      "https://www.rubiconpay.xyz",
    );
  });

  it("requires an extension token", async () => {
    const response = await POST(new Request("https://www.rubiconpay.xyz/api/import/extension", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    expect(response.status).toBe(401);
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("enriches a native X Article before validating the extension payload", async () => {
    mocks.importFromUrl.mockResolvedValue({
      sourcePlatform: "x",
      sourceUrl: "https://x.com/wenkafka/status/2069445106382332284",
      canonicalUrl: "https://x.com/wenkafka/status/2069445106382332284",
      title: "Turn Your Writing into Agent Revenue",
      subtitle: null,
      authorName: "kafka",
      authorHandle: "@wenkafka",
      publishedAt: "2026-06-23T15:38:56.000Z",
      previewText: "Opening paragraph.",
      body: "Opening paragraph.\n\n# Getting familiar with the dashboard",
      sections: [{ heading: null, text: "Opening paragraph." }, { heading: "Getting familiar with the dashboard", text: "" }],
      media: [{ type: "image", url: "https://pbs.twimg.com/dashboard.png", alt: null }],
      isPartial: false,
      warnings: [],
    });

    const response = await POST(new Request("https://www.rubiconpay.xyz/api/import/extension", {
      method: "POST",
      headers: { authorization: "Bearer rbx_test-token", "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        sourcePlatform: "x",
        sourceUrl: "https://x.com/wenkafka/status/2069445106382332284?s=20",
        title: null,
        body: "https://t.co/tVckLMX9wO",
        rawExtractedText: "https://t.co/tVckLMX9wO",
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.importFromUrl).toHaveBeenCalledWith("https://x.com/wenkafka/status/2069445106382332284?s=20");
    expect(mocks.createDraft).toHaveBeenCalledWith(
      { kind: "supabase" },
      "creator_1",
      expect.objectContaining({
        title: "Turn Your Writing into Agent Revenue",
        body: "Opening paragraph.\n\n# Getting familiar with the dashboard",
        isPartial: false,
      }),
      "https://www.rubiconpay.xyz",
    );
  });
});
