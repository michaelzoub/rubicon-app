import { expect, test } from "@playwright/test";

test.describe("dashboard UI reliability", () => {
  test("payout replaces itself with withdraw and keeps a single backdrop", async ({ page }) => {
    await page.goto("/dashboard-preview");

    const agentReadsMetric = page.locator('[data-dashboard-metric="Agent reads"]');
    await expect(agentReadsMetric).toContainText("146");
    await expect(agentReadsMetric).toContainText("+11%");

    const payoutTrigger = page.getByRole("button", { name: "Payout connection" });
    await payoutTrigger.click();
    await expect(page.getByRole("dialog", { name: "Payout connection" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Payout connection" }).getByText("41.27")).toBeVisible();

    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByRole("dialog", { name: "Withdraw USDC" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Payout connection" })).toHaveCount(0);
    await expect(page.locator("[data-dashboard-overlay-root] > button")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Withdraw USDC" })).toHaveCount(0);
    await expect(payoutTrigger).toBeFocused();
  });

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`overview stays usable at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard-preview");

      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Earnings activity" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Top articles" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`export dialog fits its content at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/dashboard-preview");

      await page.getByRole("button", { name: "Export card" }).click();
      const dialog = page.getByRole("dialog", { name: "Export card" });
      await expect(dialog).toBeVisible();

      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(dialog.getByRole("button", { name: "Copy PNG" })).toBeVisible();
    });
  }

  test("overview chart hovers and rankings stay contained", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard-preview");

    const activityCard = page
      .getByRole("heading", { name: "Earnings activity" })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' dashboard-card ')][1]");
    const activityChart = activityCard.locator("[data-chart-frame]");
    await expect(activityChart).toBeVisible();
    const activityChartBox = await activityChart.boundingBox();
    expect(activityChartBox?.height ?? 0).toBeGreaterThan(230);

    const earningsMetric = page.locator('[data-dashboard-metric="Total earnings"]');
    await earningsMetric.locator(".recharts-wrapper").hover();
    const sparklineTooltip = earningsMetric.locator(".recharts-tooltip-wrapper");
    await expect(sparklineTooltip).toBeVisible();
    const tooltipBox = await sparklineTooltip.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(tooltipBox!.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(1440);
    expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(900);
    const metricZIndex = await earningsMetric.evaluate((element) => Number(getComputedStyle(element).zIndex));
    const layerZIndex = await page.locator(".dashboard-tooltip-layer").evaluate((element) => Number(getComputedStyle(element).zIndex));
    expect(metricZIndex).toBeGreaterThanOrEqual(40);
    expect(layerZIndex).toBeGreaterThanOrEqual(40);

    const donut = page.locator("[data-donut]");
    const donutBefore = await donut.boundingBox();
    const legendBefore = await donut.locator("ul").boundingBox();
    const firstSegment = donut.locator("[data-donut-segment]").first();
    const firstLegendRow = donut.locator("[data-donut-legend-row]").first();
    await firstLegendRow.hover();
    await expect(firstSegment).toHaveAttribute("data-active", "true");
    await expect(firstLegendRow).toHaveAttribute("data-active", "true");

    const segmentFits = await firstSegment.evaluate((segment) => {
      const circle = segment as SVGCircleElement;
      const svg = circle.ownerSVGElement;
      const radius = Number(circle.getAttribute("r"));
      const strokeWidth = Number(circle.getAttribute("stroke-width"));
      if (!svg) return false;
      return radius + strokeWidth / 2 <= svg.viewBox.baseVal.width / 2 - 1;
    });
    expect(segmentFits).toBe(true);

    const donutAfter = await donut.boundingBox();
    const legendAfter = await donut.locator("ul").boundingBox();
    expect(donutAfter).toEqual(donutBefore);
    expect(legendAfter).toEqual(legendBefore);
    const groupedRow = donut.locator("[data-donut-legend-row]", { hasText: "2 more articles" });
    await expect(groupedRow).toBeVisible();
    await expect(donut.getByText("1 more", { exact: true })).toHaveCount(0);
    await expect(groupedRow).toHaveAttribute("title", /The New Bundle Economics.*Writing for Machine Audiences/);

    const lowerRanks = page.locator("[data-rank]");
    await expect(lowerRanks).toHaveText(["04", "05", "06"]);
    const rankBorders = await lowerRanks.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).borderWidth));
    expect(rankBorders).toEqual(["0px", "0px", "0px"]);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("single top article stays aligned with earnings activity", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard-preview?singleArticle=1");

    const activity = page.getByRole("heading", { name: "Earnings activity" }).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' dashboard-card ')][1]");
    const topArticles = page.getByRole("heading", { name: "Top articles" }).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' dashboard-card ')][1]");
    await expect(activity).toBeVisible();
    await expect(topArticles).toBeVisible();
    await expect(topArticles.getByRole("list", { name: "Top three articles" }).locator("li")).toHaveCount(1);

    const activityBox = await activity.boundingBox();
    const topArticlesBox = await topArticles.boundingBox();
    expect(activityBox).not.toBeNull();
    expect(topArticlesBox).not.toBeNull();
    expect(activityBox!.width).toBeGreaterThan(700);
    expect(topArticlesBox!.width).toBeGreaterThan(280);
    expect(Math.abs(topArticlesBox!.y - activityBox!.y)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: "test-results/overview-single-top-article.png", fullPage: true });
  });
});
