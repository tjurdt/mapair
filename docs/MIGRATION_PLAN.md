# Vite and ES Module Migration Plan

> **Status: partially done.** Stages 0–3 landed (Vite shell, config/vendor
> adapters, and several pure domain modules under `src/`). Stages 4–8 (explicit
> store, incremental rendering extraction, map isolation, CSS extraction,
> removing the monolith scaffold) are **not** done — `src/main.js` is still a
> ~2,500-line module with all CSS inline in `index.html`. The remaining stages
> are the reference for the planned `src/main.js` decomposition.

## Objective and constraints

Migrate Mapair from a monolithic static `index.html` to Vite and ES modules while preserving current behavior.

The migration must not redesign the Firestore schema at the same time. In particular, retain embedded `visits`, existing collection paths, legacy read fallbacks, and mirrored Place summary fields throughout this work. Any future schema migration must be a separate project with explicit compatibility and data-migration planning.

Each stage below should be independently reviewable and reversible. Avoid visual redesign, feature additions, dependency upgrades unrelated to the stage, and cleanup whose behavior is not covered by validation.

## Stage 0: Establish a behavior baseline

Document reproducible desktop and mobile workflows before moving code. Capture representative current Firestore fixtures in a safe test form, including a legacy Place, repeated Visits, a stay, daily Visits, a Trip, wishlist data, two participant modes, and administrative codes.

Validation criteria:

- Baseline covers sign-in gate, each tab, search/add/edit/delete, filters, repeated Visits, stays, ordering, marker modes, region layers, and responsive layout.
- Current desktop and mobile screenshots or equivalent visual references exist.
- No production data or credentials are copied into test fixtures.
- Runtime behavior and deployment remain unchanged.

## Stage 1: Add Vite as a thin shell

Introduce the minimum Vite project structure and scripts while initially preserving the existing application code and DOM structure. Move only what Vite requires to establish equivalent development and production entry points.

Validation criteria:

- Development and production builds load successfully.
- The production build works under the intended GitHub Pages base path.
- Firebase Auth redirects/popups and local `geo/` fetch paths still work.
- The baseline workflows and responsive layouts match the pre-Vite application.

Rollback: retain the last static deployment until the Vite output has parity.

## Stage 2: Extract configuration and vendor adapters

Move Firebase initialization, document-path helpers, Google Maps loading, and Turf access behind small modules without changing callers' behavior. Keep the same API versions and configuration values during this stage.

Suggested boundaries:

```text
src/config/
src/firebase/auth.js
src/firebase/firestore.js
src/maps/google-loader.js
src/maps/geo-service.js
```

Validation criteria:

- Authentication and all three Firestore subscriptions behave identically.
- Reads and writes use exactly the existing paths and fields.
- Maps, autocomplete, nearby search, reverse geocoding, and every boundary level work.
- No vendor upgrade or schema change is included.

## Stage 3: Extract and test pure domain logic

Move normalization and derived behavior into side-effect-free modules. Prioritize Place/Visit compatibility, filters, occurrence expansion, stay calculations, ordering, Trip day labels, and color/date calculations.

Suggested boundaries:

```text
src/domain/place.js
src/domain/visit.js
src/domain/trip.js
src/domain/occurrences.js
src/domain/filters.js
```

Validation criteria:

- Automated tests cover current and legacy Place records.
- Stay arrival, occupied nights, checkout morning, and date-filter boundaries are locked by tests.
- Repeated Visit filtering and order labels match the baseline.
- Legacy projection produces the same `visitedOn`, `tripId`, `categories`, `who`, and `whoMode` values.
- Extracted functions do not access DOM, Firebase, or mutable globals.

## Stage 4: Introduce an explicit application store

Create one state container for authenticated user, loaded data, navigation, filters, map presentation, and layout. Convert Firestore snapshots and UI events into named actions. Add derived selectors that call the tested domain modules.

Validation criteria:

- There is one documented owner for each former global variable.
- State transitions can be tested without a browser or network.
- Snapshot updates still produce the same list, marker, legend, and choropleth results.
- No persistence behavior or filter default changes.

Rollback: keep adapter functions matching the old global call signatures until all consumers move.

## Stage 5: Extract rendering modules incrementally

Move one UI surface at a time, retaining current markup and CSS classes. A practical order is modal helpers, filter controls, lists/cards, Trip editor/list, Place/Visit editor, settings, then shell/layout.

Suggested boundaries:

```text
src/ui/shell.js
src/ui/filters.js
src/ui/place-list.js
src/ui/place-editor.js
src/ui/trips.js
src/ui/settings.js
src/ui/modal.js
```

Validation criteria for each extracted surface:

- Its baseline workflows pass before extracting the next surface.
- Event handlers are attached once and cleaned up where applicable.
- Autosave timing and field serialization remain unchanged.
- Keyboard, touch, narrow-screen, and desktop interactions remain usable.
- Existing CSS appearance remains within agreed visual parity.

## Stage 6: Isolate map rendering

Extract marker construction, sequence markers, legends, viewport fitting, choropleth aggregation, Data-layer lifecycle, and administrative selection. Keep Google objects inside map-specific modules and expose narrow render/update commands.

Suggested boundaries:

```text
src/maps/map-controller.js
src/maps/markers.js
src/maps/choropleth.js
src/maps/legend.js
```

Validation criteria:

- All marker modes match their existing Place/Visit/Occurrence semantics.
- Trip and single-day sequence labels and click targets are unchanged.
- County, town, and village colors and selection behavior match the baseline.
- Filter changes update list, map, legend, and viewport consistently.
- Repeated layer changes do not leak listeners or display stale asynchronous results.

## Stage 7: Extract and organize styles

Move the existing CSS into scoped source files organized by tokens, shell/layout, controls, lists, editors/modals, maps, and responsive rules. This is an organizational stage, not a redesign.

Validation criteria:

- Desktop and mobile visual comparisons show parity.
- The 760px layout behavior and 700px modal transition remain intact.
- Map, filter, and list collapse combinations retain usable dimensions.
- No selectors required by JavaScript are renamed without coordinated tests.

## Stage 8: Remove the compatibility scaffold around the monolith

After every consumer uses modules, reduce `index.html` to the Vite mount point and required document metadata. Remove old duplicate code only when its replacement is covered by tests and baseline validation.

Validation criteria:

- No runtime application functions or state remain inline in `index.html`.
- Production build, automated tests, linting, and any type checks pass.
- Full desktop and mobile baseline passes against representative current and legacy data.
- Firestore writes remain field-for-field compatible.
- GitHub Pages deployment and direct navigation work.

## Work explicitly deferred

The following may be valuable but are not part of this migration: moving Visits to a subcollection, schema versioning, data backfills, multi-member redesign, transaction semantics, offline support, new features, visual redesign, geographic-data replacement, or changing Firebase security rules. Address these only after the module migration is stable and as separately scoped work.

The multi-member redesign was pursued separately and then abandoned in favour of the No-Space architecture ([NO_SPACE_CORE.md](NO_SPACE_CORE.md)); the old `spaces/{spaceId}` design docs are in [archive/](archive/). It was always outside the scope of this Vite and ES module migration.
