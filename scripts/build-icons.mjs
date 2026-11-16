// Renders the PWA / home-screen PNG icons from public/icon.svg with Playwright's
// Chromium (already a dev dependency), so no native image library is needed.
//
//   node scripts/build-icons.mjs
//
// Outputs (public/): icon-192.png, icon-512.png, icon-maskable-512.png
// (full-bleed background, artwork inside the 80% safe zone),
// apple-touch-icon.png (180, full-bleed — iOS rounds the corners itself),
// favicon-32.png.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public");
const svg = readFileSync(resolve(publicDir, "icon.svg"), "utf8");
// Full-bleed variant: square background, artwork scaled into the safe zone.
const fullBleed = (scale) => svg
  .replaceAll('rx="112"', 'rx="0"')
  .replace("</defs>", `</defs><g id="__art" transform="translate(256 256) scale(${scale}) translate(-256 -256)">`)
  .replace(/<\/svg>\s*$/, "</g></svg>")
  .replace(/(<g id="__art"[^>]*>)\s*<rect[^>]*\/>/, '<rect width="512" height="512" fill="url(#bg)"/>$1');

const targets = [
  ["icon-192.png", 192, svg],
  ["icon-512.png", 512, svg],
  ["favicon-32.png", 32, svg],
  ["icon-maskable-512.png", 512, fullBleed(0.8)],
  ["apple-touch-icon.png", 180, fullBleed(0.9)]
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, markup] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.locator("svg").screenshot({ omitBackground: true });
  writeFileSync(resolve(publicDir, file), png);
  console.log("wrote", file);
}
await browser.close();
