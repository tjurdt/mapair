import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// One search box: your own matching Places come first (★), then Google results
// (stubbed empty here). Picking one records a new Visit there.

test.beforeEach(() => reseed());

test("typing lists your own matching Places and picking one opens a new Visit", async ({ page }) => {
  await signIn(page);
  // Wait until the Places have loaded (the list shows the fixture month).
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await page.locator("#list .card[data-pid]").first().waitFor();

  await page.fill("#search", "咖啡");
  const own = page.locator("#results [data-own]");
  await expect(own).toHaveCount(1);
  await expect(own.first()).toContainText("河畔咖啡");

  await own.first().click();
  await expect(page.locator('.ed-head[data-title="新增造訪"]')).toBeVisible();
  await expect(page.locator("#ns_place_name")).toHaveValue("河畔咖啡");
  await expect(page.locator("#ns_place_name")).toHaveAttribute("data-place-id", "place-test-no-space-cafe");
  await expect(page.locator("#search")).toHaveValue("");
});

test("no match shows 找不到 and clearing hides the results", async ({ page }) => {
  await signIn(page);
  await page.fill("#search", "zzzz");
  await expect(page.locator("#results")).toContainText("找不到");
  await page.fill("#search", "");
  await expect(page.locator("#results")).toBeHidden();
});
