import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Ratchet: src/main.js must not grow. It is the monolith being dismantled
// (docs/REFACTOR_PLAN.md) — new UI belongs in src/ui/*, new logic in
// src/domain/*. Lower this budget whenever an extraction PR shrinks the file;
// raising it needs an explicit reason in the PR. The small headroom over the
// current size is only so a genuine bug fix inside main.js does not have to
// touch this test.
const MAX_LINES = 2875;

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const lines = source.split("\n").length;

assert.ok(
  lines <= MAX_LINES,
  `src/main.js is ${lines} lines, over the ${MAX_LINES} budget. Put new code in src/ui/* or src/domain/*; only raise the budget with a stated reason.`
);

console.log(`main.js size ok: ${lines} / ${MAX_LINES} lines`);
