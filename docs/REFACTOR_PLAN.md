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

1. `src/domain/occurrences.js` — occurrence build / key / date / ordering /
   stay-night expansion.
   - **1a (done).** Pure primitives: `occurrence()` factory, `occurrenceDate`,
     `occurrenceKey`, `stayAnchorRank`, `compareOccurrences` (+ `sortOccurrences`),
     `stayAnchorsOnDate`. The six occurrence-building call sites in `main.js`
     (`getDayOccurrences`, `getFilteredVisitOccurrences`,
     `fullDayOrdinaryOccurrences`, `representativeDateOccurrence`,
     `effectiveMarkerColor`, and the stay-expansion loop) now share one shape,
     one comparator, and one stay-anchor rule.
   - **1b (pending, after step 2).** Fold the *enumeration* structure
     (iterate Places → gate → per-Visit predicate → expand) into the module via
     injected predicates, so `getDayOccurrences` /
     `getFilteredVisitOccurrences` / `fullDayOrdinaryOccurrences` /
     `representativeDateOccurrence` stop repeating the loop. Needs `filter.js`
     first so the predicates are plain values, not closures over `filter`.
2. `src/domain/filter.js` **(done).** `regionsPass` / `participantPass` /
   `tripPass` / `categoryPass` / `dateRangePass` primitives, plus `visitPasses`
   and `placePasses` (with `hasActiveVisitConstraint`). `visitPassFilter`,
   `passFilter`, `areaVisitPassFilter`, and the standalone `visitMatches*` /
   `placeStaticFilter` helpers in `main.js` are now thin bindings of these to
   the live `filter` state; `visitIntersects` is gone. The list vs map-area
   category-resolution difference is preserved via an injected `category`
   reader.
3. `src/domain/marker-color.js`.
   - **3a (done).** `resolveMarkerColor(mode, source)` — one mode dispatcher
     for the Place-level and Visit-level paths. `markerColor` /
     `markerColorForVisit` in `main.js` are now thin wrappers over it with
     `placeColorSource` / `visitColorSource` field readers; adding a marker
     mode is one `case` + one field per source instead of editing two
     divergent functions.
   - **3b (pending).** The date-scale colour maths (`dateOccurrenceColor`,
     `dateBaseColor`, `singleDayOrderColor`, and the stalled unused
     `orderedVisitDateColor` in `map-color-scales.js`) are three parallel
     formulas — consolidate into `map-color-scales.js` without changing the
     rendered output.
   - **3c (pending).** `markerColorForOccurrence` / `effectiveMarkerColor` and
     the colour branches in `restyleProximityLayer` / `areaMetricLegendBody`
     compose the above; fold once 3a/3b settle.

**Exit criteria per sub-step:** new module has tests; `main.js` calls it and
holds no second copy of that logic; Phase 0 suite and `npm test` green.

## Phase 2 — Single state object + single render entry point *(in progress)*

Collapse the ~70 globals into one `state` object, one group per PR (pure
namespacing, E2E-guarded), then convert UI events into named updates that call
one `render()` dispatch, making the `applyFilter()` cascade explicit.

1. **View flags (done).** `state.searchMode` / `lastNewVisitDate` /
   `numberPins` / `regionMulti` / `legendCollapsed`.
2. `state.tab` (careful — the bare word collides with the `.tab` CSS class in
   template strings).
3. `state.dateScope` + `state.pickedMonth` (the `"pickedMonth"` string is also
   a scope *value* — targeted, not sed).
4. `state.filter` (the `{ who, tripId, cats, from, to, regions, placeId, q }`
   object — the big one).
5. Map presentation (`markerMode`, `choroAlpha`, `choroMetric`, `showPins`,
   `adminLevel`, `proximityEnabled`, `addMode`, `tab`-adjacent).
6. Then: `setState(patch)` / named actions, folding the `applyFilter()` /
   `refreshFilterUI()` / `applySearchMode()` call combos into the dispatch.

**Exit criteria:** one documented owner per former global; adding a filter
field touches one place; Phase 0 suite green.

## Phase 3 — Extract rendering surface by surface *(in progress)*

One UI surface per PR into `src/ui/`, markup and CSS classes unchanged, each
guarded by the E2E suite. `main.js` keeps a one-line `openXxx()` that calls the
module.

1. **`src/ui/modal.js` (done).** `modal` / `closeModal` / `closeAllModals`,
   plus `currentRuntimeGuard()` in `main.js` replacing the three hand-rolled
   `live()` closures (one snapshot-guard definition, not N).
2. **`src/ui/trip-editor.js` (done).** `openNoSpaceTripEditor` is a 12-line
   wrapper that injects `{ trip, currentUid, memberUids, participantName,
   repo, isCurrent, onSaved }` into `openTripEditor`. `esc` moved to
   `src/ui/html.js`; the Trip emoji list moved into the module. `main.js`
   lost ~68 lines.
3. **`src/ui/settings.js` (done).** `openNoSpaceSettings` is a wrapper that
   injects current values, a `catalog` of the shared constants, and
   `onMarkerMode / onShowPins / onAlpha / onMetric / onOpenFriends / onSave`
   callbacks. The panel owns the draft state and the save-diff. New
   `settings.spec.mjs` covers the "做什麼" pick and depth-colour save paths.
4. **`src/ui/friends.js` (done).** `friends.spec.mjs` (the invite→accept→link
   handshake across two browser contexts) went in first, then the extraction.
   `openFriendsManager` is a wrapper injecting live-state getters
   (`getFriends` / `getIncomingRaw` return the current `noSpaceState` maps,
   which their listeners reassign), repo, guard, and the friend-code hooks.
5. **`src/ui/visit-editor.js` (done).** The most coupled modal. `main.js`
   resolves its state into a `ctx` (initial values + option lists + the
   collections the live pieces need) and implements `onSave` / `onDelete`
   against the repo; the module owns the form and builds the
   `{ shared, personal, newPlace }` payload. `main.js`: 2860 → 2710.
6. `src/ui/map-markers.js` / `map-surfaces.js` — `renderMarkers`,
   `renderAdministrativeLayer`, proximity coverage.
7. **CSS out of `index.html` (done).** The `<style>` block moved verbatim to
   `src/styles/app.css`, linked from `<head>`; `index.html` is now 39 lines.
   `ux-policies.test.mjs`'s layout-CSS assertions read the new file.
8. `src/ui/shell.js` — the `renderApp` HTML (later; needs Phase 2's state
   object first so the handler wiring has somewhere clean to live).

Phase 3's modal extractions are complete (2–5). What is left in `main.js` is
the shell, the render/data plumbing (`renderApp`, `renderMarkers`,
`renderList`, `subscribeNoSpace`, `applyNoSpaceProjection`, the map surfaces),
and the ~70 globals — which is now Phase 2's job.

Extracting each surface surfaces exactly which globals it reads — that
inventory feeds Phase 2.

**Ratchet.** `tests/main-size.test.mjs` fails CI if `src/main.js` grows past
its budget. Lower the budget on every extraction PR; raising it needs a stated
reason. This keeps new code flowing into `src/ui/*` / `src/domain/*` instead
of back into the monolith.

## Phase 4 — Cheap known-bug fixes (independent small PRs, not bundled)

From [`CURRENT_ARCHITECTURE.md`](CURRENT_ARCHITECTURE.md#L179): dangling
`visit.tripId` after Trip delete, non-serialised `setDayOrder`, missing delete
confirmations, stale cached admin codes after a coordinate change.

## Working rules for feature work during and after this refactor

See [`docs/VIBE_CODING_RULES.md`](VIBE_CODING_RULES.md).
