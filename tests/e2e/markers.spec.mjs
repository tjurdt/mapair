import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, expectNoPageErrors, FIXTURE_MONTH } from "./helpers.mjs";

// Exercises the map/marker code path — renderMarkers, effectiveMarkerColor,
// the per-mode colour resolvers, and sequence markers — which the other specs
// skip because Google Maps is stubbed only here via signIn(). This is the hot
// spot (#4 in docs/VIBE_CODING_RULES.md) that ships regressions unnoticed.

test.beforeEach(() => reseed());

test("markers render for the visible places with no page errors", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  const markerCount = await page.evaluate(() => window.__mapairTestMarkers.length);
  expect(markerCount).toBeGreaterThan(0);
  expectNoPageErrors(page);
});

test("every marker colour mode re-renders without error", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await page.click("#setBtn");
  await expect(page.locator(".modal h2")).toHaveText("設定");

  for (const mode of ["cat", "level", "who", "trip", "rating", "dateFirst", "dateLast", "cat"]) {
    await page.selectOption("#ns_markermode", mode);
    await page.waitForTimeout(40);
    const errors = (page.__mapairPageErrors || []).map((e) => e.message);
    expect(errors, `marker mode "${mode}" threw`).toEqual([]);
  }
});

test("trip sequence numbered markers render without error", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");

  await page.click("#orderPinToggle");
  await expect(page.locator("#orderPinToggle")).toContainText("●");
  await page.waitForTimeout(40);

  const markerCount = await page.evaluate(() => window.__mapairTestMarkers.length);
  expect(markerCount).toBeGreaterThan(0);
  expectNoPageErrors(page);
});

test("single-day sequence numbered markers render without error", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, "2026-08-02", "2026-08-02");

  await page.click("#orderPinToggle");
  await page.waitForTimeout(40);

  expectNoPageErrors(page);
});
