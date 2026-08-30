import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Reset the Firestore emulator to the No-Space fixture. Called from each
// spec's beforeEach so specs never depend on another spec's mutations.
export function reseed() {
  execFileSync(process.execPath, ["scripts/seed-emulator.mjs", "--fixture", "no-space"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

// Hosts blocked during E2E so the run is hermetic and deterministic. Google
// Maps failing to load is a supported path in the client (initMap throws, is
// caught, the list still renders); the Firebase SDK on www.gstatic.com and the
// emulators on 127.0.0.1 are deliberately NOT in this list.
function isBlockedHost(host) {
  return (
    host === "maps.googleapis.com" ||
    host.startsWith("maps.") ||
    host === "fonts.googleapis.com" ||
    host === "fonts.gstatic.com"
  );
}

const IDENTITY_BUTTON = { a: "測試使用者甲", b: "測試使用者乙" };

// Load the app in LOCAL TEST mode, sign in as a fixed test identity, and wait
// for the No-Space projection to render the list for the first time.
export async function signIn(page, identity = "a") {
  await page.route("**/*", (route) => {
    let host = "";
    try {
      host = new URL(route.request().url()).host;
    } catch {
      return route.continue();
    }
    return isBlockedHost(host) ? route.abort() : route.continue();
  });
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  await page.goto("/?firebaseEnv=local");
  await page.getByRole("button", { name: IDENTITY_BUTTON[identity] }).click();

  await page.waitForSelector("#list");
  await page.waitForFunction(() => {
    const el = document.querySelector("#list");
    if (!el) return false;
    if (el.querySelector(".card")) return true;
    const empty = el.querySelector(".empty");
    return !!empty && !empty.textContent.includes("載入中");
  });
}

// Constrain the visited list to an explicit date window, independent of what
// "this month" happens to be when the suite runs. Selecting the custom scope
// also reveals #filterPanel, which holds the date inputs and category chips.
export async function setDateRange(page, from, to) {
  await page.selectOption("#fl_scope", "custom");
  await page.fill("#fl_from", from);
  await page.fill("#fl_to", to);
}

// Every fixture Visit for test-user-a falls in this window.
export const FIXTURE_MONTH = { from: "2026-08-01", to: "2026-08-31" };
