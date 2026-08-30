#!/usr/bin/env node

/**
 * Runs the Playwright end-to-end suite against emulators that are already up.
 *
 * Invoked by `firebase emulators:exec` from scripts/e2e.mjs, so the Auth and
 * Firestore emulators are guaranteed to be running. This script:
 *
 *   1. seeds tests/fixtures/mapair-no-space.json into the Firestore emulator
 *      (scripts/seed-emulator.mjs, hard-coded to 127.0.0.1:8080 / demo project),
 *   2. runs `playwright test`, forwarding args passed via E2E_PLAYWRIGHT_ARGS.
 *
 * It never touches production; all safety boundaries live in seed-emulator.mjs.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The Node binary is invoked directly (its path may contain spaces, so no
// shell); `npx` is a shim that needs a shell on Windows.
const seed = spawnSync(process.execPath, ["scripts/seed-emulator.mjs", "--fixture", "no-space"], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (seed.error) throw seed.error;
if (seed.status !== 0) {
  console.error("e2e-run: emulator seed failed; not starting Playwright.");
  process.exit(seed.status ?? 1);
}

let passthrough = [];
try {
  passthrough = JSON.parse(process.env.E2E_PLAYWRIGHT_ARGS || "[]");
} catch {
  passthrough = [];
}

const playwright = spawnSync("npx", ["playwright", "test", ...passthrough], {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (playwright.error) throw playwright.error;
process.exit(playwright.status ?? 1);
