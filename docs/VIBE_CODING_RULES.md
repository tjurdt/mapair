# Working rules for feature work on Mapair

These keep quick, iterative ("vibe") changes from going in circles inside
`src/main.js`. Read `AGENTS.md` first — its repository safety rules still apply.

## 1. Prefer the modules over `main.js` — it has a size budget

Logic (colour, filters, occurrences, dates, participants, ordering) belongs in
`src/domain/*` / `src/no-space/*` / the pure helpers. UI surfaces (modals,
panels, renderers) belong in `src/ui/*`. `main.js` is the shrinking monolith —
`tests/main-size.test.mjs` fails CI if it grows past its budget. If the
behaviour you need is inlined in `main.js`, extract it to a tested module
first (small PR), then build on the module.

## 2. One concern per PR

No features inside a refactor. No refactors inside a feature. Bug fixes
separate from both.

## 3. Prove you did not move unrelated behaviour

Before and after any `main.js` change, run `npm run test:e2e` and `npm test`.
Paste the result. A red or skipped suite is not "done".

## 4. Before touching a known hot spot, check for parallel implementations

The recurring regression sources, all in `main.js`:

- **Marker / area colour** — the mode dispatch is now
  `resolveMarkerColor(mode, source)` in `src/domain/marker-color.js`
  (`markerColor` / `markerColorForVisit` are thin wrappers — add a mode there,
  not in `main.js`). Still parallel and drift-prone: the date-scale maths
  (`dateOccurrenceColor`, `dateBaseColor`, `singleDayOrderColor`,
  `orderedVisitDateColor`) and the composers `markerColorForOccurrence` /
  `effectiveMarkerColor` / `restyleProximityLayer` / `areaMetricLegendBody`
  (Plan steps 3b, 3c).
- **Filter predicates** — now in `src/domain/filter.js` (`visitPasses`,
  `placePasses`, and the `*Pass` primitives). `visitPassFilter` / `passFilter`
  / `areaVisitPassFilter` / `visitMatches*` / `placeStaticFilter` in `main.js`
  are thin bindings to the live `filter` — change the rule in the module, not
  in a binding.
- **Occurrence build / sort / stay expansion** — the shape, comparator, and
  stay-anchor rule are now in `src/domain/occurrences.js` (use `occurrence()`,
  `compareOccurrences` / `sortOccurrences`, `stayAnchorsOnDate` — never rebuild
  the `{ p, v, visitIndex, seqDate, stayAnchor, fixed }` literal by hand). The
  *enumeration* loop is still repeated across `getDayOccurrences`,
  `getFilteredVisitOccurrences`, `fullDayOrdinaryOccurrences`, and
  `representativeDateOccurrence` (Plan step 1b).
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
