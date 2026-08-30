# Working rules for feature work on Mapair

These keep quick, iterative ("vibe") changes from going in circles inside
`src/main.js`. Read `AGENTS.md` first — its repository safety rules still apply.

## 1. Prefer the domain modules over `main.js`

Colour, filter predicates, occurrence enumeration, date maths, participant
resolution, ordering — these belong in `src/domain/*`, `src/no-space/*`,
`src/participants.js`, `src/ux-policies.js`, `src/map-color-scales.js`. If the
behaviour you need lives inlined in `main.js`, extract it to a tested module
first (small PR), then build on the module.

## 2. One concern per PR

No features inside a refactor. No refactors inside a feature. Bug fixes
separate from both.

## 3. Prove you did not move unrelated behaviour

Before and after any `main.js` change, run `npm run test:e2e` and `npm test`.
Paste the result. A red or skipped suite is not "done".

## 4. Before touching a known hot spot, check for parallel implementations

The recurring regression sources, all in `main.js`:

- **Marker / area colour** — resolved in ~8 functions
  (`markerColor`, `markerColorForVisit`, `markerColorForOccurrence`,
  `effectiveMarkerColor`, `dateOccurrenceColor`, `representativeDateOccurrence`,
  `restyleProximityLayer`, `areaMetricLegendBody`).
- **Filter predicates** — `passFilter`, `visitPassFilter`,
  `areaVisitPassFilter`, `mapAreaPlacePassFilter`.
- **Occurrence enumeration / sort / stay expansion** — `getDayOccurrences`,
  `getFilteredVisitOccurrences`, `sequenceOccurrences`,
  `fullDayOrdinaryOccurrences`, `representativeDateOccurrence`, inline in
  `renderMarkers`.
- **`applyFilter()` cascade** — list render updates chips; marker render
  updates the legend; overlapping Firestore listeners each call a subset.

If your change belongs in one of these, find every copy and converge them
before editing (that is Phase 1 of `REFACTOR_PLAN.md`).

## 5. Copy the established async patterns, do not improvise

- Every listener callback / editor / deferred write checks
  `runtimeSessionIsCurrent(session, uid)` (and, in LOCAL, the `localFailure`
  latch) before applying a result. Capture `session` and `uid` at the top.
- Writes go through the No-Space repository, never straight to Firestore.
- Optimistic UI updates follow the existing triple: local mutation →
  `refreshNoSpaceProjection()` → `repo.<call>()`.

## 6. Visual baseline

The colouring / menu baseline is commit `02e35d3` (8/28). The Phase 0 colour
snapshots are aligned to it; keep them aligned.
