import { afterEach, describe, expect, it, vi } from "vitest";
import { getXQueryId, resetXQueryIdCache } from "./x-query-id";

describe("X GraphQL query-ID discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetXQueryIdCache();
  });

  it("extracts the operation ID from X's referenced bundles", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://x.com/")) {
        return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.abc.js"></script>');
      }
      return new Response('x="freshQueryId_123456789/UserArticlesTweets"');
    }));

    await expect(getXQueryId("UserArticlesTweets", "fallback")).resolves.toBe("freshQueryId_123456789");
  });

  it("uses the fallback when discovery is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(getXQueryId("UserArticlesTweets", "fallback")).resolves.toBe("fallback");
  });
});
