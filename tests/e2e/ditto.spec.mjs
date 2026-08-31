import { test, expect } from "@playwright/test";
import { signIn, reseed, FIXTURE_MONTH, setDateRange } from "./helpers.mjs";

// Feature 10: while the list is filtered, every Visit card gets a DITTO button
// that opens a new Visit for the same Place, carrying over its latest
// category and participants.

test.beforeEach(() => reseed());

test("the DITTO button appears only while the list is filtered", async ({ page }) => {
  await signIn(page);
  await page.selectOption("#fl_scope", "month");
  await expect(page.locator("#list .card[data-pid]").first()).toBeVisible();
  await expect(page.locator("#list [data-ditto]")).toHaveCount(0);

  await page.selectOption("#fl_trip", "trip-test-no-space-summer");
  await expect(page.locator("#list [data-ditto]").first()).toBeVisible();
});

test("DITTO opens a new Visit for the same Place with carried-over data", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page
    .locator("#list .card[data-pid]", { hasText: "河畔咖啡" })
    .first()
    .locator("[data-ditto]")
    .click();

  await expect(page.locator(".modal h2")).toHaveText("新增造訪");
  await expect(page.locator("#ns_place")).toHaveValue("place-test-no-space-cafe");
  // 河畔咖啡's latest fixture Visit is category 咖啡, participants A+B.
  await expect(page.locator("#ns_category")).toHaveValue("咖啡");
  await expect(page.locator("#ns_participants_hist")).toContainText("測試使用者 B");
});
