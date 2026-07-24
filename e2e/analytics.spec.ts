import { expect, test } from "@playwright/test";

test.describe("creator analytics API boundary", () => {
  test("overview rejects an unauthenticated browser before analytics access", async ({ request }) => {
    const response = await request.get("/api/analytics/overview");
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Your session expired. Sign in again." },
    });
  });

  test("article analytics rejects an unauthenticated browser before ownership lookup", async ({ request }) => {
    const response = await request.get("/api/analytics/articles/article_other_creator");
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Your session expired. Sign in again." },
    });
  });
});
