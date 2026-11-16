import { test, expect } from "@playwright/test";
import { signIn, reseed } from "./helpers.mjs";

// Editor / filter entry-UX behaviours (features 1-6, 8).

test.beforeEach(() => reseed());

const today = () => new Date().toISOString().slice(0, 10);

// Open the "new Visit" editor by clicking an empty spot on the map. The Maps
// stub returns no nearby places, so the flow lands on "用這個位置自訂".
async function closeModals(page) {
  await page.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
}

async function openNewVisitEditor(page) {
  await closeModals(page);
  const addBtn = page.locator("#addBtn");
  if (!(await addBtn.evaluate((el) => el.classList.contains("on")))) await addBtn.click();
  await page.evaluate(() => window.__mapairFireMapClick(25.04, 121.535));
  await page.locator("#nb_custom").click();
  await expect(page.locator('.ed-head[data-title="新增造訪"]')).toBeVisible();
}

test("a new Visit defaults to today when nothing narrows the date", async ({ page }) => {
  await signIn(page);
  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue(today());
});

test("selecting a Trip clears the date scope to 全部 and a new Visit starts on the Trip's first day", async ({ page }) => {
  await signIn(page);
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");
  await expect(page.locator("#fl_scope")).toHaveValue("all"); // feature 5

  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-03"); // feature 2: Trip startDate
});

test("a non-month date scope starts a new Visit on that scope's first day", async ({ page }) => {
  await signIn(page);
  await page.selectOption("#fl_scope", "custom");
  await page.fill("#fl_from", "2026-03-05");
  await page.fill("#fl_to", "2026-03-20");

  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue("2026-03-05"); // feature 3
});

test("after adding one Visit the next one dittos its date", async ({ page }) => {
  await signIn(page);
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");

  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-03");
  await page.fill("#ns_place_name", "測試地點甲");
  await page.fill("#ns_date", "2026-08-08");
  await page.click("#ns_save");
  await expect(page.locator(".modal-bg")).toHaveCount(0);

  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-08"); // feature 4
  await closeModals(page);

  // Switching the Trip filter forgets the ditto date.
  await page.selectOption("#fl_trip", "all");
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");
  await openNewVisitEditor(page);
  await expect(page.locator("#ns_date")).toHaveValue("2026-08-03");
});

test("the stay toggle reveals a checkout date one day later, and saves a stay", async ({ page }) => {
  await signIn(page);
  await openNewVisitEditor(page);

  await expect(page.locator("#ns_end_date")).toBeHidden();
  await page.fill("#ns_date", "2026-08-10");
  await page.click("#ns_stay");
  await expect(page.locator("#ns_end_date")).toBeVisible();
  await expect(page.locator("#ns_end_date")).toHaveValue("2026-08-11");

  await page.fill("#ns_place_name", "測試旅館");
  await page.click('#ns_purpose [data-purpose="其他"]');
  await page.click("#ns_save");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await page.selectOption("#fl_scope", "custom");
  await page.fill("#fl_from", "2026-08-10");
  await page.fill("#fl_to", "2026-08-10");
  // A single-day view shows the stay as its night card: one night, 1/1.
  await expect(page.locator("#list .card[data-pid]", { hasText: "測試旅館" }).first()).toContainText("夜宿 1/1");
});

test("editing one Trip date seeds the empty other date", async ({ page }) => {
  await signIn(page);
  await page.click('.tab[data-t="trips"]');
  await page.click("#newtrip");
  await expect(page.locator('.ed-head[data-title="新增旅程"]')).toBeVisible();

  await page.fill("#nst_start", "2027-03-10");
  await expect(page.locator("#nst_end")).toHaveValue("2027-03-10"); // feature 6
});
