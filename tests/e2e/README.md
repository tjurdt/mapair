# End-to-end regression net

Browser smoke tests that lock the current behaviour of `src/main.js` so the
structure refactor (`docs/REFACTOR_PLAN.md`) cannot move unrelated behaviour.

## What runs

`npm run test:e2e` wraps the run in `firebase emulators:exec` (Auth + Firestore
emulators, project `demo-mapair-local`), then `scripts/e2e-run.mjs`:

1. seeds `tests/fixtures/mapair-no-space.json` via `scripts/seed-emulator.mjs`
   (hard-coded to `127.0.0.1:8080`, no production fallback),
2. runs `playwright test`, which starts the Vite dev server (`npm run dev:e2e`,
   port 5173) and drives Chromium.

Tests sign in through the existing **LOCAL TEST** identity buttons
(`測試使用者甲` / `test-user-a`). Google Maps and web fonts are blocked in the
browser context so the run is hermetic; the client already tolerates Maps
failing to load.

Each spec calls `reseed()` in `beforeEach`, so specs are order-independent and a
failed write cannot poison the next test.

## Requirements

- JDK 21+ on `PATH` (the Firebase emulators require it).
- `npx playwright install chromium` once.

## Running

```sh
npm run test:e2e                       # all specs, headless
npm run test:e2e -- --headed           # watch it run
npm run test:e2e -- smoke.spec.mjs     # one file
npm run test:e2e -- --ui               # Playwright UI mode
```

If you already have the emulators running on 8080/9099, run
`node scripts/e2e-run.mjs` directly instead — but note the seed step **clears
the emulator database** first.

## Coverage

`smoke.spec.mjs` (read-only) and `mutations.spec.mjs` (delete, reorder) track
the "Automation: Yes" rows of
`docs/archive/baseline/BEHAVIOR_CHECKLIST.md`: sign-in/shell/logout, tabs, date
range, repeated Visits, participant/category/Trip filters, stay rendering,
editor + settings open, Visit delete, day reorder.

Map pixels, viewport fitting, choropleth appearance, and mobile layout are
**not** covered here (they need visual/manual checks — see the checklist).
