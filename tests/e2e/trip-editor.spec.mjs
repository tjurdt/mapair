import { test, expect } from "@playwright/test";
import { signIn, reseed } from "./helpers.mjs";

// The Trip create / edit / delete modal (src/ui/trip-editor.js).

test.beforeEach(() => reseed());

async function openTrips(page) {
  await signIn(page);
  await page.click('.tab[data-t="trips"]');
}

test("creating a Trip adds it to the Trips list", async ({ page }) => {
  await openTrips(page);
  await expect(page.locator("#list .triprow")).toHaveCount(1);

  await page.click("#newtrip");
  await expect(page.locator('.ed-head[data-title="新增旅程"]')).toBeVisible();
  await page.fill("#nst_name", "測試新旅程");
  await page.fill("#nst_start", "2026-09-01");
  await page.click("#nst_save"); // ✕ = save and close

  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list .triprow")).toHaveCount(2);
  await expect(page.locator("#list")).toContainText("測試新旅程");
});

test("renaming then deleting a Trip through the editor", async ({ page }) => {
  await openTrips(page);

  await page.click('[data-edit="trip-test-no-space-summer"]');
  await expect(page.locator('.ed-head[data-title="編輯旅程"]')).toBeVisible();
  await page.fill("#nst_name", "改名的旅程");
  await page.click("#nst_save");
  await expect(page.locator("#list")).toContainText("改名的旅程");

  page.removeAllListeners("dialog");
  page.on("dialog", (dialog) => dialog.accept());
  await page.click('[data-edit="trip-test-no-space-summer"]');
  await page.click("#nst_delete");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list .triprow")).toHaveCount(0);
});

test("only three trip types: 日常 / 國內 / 出國", async ({ page }) => {
  await openTrips(page);
  await page.click("#newtrip");
  await expect(page.locator("#nst_type [data-type]")).toHaveText(["🏠 日常", "🚆 國內", "✈️ 出國"]);
});

test("a new Trip left without a name closes without being created", async ({ page }) => {
  await openTrips(page);
  await page.click("#newtrip");
  await page.click("#nst_save");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list .triprow")).toHaveCount(1);
});

test("while filtering one Trip, ✎ next to the trip filter opens that Trip's editor", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#fl_trip_edit")).toBeHidden();
  await page.selectOption("#fl_trip", "trip-test-no-space-summer");
  await expect(page.locator("#fl_trip_edit")).toBeVisible();
  await page.click("#fl_trip_edit");
  await expect(page.locator('.ed-head[data-title="編輯旅程"]')).toBeVisible();
  await expect(page.locator("#nst_name")).toHaveValue("三人夏日旅行");
  await page.fill("#nst_name", "夏日旅行改");
  await page.click("#nst_save");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#fl_trip option:checked")).toContainText("夏日旅行改");

  await page.selectOption("#fl_trip", "all");
  await expect(page.locator("#fl_trip_edit")).toBeHidden();
});
