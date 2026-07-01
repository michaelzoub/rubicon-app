/**
 * Substack onboarding flow, driven exactly the way a browser agent would:
 * headings + `data-onboarding-step` for orientation, `data-testid` hooks for
 * every control, `role="status"` / `role="alert"` text for feedback, and the
 * hidden file input instead of drag-and-drop.
 *
 * The one thing that cannot run headlessly is the Privy login, so the test
 * replays a recorded session. Record one once with:
 *
 *   npx playwright codegen http://localhost:3000/dashboard --save-storage=e2e/.auth/user.json
 *
 * (sign in through the Privy modal, then close codegen). Without that file the
 * test skips. Everything behind the UI — Supabase reads and the app's own
 * /api routes — is mocked, so the flow is deterministic and writes nothing.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const STORAGE_STATE = process.env.E2E_STORAGE_STATE ?? path.join(__dirname, ".auth/user.json");
const hasAuth = existsSync(STORAGE_STATE);

if (hasAuth) test.use({ storageState: STORAGE_STATE });

const CREATOR_ROW = {
  id: "creator_e2e",
  username: "wenkafka",
  display_name: "Wen Kafka",
  created_at: "2026-01-01T00:00:00.000Z",
};

/** Shape of `ARTICLE_COLUMNS` in lib/rubicon/client.ts. */
function liveArticleRow(id: string, title: string) {
  const now = new Date().toISOString();
  return {
    id,
    creator_id: CREATOR_ROW.id,
    title,
    author: "wenkafka",
    state: "live",
    price_per_word_atomic: "20000",
    max_article_price_atomic: null,
    total_words: 1700,
    revision: 1,
    seller_agent_config: null,
    body: "",
    is_imported: true,
    source_platform: "substack",
    source_url: "https://wenkafka.substack.com",
    source_author_name: null,
    source_author_handle: "wenkafka",
    source_published_at: now,
    imported_at: now,
    import_warnings: [],
    is_partial_import: false,
    created_at: now,
    updated_at: now,
  };
}

async function mockBackend(page: Page, articles: Array<ReturnType<typeof liveArticleRow>>) {
  // The dashboard reads Supabase REST directly; answer with canned rows so the
  // overview renders the onboarding dialog (no articles, no wallet) without
  // touching a real database.
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const table = new URL(request.url()).pathname.split("/").pop();
    const wantsObject = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (table === "creators") {
      return route.fulfill({ json: wantsObject ? CREATOR_ROW : [CREATOR_ROW] });
    }
    if (table === "articles" && request.method() === "GET") {
      return route.fulfill({ json: articles });
    }
    return route.fulfill({ json: wantsObject ? {} : [] });
  });

  await page.route("**/api/auth/supabase-token", (route) =>
    route.fulfill({ json: { token: "e2e-token", expiresAt: Math.floor(Date.now() / 1000) + 3600 } }),
  );

  // Onboarding flow APIs.
  await page.route("**/api/substack/onboarding", (route) =>
    route.fulfill({ json: { subdomain: null, pendingArchive: null } }),
  );
  await page.route("**/api/substack/search*", (route) => route.fulfill({ json: { suggestions: [] } }));
  await page.route("**/api/substack/lookup*", (route) => {
    const subdomain = new URL(route.request().url()).searchParams.get("subdomain");
    return route.fulfill({ json: { exists: subdomain === "wenkafka", subdomain, name: "Wen Kafka", logoUrl: null } });
  });
  await page.route("**/api/substack/connect", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/import/substack", (route) =>
    route.fulfill({
      json: {
        jobId: "job_e2e",
        candidates: [
          { id: "cand_1", title: "Post one", wordCount: 1200, importable: true, recommendedPricePerWordCents: 0.1 },
          { id: "cand_2", title: "Post two", wordCount: 2200, importable: true, recommendedPricePerWordCents: 0.1 },
        ],
      },
    }),
  );
  await page.route("**/api/import/substack/commit", (route) => {
    // Going live: the articles list the dashboard reads next now has live rows.
    articles.push(liveArticleRow("article_e2e_1", "Post one"), liveArticleRow("article_e2e_2", "Post two"));
    return route.fulfill({ json: { imported: 2, articleIds: ["article_e2e_1", "article_e2e_2"] } });
  });
}

