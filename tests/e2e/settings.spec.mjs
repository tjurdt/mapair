import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, markerBackgroundByTitle, FIXTURE_MONTH } from "./helpers.mjs";

// The settings sheet's persistence paths (src/ui/settings.js): "做什麼" picks
// and depth colours, which the E2E suite otherwise never saves.

test.beforeEach(() => reseed());

test("enabling a 做什麼 pick makes it an option in the Visit editor", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click("#setBtn");
  await expect(page.locator(".modal h2")).toHaveText("設定");
  await page.check('.ns_catpick[data-cat="住宿"]');
  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.locator("#list .card[data-pid]", { hasText: "河畔咖啡" }).first().locator("[data-ditto]").click();
  await expect(page.locator('#ns_category option[value="住宿"]')).toHaveCount(1);
});

test("a depth colour override persists and re-colours the markers", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click("#setBtn");
  await page.fill('.ns_levelcolor[data-level="旅遊"]', "#123456");
  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await page.click("#setBtn");
  await page.selectOption("#ns_markermode", "level");
  await page.waitForTimeout(40);
  // 河畔咖啡's latest Visit is depth 旅遊 — now painted with the override.
  expect(await markerBackgroundByTitle(page, "河畔咖啡")).toBe("#123456");
});
