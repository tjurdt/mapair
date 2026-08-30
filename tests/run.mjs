#!/usr/bin/env node
/**
 * Dependency-free test runner for the pure Node assertion files under tests/.
 *
 * Auto-discovers every `*.test.mjs` in this directory except the Firestore
 * rules test, which needs the emulator and runs through `npm run test:rules`.
 * Runs each file in its own process, continues past failures, and exits
 * non-zero if any file failed. Adding a new `*.test.mjs` needs no change here.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const testsDir = dirname(fileURLToPath(import.meta.url));
const EMULATOR_ONLY = new Set(["firestore-no-space.rules.test.mjs"]);

const files = readdirSync(testsDir)
  .filter(name => name.endsWith(".test.mjs") && !EMULATOR_ONLY.has(name))
  .sort();

let failed = 0;
for (const file of files){
  const result = spawnSync(process.execPath, [join(testsDir, file)], { stdio: "inherit" });
  if (result.status !== 0){
    failed++;
    console.error(`✗ ${file} failed (exit ${result.status})`);
  }
}

if (failed){
  console.error(`\n${failed} of ${files.length} test file(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test files passed.`);
