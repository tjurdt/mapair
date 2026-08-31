import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// Feature 9: the search box toggles between "add a Place" and "filter the
// visited list by Place name".

test.beforeEach(() => reseed());

test("the toggle cycles the search box between add and filter modes", async ({ page }) => {
  await signIn(page);

  const input = page.locator("#search");
  await expect(input).toHaveAttribute("placeholder", /搜尋地點加入/);
  await expect(page.locator("#searchModeToggle")).toHaveText("＋");

  await page.click("#searchModeToggle");
  await expect(input).toHaveAttribute("placeholder", /篩選造訪/);
  await expect(page.locator("#searchModeToggle")).toHaveText("🔍");

  await page.click("#searchModeToggle");
  await expect(input).toHaveAttribute("placeholder", /搜尋地點加入/);
});

test("filter mode narrows the list by Place name and the chip clears it", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);

  await page.click("#searchModeToggle");
  await page.fill("#search", "咖啡");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(4);
  await expect(page.locator("#list .card[data-pid]", { hasText: "河畔咖啡" })).toHaveCount(4);
  await expect(page.locator("#filterChips")).toContainText("🔍 咖啡");

  await page.fill("#search", "車站");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(1);
  await expect(page.locator("#list .card[data-pid]").first()).toContainText("山線車站");

  await page.locator("#filterChips [data-clearq]").click();
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);
});

test("leaving filter mode drops the keyword", async ({ page }) => {
  await signIn(page);
  await setDateRange(page, FIXTURE_MONTH.from, FIXTURE_MONTH.to);

  await page.click("#searchModeToggle");
  await page.fill("#search", "咖啡");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(4);

  await page.click("#searchModeToggle"); // back to add mode
  await expect(page.locator("#search")).toHaveValue("");
  await expect(page.locator("#list .card[data-pid]")).toHaveCount(7);
  await expect(page.locator("#filterChips")).not.toContainText("🔍");
});
