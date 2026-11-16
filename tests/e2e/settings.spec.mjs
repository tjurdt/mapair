import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, markerBackgroundByTitle, FIXTURE_MONTH } from "./helpers.mjs";

// The settings dialog's persistence paths (src/ui/settings.js): purpose and
// depth colours, which the E2E suite otherwise never saves.

test.beforeEach(() => reseed());

test("a purpose colour override persists and re-colours the markers", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click("#setBtn");
  await expect(page.locator('.ed-head[data-title="設定"]')).toBeVisible();
  await page.fill('.ns_catcolor[data-cat="飲食"]', "#654321");
  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.click("#setBtn");
  await page.selectOption("#ns_markermode", "cat");
  await page.waitForTimeout(40);
  expect(await markerBackgroundByTitle(page, "河畔咖啡")).toBe("#654321");
});

test("a depth colour override persists and re-colours the markers", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click("#setBtn");
  await page.fill('.ns_levelcolor[data-level="接地"]', "#123456");
  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.click("#setBtn");
  await page.selectOption("#ns_markermode", "level");
  await page.waitForTimeout(40);
  // 河畔咖啡 is alone in its district (derived depth 接地) — now painted with the override.
  expect(await markerBackgroundByTitle(page, "河畔咖啡")).toBe("#123456");
});
