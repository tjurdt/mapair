import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const rootDir = import.meta.dirname;
const outDir = resolve(rootDir, "dist");

export default defineConfig({
  base: "./",
  // GitHub Pages serves the repo root as-is, so PWA assets live in pwa/ and
  // sw.js at the root (same paths in dev, in the source tree and in dist).
  publicDir: false,
  build: {
    outDir,
  },
  plugins: [
    {
      name: "copy-geo-assets",
      closeBundle() {
        cpSync(resolve(rootDir, "geo"), resolve(outDir, "geo"), {
          recursive: true,
        });
        cpSync(resolve(rootDir, "pwa"), resolve(outDir, "pwa"), { recursive: true });
        cpSync(resolve(rootDir, "sw.js"), resolve(outDir, "sw.js"));
      },
    },
  ],
});
