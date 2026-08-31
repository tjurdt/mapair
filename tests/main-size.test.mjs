import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Ratchet: src/main.js must not grow from unstructured additions. It is the
// monolith being dismantled (docs/REFACTOR_PLAN.md) — new UI belongs in
// src/ui/*, new logic in src/domain/*. Lower this budget whenever an
// extraction PR shrinks the file. Raising it needs an explicit reason: a
// Phase 2 state-namespacing slice adds `state.` prefixes (a small, deliberate
// bump), or a genuine bug fix needs a couple of lines.
const MAX_LINES = 2760;

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const lines = source.split("\n").length;

assert.ok(
  lines <= MAX_LINES,
  `src/main.js is ${lines} lines, over the ${MAX_LINES} budget. Put new code in src/ui/* or src/domain/*; only raise the budget with a stated reason.`
);

console.log(`main.js size ok: ${lines} / ${MAX_LINES} lines`);
