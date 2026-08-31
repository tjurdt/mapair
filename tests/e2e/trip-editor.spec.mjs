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
  await expect(page.locator(".modal h2")).toHaveText("新增旅程");
  await page.fill("#nst_name", "測試新旅程");
  await page.fill("#nst_start", "2026-09-01");
  await page.click("#nst_save");

  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list .triprow")).toHaveCount(2);
  await expect(page.locator("#list")).toContainText("測試新旅程");
});

test("renaming then deleting a Trip through the editor", async ({ page }) => {
  await openTrips(page);

  await page.click('[data-edit="trip-test-no-space-summer"]');
  await expect(page.locator(".modal h2")).toHaveText("編輯旅程");
  await page.fill("#nst_name", "改名的旅程");
  await page.click("#nst_save");
  await expect(page.locator("#list")).toContainText("改名的旅程");

  await page.click('[data-edit="trip-test-no-space-summer"]');
  await page.click("#nst_delete");
  await expect(page.locator(".modal-bg")).toHaveCount(0);
  await expect(page.locator("#list .triprow")).toHaveCount(0);
});
