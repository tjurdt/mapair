import { test, expect } from "@playwright/test";
import { signIn, reseed, FIXTURE_MONTH, setDateRange } from "./helpers.mjs";

// DITTO ("這裡再記一筆") lives in the edit-Visit dialog: it opens a new Visit
// for the same Place, carrying over its latest category and participants.

test.beforeEach(() => reseed());

test("DITTO is offered when editing a Visit, not when creating one", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await expect(page.locator("#list [data-ditto]")).toHaveCount(0);

  await page.locator("#list .card[data-pid]", { hasText: "河畔咖啡" }).first().click();
  await expect(page.locator("#ns_ditto")).toBeVisible();
});

test("DITTO opens a new Visit for the same Place with carried-over data", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.locator("#list .card[data-pid]", { hasText: "河畔咖啡" }).first().click();
  await page.click("#ns_ditto");

  await expect(page.locator('.ed-head[data-title="新增造訪"]')).toBeVisible();
  await expect(page.locator("#ns_ditto")).toHaveCount(0);
  await expect(page.locator("#ns_place")).toHaveValue("place-test-no-space-cafe");
  // 河畔咖啡's latest fixture Visit is category 咖啡 (read as 飲食), participants A+B.
  await expect(page.locator('#ns_purpose [data-purpose="飲食"]')).toHaveClass(/\bon\b/);
  await expect(page.locator("#ns_participants_hist")).toContainText("測試使用者 B");
});
