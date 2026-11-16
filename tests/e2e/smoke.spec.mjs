import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// Read-only regression checks. Every spec re-seeds so ordering is irrelevant.
// Coverage tracks the "Automation: Yes" rows of
// docs/archive/baseline/BEHAVIOR_CHECKLIST.md.

test.beforeEach(() => reseed());

test("sign-in gate renders the shell, logout returns to the gate", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#mapfab")).toBeVisible();
  await expect(page.locator("#list")).toBeVisible();
  // src/styles/app.css is loaded (--paper ground on <body>).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(247, 244, 239)");

  // Sign-out lives in settings.
  await page.click("#setBtn");
  await page.click("#ns_logout");
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
  await expect(page.locator("#list")).toContainText("沒有符合的造訪");
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

test("purpose filter narrows the visited list (legacy categories mapped on read)", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  // 咖啡 ×2, 晚餐, 早餐 all read as 飲食; the chip shows the count.
  await expect(page.locator('#fl_cats [data-c="飲食"]')).toContainText("4");
  await page.click('#fl_cats [data-c="飲食"]');
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(4);
  await page.click('#fl_cats [data-c="飲食"]');
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);
});

test("trip type filter: 國內 covers the fixture trip, 日常 the trip-less visits", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.selectOption("#fl_trip", "type:domestic");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(3);
  await page.selectOption("#fl_trip", "type:daily");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(4);
  await page.selectOption("#fl_trip", "type:overseas");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(0);
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

  await expect(page.locator("#list .card[data-pid]", { hasText: "海邊旅店" })).toContainText("2晚");
});

test("clicking a visit opens the editor with its stored data", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.locator("#list .card[data-pid]", { hasText: "山線車站" }).first().click();

  await expect(page.locator('.ed-head[data-title="編輯造訪"]')).toBeVisible();
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-02");
  await expect(page.locator('#ns_purpose [data-purpose="交通"]')).toHaveClass(/on/);
  await expect(page.locator("#ns_end_date")).toBeHidden();
});

test("settings modal opens and a display toggle does not break the shell", async ({ page }) => {
  await signIn(page);

  await page.click("#setBtn");
  await expect(page.locator('.ed-head[data-title="設定"]')).toBeVisible();

  await page.uncheck("#ns_pins");
  await expect(page.locator("#ns_markermode")).toBeVisible();

  await page.click("#ns_done");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list")).toBeVisible();
});

for (const [label, size] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  test(`${label}: the list toggle only shows/hides the list; map and button never move`, async ({ page }) => {
    await page.setViewportSize(size);
    await signIn(page);
    const box = (sel) => page.locator(sel).boundingBox();
    const mapBefore = await box("#map");
    const btnBefore = await box("#listBtn");
    await expect(page.locator(".side")).toBeVisible();

    await page.click("#listBtn");
    await expect(page.locator(".side")).toBeHidden();
    await page.waitForTimeout(300); // let the slide transition finish
    expect(await box("#map")).toEqual(mapBefore);
    expect(await box("#listBtn")).toEqual(btnBefore);
    // Where the list was, taps now reach the map.
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("#map"),
      [size.width - 40, size.height - 40]);
    expect(hit).toBe(true);

    await page.click("#listBtn");
    await expect(page.locator(".side")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await box("#map")).toEqual(mapBefore);
    expect(await box("#listBtn")).toEqual(btnBefore);
  });
}
