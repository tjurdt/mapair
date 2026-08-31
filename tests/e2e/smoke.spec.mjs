import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// Read-only regression checks. Every spec re-seeds so ordering is irrelevant.
// Coverage tracks the "Automation: Yes" rows of
// docs/archive/baseline/BEHAVIOR_CHECKLIST.md.

test.beforeEach(() => reseed());

test("sign-in gate renders the shell, logout returns to the gate", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("header .title")).toHaveText("我的足跡");
  await expect(page.locator("#list")).toBeVisible();
  // src/styles/app.css is loaded (--paper ground on <body>).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(250, 247, 242)");

  await page.click("#logout");
  await expect(page.locator("#login-test-a")).toBeVisible();
});

test("tabs: visited lists occurrences, trips lists the trip, search hides on trips", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);
  await expect(page.locator("#searchWrap")).toBeVisible();

  await page.click('.tab[data-t="trips"]');
  await expect(page.locator("#list .triprow")).toContainText("三人夏日旅行");
  await expect(page.locator("#searchWrap")).toBeHidden();

  await page.click('.tab[data-t="visited"]');
  await expect(page.locator("#searchWrap")).toBeVisible();
});

test("date range drives the visited list", async ({ page }) => {
  await signIn(page);

  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);

  await setDateRange(page, "2020-01-01", "2020-12-31");
  await expect(page.locator("#list")).toContainText("沒有符合的造訪紀錄");
});

test("repeated visits to one place stay as separate occurrences", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  // 河畔咖啡 has four Visits by test-user-a across the fixture month.
  await expect(page.locator("#list .card[data-pid]", { hasText: "河畔咖啡" })).toHaveCount(4);
});

test("participant filter narrows to that person's visits", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);

  // test-user-c is only on the three-person Visit and the Trip stay.
  await page.selectOption("#fl_who", "test-user-c");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(2);
});

test("category filter narrows the visited list", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click('#fl_cats .chip:text-is("咖啡")');
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(2);
});

test("selecting a trip shows the day-numbered sequence", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");

  await expect(page.locator("#list .daysep").first()).toContainText("D1");
  await expect(page.locator("#list")).toContainText("D1-1");
});

test("a stay renders its nights and checkout", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await expect(page.locator("#list .card[data-pid]", { hasText: "海邊旅店" })).toContainText("住宿 2晚");
});

test("clicking a visit opens the editor with its stored data", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.locator("#list .card[data-pid]", { hasText: "山線車站" }).first().click();

  await expect(page.locator(".modal h2")).toHaveText("編輯造訪");
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-02");
  await expect(page.locator("#ns_level")).toHaveValue("接地");
});

test("settings modal opens and a display toggle does not break the shell", async ({ page }) => {
  await signIn(page);

  await page.click("#setBtn");
  await expect(page.locator(".modal h2")).toHaveText("設定");

  await page.uncheck("#ns_pins");
  await expect(page.locator("#ns_markermode")).toBeVisible();

  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list")).toBeVisible();
});
