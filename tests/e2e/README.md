# End-to-end regression net

Browser smoke tests that lock the current behaviour of `src/main.js` so the
structure refactor (`docs/REFACTOR_PLAN.md`) cannot move unrelated behaviour.

## What runs

`npm run test:e2e` runs `scripts/e2e.mjs`, which:

1. locates a JDK >= 21 (`scripts/java-home.mjs`) and puts it on the child
   environment, so the emulators start even when `PATH` points at an old Java;
2. refuses to run if ports 8080/9099 are already taken (it owns a throwaway
   emulator and must not seed into one you are using);
3. runs `firebase emulators:exec` (Auth + Firestore, project
   `demo-mapair-local`), which invokes `scripts/e2e-run.mjs` to
   seed `tests/fixtures/mapair-no-space.json` via `scripts/seed-emulator.mjs`
   (hard-coded to `127.0.0.1:8080`, no production fallback) and then run
   `playwright test`, which starts the Vite dev server (`npm run dev:e2e`, port
   5173) and drives Chromium.

Tests sign in through the existing **LOCAL TEST** identity buttons
(`測試使用者甲` / `test-user-a`). Google Maps and web fonts are blocked in the
browser context so the run is hermetic; the client already tolerates Maps
failing to load.

Each spec calls `reseed()` in `beforeEach`, so specs are order-independent and a
failed write cannot poison the next test.

## Requirements

- JDK 21+ installed (need not be on `PATH` — `scripts/java-home.mjs` finds
  Adoptium/Temurin, Oracle, Microsoft, Corretto, Zulu, Liberica, Semeru, or a
  machine-level `JAVA_HOME`). Install from <https://adoptium.net> if missing.
- `npx playwright install chromium` once.
- No `firebase emulators:start` already running (stop it first — this command
  starts its own).

## Running

```sh
npm run test:e2e                       # all specs, headless
npm run test:e2e -- --headed           # watch it run
npm run test:e2e -- smoke.spec.mjs     # one file
npm run test:e2e -- --ui               # Playwright UI mode
```

To run against an emulator you already have up (skips JDK/port handling), call
`node scripts/e2e-run.mjs` directly — but note its seed step **clears the
emulator database** first.

## Coverage

`smoke.spec.mjs` (read-only) and `mutations.spec.mjs` (delete, reorder) track
the "Automation: Yes" rows of
`docs/archive/baseline/BEHAVIOR_CHECKLIST.md`: sign-in/shell/logout, tabs, date
range, repeated Visits, participant/category/Trip filters, stay rendering,
editor + settings open, Visit delete, day reorder.

Map pixels, viewport fitting, choropleth appearance, and mobile layout are
**not** covered here (they need visual/manual checks — see the checklist).
