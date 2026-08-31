import { test, expect } from "@playwright/test";
import { signIn, reseed, setDateRange, FIXTURE_MONTH } from "./helpers.mjs";

// The friends manager (openFriendsManager) — currently the largest untested
// surface. Covers the single-user affordances and the full two-party
// invite → accept → link handshake.

test.beforeEach(() => reseed());

test("a shareable friend code is generated on first open", async ({ page }) => {
  await signIn(page);
  await page.click("#friendsBtn");
  await expect(page.locator(".modal h2")).toHaveText("好友");

  await expect(page.locator("#fm_mycode")).not.toHaveText("產生中…");
  await expect(page.locator("#fm_mycode")).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
});

test("adding your own id is rejected", async ({ page }) => {
  await signIn(page);
  await page.click("#friendsBtn");

  await page.fill("#fm_uid", "test-user-a");
  await page.click("#fm_add");
  await expect(page.locator("#fm_err")).toHaveText("這是你自己");
  await expect(page.locator("#fm_outgoing_wrap")).toBeHidden();
});

test("two users complete the invite → accept → link handshake", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await signIn(pageA, "a");
    await signIn(pageB, "b");

    // B sends an invite to A's id.
    await pageB.click("#friendsBtn");
    await pageB.fill("#fm_uid", "test-user-a");
    await pageB.click("#fm_add");
    await expect(pageB.locator("#fm_outgoing")).toContainText("test-user-a");

    // A sees it and accepts.
    await pageA.click("#friendsBtn");
    await expect(pageA.locator("#fm_incoming")).toContainText("test-user-b");
    await pageA.locator("#fm_incoming .fm_accept").click();

    // Both sides end up linked.
    await expect(pageA.locator("#fm_list")).toContainText("test-user-b");
    await expect(pageB.locator("#fm_list")).toContainText("test-user-a");
    await expect(pageB.locator("#fm_outgoing_wrap")).toBeHidden();

    // The payoff: B is now a selectable participant in A's Visit editor.
    await pageA.evaluate(() => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
    await setDateRange(pageA, FIXTURE_MONTH.from, FIXTURE_MONTH.to);
    await pageA.locator("#list .card[data-pid]", { hasText: "河畔咖啡" }).first().locator("[data-ditto]").click();
    await expect(pageA.locator('#ns_participants [data-uid="test-user-b"]')).toHaveCount(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
