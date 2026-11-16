import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// GitHub Pages serves the repository root of `main` as-is (no Vite build), so
// everything index.html links must exist at that path in the source tree, and
// the browser must be able to import every module without a bundler.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

const hrefs = [...html.matchAll(/<link[^>]+href="(\.\/[^"]+)"/g)].map((m) => m[1]);
for (const href of hrefs) {
  assert.ok(existsSync(join(root, href)), `index.html links ${href}, which must exist in the repo`);
}
assert.ok(hrefs.includes("./pwa/manifest.webmanifest"), "the manifest is linked");
assert.ok(hrefs.includes("./pwa/apple-touch-icon.png"), "the iOS home-screen icon is linked");
assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/, "iOS opens the home-screen shortcut full screen");
assert.match(html, /register\('\.\/sw\.js'\)/, "the service worker is registered");
assert.ok(existsSync(join(root, "sw.js")), "sw.js sits at the root so its scope covers the app");

const manifestPath = join(root, "pwa/manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert.equal(manifest.display, "standalone", "opens like an installed app, without the address bar");
assert.equal(manifest.start_url, "../", "start_url resolves (relative to pwa/) to the app root");
assert.equal(manifest.scope, "../");
const sizes = new Set(manifest.icons.map((i) => i.sizes));
assert.ok(sizes.has("192x192") && sizes.has("512x512"), "Android needs 192 and 512 icons");
assert.ok(manifest.icons.some((i) => i.purpose === "maskable"), "a maskable icon for Android launchers");
for (const iconEntry of manifest.icons) {
  const file = join(dirname(manifestPath), iconEntry.src);
  assert.ok(existsSync(file) && statSync(file).size > 0, `manifest icon ${iconEntry.src} exists`);
}

// No bare JSON module imports in browser code (they fail without a bundler).
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []);
for (const file of walk(join(root, "src"))) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /import\s*\(?\s*["'][^"']+\.json["']/, `${file} must not import .json directly`);
}

console.log("pwa assertions passed");