test.describe("Substack onboarding (agent-readable UI)", () => {
  test.skip(
    !hasAuth,
    `Privy login can't run headlessly. Record a session to ${STORAGE_STATE} first (see file header).`,
  );

  test("completes connect → import → price using only testids and roles", async ({ page }) => {
    const articles: Array<ReturnType<typeof liveArticleRow>> = [];
    await mockBackend(page, articles);
    await page.goto("/dashboard");

    // Step 1 — connect. The welcome splash auto-advances into it.
    const container = page.locator("[data-onboarding-step]");
    await expect(container).toHaveAttribute("data-onboarding-step", "connect", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Connect your Substack" })).toBeVisible();
    await expect(page.getByText("Step 1 of 3")).toBeVisible();

    const publicationInput = page.getByTestId("publication-input");
    await expect(publicationInput).toHaveAttribute("aria-describedby", "substack-lookup-feedback");
    await publicationInput.fill("wenkafka");
    await expect(page.locator("#substack-lookup-feedback")).toContainText("Found wenkafka.substack.com");

    await expect(page.getByTestId("continue-button")).toBeEnabled();
    await page.getByTestId("continue-button").click();

    // Step 2 — import. Links are real hrefs; the upload goes through the
    // hidden file input, the same path drag-and-drop feeds.
    await expect(container).toHaveAttribute("data-onboarding-step", "import");
    await expect(page.getByRole("heading", { name: "Import your archive" })).toBeVisible();
    await expect(page.getByText("Step 2 of 3")).toBeVisible();
    await expect(page.getByTestId("export-settings-link")).toHaveAttribute(
      "href",
      "https://wenkafka.substack.com/publish/settings#import-export-settings",
    );
    await expect(page.getByTestId("email-export-link")).toHaveAttribute("href", /^mailto:/);

    await page.getByTestId("archive-file-input").setInputFiles({
      name: "substack-export.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK fake zip — the parse API is mocked"),
    });

    // Step 3 — price. The summary is status text; the price is typed, not dragged.
    await expect(container).toHaveAttribute("data-onboarding-step", "price");
    await expect(page.getByRole("heading", { name: "Set your price" })).toBeVisible();
    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    await expect(page.getByTestId("import-summary")).toHaveText(/2 posts · 3,400 words/);

    const priceInput = page.getByTestId("price-input");
    await priceInput.fill("0.002");
    await priceInput.blur();
    // The readout snaps to canonical formatting once editing ends, proving the
    // number input and the slider share state.
    await expect(priceInput).toHaveValue("0.0020");
    await expect(page.getByLabel("Price per word in USDC").first()).toBeVisible();

    await page.getByTestId("go-live-button").click();

    // Post-go-live landing: the live article link is a readable href. Reload
    // once — the dashboard caches queries for 30s, and a fresh observation is
    // exactly what an agent landing on the page does.
    await page.waitForURL("**/dashboard/articles");
    await page.reload();
    await expect(page.getByTestId("live-url").first()).toHaveAttribute("href", /\/dashboard\/articles\/article_e2e_1$/);
  });

  test("bad ZIP shows a persistent role=alert error", async ({ page }) => {
    const articles: Array<ReturnType<typeof liveArticleRow>> = [];
    await mockBackend(page, articles);
    await page.goto("/dashboard");

    await expect(page.locator("[data-onboarding-step]")).toHaveAttribute("data-onboarding-step", "connect", {
      timeout: 30_000,
    });
    await page.getByTestId("publication-input").fill("wenkafka");
    await expect(page.getByTestId("continue-button")).toBeEnabled();
    await page.getByTestId("continue-button").click();

    await page.getByTestId("archive-file-input").setInputFiles({
      name: "not-an-export.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("plain text"),
    });
    // Next.js's route announcer is also role=alert, so filter to the error.
    const alert = page.getByRole("alert").filter({ hasText: "Only .zip files work here" });
    await expect(alert).toBeVisible();
    // Persistent, not a toast: still there after the agent's next observation.
    await page.waitForTimeout(2000);
    await expect(alert).toBeVisible();
  });
});
