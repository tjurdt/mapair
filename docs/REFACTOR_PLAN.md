# Structure Refactor Plan

> **Goal.** Pay down the `src/main.js` technical debt *without changing any
> existing behaviour*, so that adding features later is safe and cheap.
>
> **Non-goals.** No visual redesign, no schema migration, no dependency
> upgrades unrelated to a step, no new product features. Every step is
> independently reviewable and reversible (`AGENTS.md`).
>
> Branch: `refactor/structure`. PRs land on `main` one step at a time.

## Why

`src/no-space/*` and the pure policy helpers are clean, tested, and safe to
work in. The liability is [`src/main.js`](../src/main.js): ~3,000 lines, ~60
mutable module globals with implicit dependencies, string-template rendering
with manual handler rebinding, and **the same logic implemented several times
in parallel** (marker colour, filter predicates, occurrence enumeration).
Those parallel implementations are what makes feature work "fix one thing,
break another".

## Phase 0 — Regression safety net *(in progress)*

Add a browser end-to-end smoke suite so any later change to `main.js` can be
proven not to have moved unrelated behaviour. Purely additive; touches no
runtime code.

- Playwright, run against the Firebase Auth + Firestore emulators and the Vite
  dev server, signed in through the existing **LOCAL TEST** identity buttons.
- Tests seeded from `tests/fixtures/mapair-no-space.json`.
- Coverage follows the "Automation: Yes" rows of
  [`docs/archive/baseline/BEHAVIOR_CHECKLIST.md`](archive/baseline/BEHAVIOR_CHECKLIST.md):
  sign-in/shell/logout, tabs, date scopes, repeated Visits, participant /
  category / Trip filters, stay rendering, day reorder, editor + settings open,
  Visit delete.
- Wired into CI as a separate `e2e` job.

Run locally: `npm run test:e2e` (needs Java for the emulator).

**Exit criteria:** suite green in CI; documented in `tests/e2e/README.md`.

## Phase 1 — Extract the drift-prone pure logic out of `main.js`

Mechanical, behaviour-preserving extraction into side-effect-free, unit-tested
modules. Each sub-step is its own PR, guarded by the Phase 0 suite.

1. `src/domain/occurrences.js` — one implementation of occurrence enumeration,
   sorting, stay-night expansion, and single-day sequencing. Replaces the
   parallel bodies in `getDayOccurrences`, `getFilteredVisitOccurrences`,
   `sequenceOccurrences`, `fullDayOrdinaryOccurrences`,
   `representativeDateOccurrence`, and the inline loop in `renderMarkers`.
2. `src/domain/filter.js` — one `visitPasses()` / `placePasses()` pair.
   Replaces `passFilter`, `visitPassFilter`, `areaVisitPassFilter`,
   `mapAreaPlacePassFilter`.
3. `src/domain/marker-color.js` — one `resolveColor({ scope, place, visit,
   occurrence, mode, palette })`. Replaces `markerColor`,
   `markerColorForVisit`, `markerColorForOccurrence`, `effectiveMarkerColor`,
   `dateOccurrenceColor`, and the colour branches in `restyleProximityLayer`
   and `areaMetricLegendBody`.

**Exit criteria per sub-step:** new module has tests; `main.js` calls it and
holds no second copy of that logic; Phase 0 suite and `npm test` green.

## Phase 2 — Single state object + single render entry point

Collapse the ~60 globals into one `state` object (moved one group at a time:
filters → map presentation → navigation → interaction). Convert Firestore
snapshots and UI events into named updates that call one `render()` dispatch,
making the `applyFilter()` cascade explicit instead of implicit.

**Exit criteria:** one documented owner per former global; state transitions
testable without a browser; Phase 0 suite green.

## Phase 3 — Extract rendering surface by surface

One UI surface per PR, markup and CSS classes unchanged, order: modal helpers →
filter controls → list/cards → Trips → Visit editor → settings → shell/layout →
CSS out of `index.html`. Mirrors `MIGRATION_PLAN.md` stages 5–7.

## Phase 4 — Cheap known-bug fixes (independent small PRs, not bundled)

From [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md#L179): dangling
`visit.tripId` after Trip delete, non-serialised `setDayOrder`, missing delete
confirmations, stale cached admin codes after a coordinate change.

## Working rules for feature work during and after this refactor

See [`docs/VIBE_CODING_RULES.md`](VIBE_CODING_RULES.md).
