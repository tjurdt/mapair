import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// Write paths that Phase 1 will refactor (occurrence enumeration, ordering,
// delete). Each test re-seeds first, so a failed write cannot poison the next.

test.beforeEach(() => reseed());

test("deleting a visit removes it from the visited list", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);

  // 山線車站's Visit was created by test-user-a, so the delete affordance shows.
  await page
    .locator("#list .card[data-pid]", { hasText: "山線車站" })
    .first()
    .locator("[data-vdel]")
    .click();

  await expect(page.locator("#list .card[data-pid]")).toHaveCount(6);
  await expect(page.locator("#list .card[data-pid]", { hasText: "山線車站" })).toHaveCount(0);
});

test("day reorder arrows change the stored order", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, "2026-08-02", "2026-08-02");

  const names = () => page.locator("#list .card[data-pid] .cname").allTextContents();
  await expect.poll(names).toEqual(["河畔咖啡", "山線車站", "測試大學"]);

  await page.locator('#list .card[data-pid]').first().locator('[data-vmove="down"]').click();
  await expect.poll(names).toEqual(["山線車站", "河畔咖啡", "測試大學"]);

  // The write reached the emulator: a reload (auth persists) keeps the order.
  await page.reload();
  await page.waitForSelector("#list");
  const gateButton = page.getByRole("button", { name: "測試使用者甲" });
  if (await gateButton.isVisible().catch(() => false)) await gateButton.click();
  await setDateRange(page, "2026-08-02", "2026-08-02");
  await expect.poll(names).toEqual(["山線車站", "河畔咖啡", "測試大學"]);
});
