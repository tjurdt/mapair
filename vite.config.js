import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const rootDir = import.meta.dirname;
const outDir = resolve(rootDir, "dist");

export default defineConfig({
  base: "./",
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
      },
    },
  ],
});
