# Current Architecture

Mapair is a static, client-only site built with Vite. The running client uses the
**No-Space** architecture: top-level `users`, objective `places`, first-class
`visits`, per-Visit `contributions`, personal `dayOrders`, and `trips`. There is
no Space, no Space switcher, and no architecture query parameter. The domain
model, Firestore paths, and data contract are specified in
[NO_SPACE_CORE.md](NO_SPACE_CORE.md); this document describes how the client is
assembled and how it runs.

The abandoned `spaces/{spaceId}` multi-user design is archived under
[archive/](archive/).

## Repository shape

- `index.html` — the document shell, a `<link>` to `src/styles/app.css`, and an
  early non-module script that installs global `error` / `unhandledrejection`
  handlers (`window.__fatal`).
- `src/styles/app.css` — all of the app's CSS (one file; Vite hashes and links
  it in the build).
- `src/main.js` — the imperative application core: shared mutable state, the
  render/data plumbing, Firebase access, Google Maps integration, and top-level
  UI wiring. There is no router or component framework; rendering replaces DOM
  subtrees with template strings and rebinds handlers.
- `src/ui/` — the extracted UI surfaces: `modal.js`, `html.js` (`esc`), and the
  `trip-editor` / `settings` / `friends` / `visit-editor` panels. Each takes an
  injected context + callbacks from `main.js` and owns its own markup + wiring.
- `src/domain/` — pure, tested helpers pulled out of `main.js`: `occurrences`,
  `filter`, `marker-color`, `visit-defaults`.
- `src/config.js` — `resolveRuntimeConfig()`: environment safety check and the
  embedded Firebase / Google configuration.
- `src/no-space/` — Firebase-free domain logic plus the Firestore repository:
  `schema.js`, `policies.js`, `contributions.js`, `day-order.js`, `trips.js`,
  `places.js`, `visits.js` (projection), and `repository.js` (all path
  construction and every read/write).
- `src/participants.js`, `src/ux-policies.js`, `src/proximity-geometry.js`,
  `src/visit-area-metrics.js`, `src/map-color-scales.js` — pure, testable
  domain/policy helpers. `src/participants.js` owns participant read precedence,
  `who`/`participantIds` mismatch detection, new-selection sanitisation,
  selection ordering, write serialization, deterministic UID→colour mapping, and
  legacy `whoMode` derivation (compatibility only; the No-Space runtime does not
  call the `whoMode` / mismatch helpers, but the migration tooling and legacy
  read paths rely on them).
- `geo/county.json` (22), `geo/town.json` (368), `geo/village/<countyCode>.json`
  (7,986 village features total).
- Vendor code loads from CDNs: Firebase ES modules from `gstatic.com`, the Google
  Maps bootstrap from `maps.googleapis.com`, and Turf 7 as a global from
  jsDelivr.
- `package.json` / `vite.config.js` define the build (`vite build`, plus a plugin
  that copies `geo/` into `dist/`). `tests/` holds dependency-free Node assertion
  files; `tests/run.mjs` discovers and runs them.

## Environments

`resolveRuntimeConfig()` inspects `location.hostname` and `?firebaseEnv`:

- **Production** — any non-localhost host, no query parameter. Uses the embedded
  production Firebase project (`mapping-505208`).
- **LOCAL TEST** — `localhost` / `127.0.0.1` **and** exactly `?firebaseEnv=local`.
  Uses the `demo-mapair-local` demo project and connects the Auth and Firestore
  emulators. Any other combination (localhost without the parameter, the
  parameter off localhost, a duplicated or unexpected value) throws and stops
  startup.

LOCAL TEST is **fail-closed**: `failLocal()` / `handleFirestoreError()` /
`showRuntimeFatal()` surface any emulator or Firestore failure as a fatal panel
and never fall back to production. `createLocalTestCustomToken()` mints
`alg:"none"` tokens for two fixed test identities and refuses to run unless the
project is `demo-mapair-local`.

## Runtime flow

1. The early inline script installs error handlers.
2. The module script calls `resolveRuntimeConfig()`. Missing Firebase/Google
   configuration renders the setup notice; otherwise `boot()` runs.
3. `boot()` initializes Firebase, optionally connects the emulators (LOCAL),
   and subscribes to `onAuthStateChanged`.
4. Each auth change resets all runtime state, tears down listeners, closes
   modals/search/add-mode, and renders either the Google sign-in gate
   (signed out) or `renderApp()` (signed in).
5. `renderApp()` replaces `#app` with the full shell, initializes Google Maps,
   wires UI handlers, and calls `subscribeNoSpace()`.
6. UI handlers either mutate module globals and re-render, or call the No-Space
   repository directly. Firestore snapshots reconcile the rendered UI back to
   stored data.

## No-Space subscriptions and projection

`subscribeNoSpace()` builds a repository (`createNoSpaceRepository`) and attaches
four primary listeners:

- `visits` where `participantUserIds array-contains <uid>`
- `trips` where `participantUserIds array-contains <uid>`
- `users/<uid>/dayOrders`
- `appConfig/defaults`

From the loaded Visits and Trips, `syncNoSpaceReferenceListeners()` maintains one
document listener per referenced `places/<placeId>`, its
`places/<placeId>/legacyImports/space-us`, each `visits/<visitId>/contributions`
collection, and each participant `users/<uid>` profile. Reference listeners are
added and removed as the referenced ID set changes.

`refreshNoSpaceProjection()` runs `projectNoSpaceRuntime()` to fold these
top-level documents into the `places` / `trips` shape the existing map, filter,
list, stay-anchor, and administrative-region code already consumes. Repeated
Visits to one Place become one marker but stay separate occurrences. Writes never
round-trip through the projection: the editor and the reorder controls call the
repository directly, and snapshots then update the projection.

### Session and identity guards

`runtimeSession` is a fresh object per auth change; `user.uid` is captured
alongside it. Every listener callback, editor, Google search, geography callback,
and deferred write checks `runtimeSessionIsCurrent(session, uid)` (and, in LOCAL,
the `localFailure` latch) before applying a result, so a stale callback from a
previous session is inert. `searchReqSeq` similarly invalidates in-flight
autocomplete requests.

## Application state

`src/main.js` uses shared mutable module globals, read directly by most
functions (dependencies are implicit rather than passed):

- Infrastructure: `db`, `auth`, `user`, Google API classes, `map`, `geocoder`.
- No-Space cache: `noSpaceRepository`, `noSpaceState` (raw `visits`, `places`,
  `trips`, `contributions`, `dayOrders`, `profiles`, `legacyImports`, `defaults`,
  and the reference-listener unsubscribe maps).
- Projected data: `places`, `trips`, `spaceCats`, `participantMembers`,
  `members`, `catColors`, `levelColors`, `referencedHistoricalIds`.
- Map presentation: `markers`, `adminLayer` / `adminContextLayer`,
  `proximityLayer`, `geoCache`, `showPins`, `choroAlpha`, `choroMetric`,
  `markerMode`, `numberPins`, legend state, and render-version counters.
- Navigation and filters: `tab`, `filter`, `dateScope`, `pickedMonth`,
  administrative-region selection, `regionMulti`.
- Interaction: `addMode`, Places `sessionToken`, `searchTimer`,
  `lastMarkerClick`, modal DOM, layout state.

## Firebase integration

All paths are built in `src/no-space/repository.js` (`noSpacePaths`). No read or
write touches `spaces/…`. Visit and Trip mutations run in transactions that
re-read the persisted parent and authorize against it (never against editor
draft fields), preserve the stored `createdBy`, and reject a `deleting` Visit.
These are application-correctness checks and do **not** replace deployed
Firestore Security Rules — `firestore.no-space.rules` is a candidate that is
deliberately isolated from `firebase.json`.

Administrative point-in-polygon results are written back to `places/<id>` as
cached region codes (`updatePlaceCache`) — the only routine Place mutation.

## Google Maps and geographic data

`initMap()` runs the Google bootstrap and imports the `maps`, `marker`,
`places`, and `geocoding` libraries. The map uses an Advanced-Marker-compatible
Map ID and greedy gesture handling. Normal markers use `PinElement`; Trip /
single-day sequence mode uses HTML markers labelled by daily position or
`D{day}-{stop}`. Marker colour has Place-, Visit-, and occurrence-level paths.

Autocomplete uses `AutocompleteSuggestion` with a session token, `toPlace()`,
and `fetchFields()`. Clicking the map in add-mode runs a nearby search before
offering a custom coordinate. Reverse geocoding stores country/county/city
display metadata.

Administrative rendering fetches GeoJSON, caches it in memory, and uses Turf
`booleanPointInPolygon` to assign missing county/town/village codes. Village mode
first ensures county codes, then loads every county village file and concatenates
the features (a linear scan). A `google.maps.Data` layer renders boundaries;
proximity coverage is a second `Data` layer. Both use monotonic render-version
counters so overlapping async renders discard stale results.

## Filtering and render flow

`filter` holds participant (`who`), `tripId`, category set, `from`/`to` dates,
and selected regions. `placeStaticFilter()` applies regions; `visitPassFilter()`
combines static, participant, Trip, category, and date-intersection tests;
`passFilter()` first requires `hasVisitHistory(place)` (a non-empty `visits`
array, or a legacy `visitedOn`), then passes a Place when it has no active Visit
constraint or any Visit matches. Places with no Visit history — including dormant
legacy `status:"wishlist"` documents — are invisible everywhere.

`applyFilter()` is the central cascade: render the list → rebuild markers →
recompute active map surfaces → rebuild filter chips and counts → schedule
viewport fitting. Firestore listeners invoke overlapping subsets of it, and one
concern can trigger another (list rendering updates chips; marker rendering
updates the legend).

## Known fragility and regression risks

- Deleting a Trip leaves a dangling `visit.tripId`; it renders as “已刪除旅程”
  rather than being cleaned up.
- Day-order writes (`setDayOrder`) are plain `setDoc` calls with an optimistic
  local update; they are not transactional and are not serialized against
  concurrent reorders.
- Map-surface async renders can overlap; monotonic render-version counters
  mitigate but do not eliminate stale-result flashes.
- Village rendering loads and linearly scans all county files (7,986 features).
- Stay checkout is generally exclusive, but a date-range intersection at the
  range start can include the checkout day.
- Cached administrative codes are written only when absent and are not
  invalidated if a Place's coordinates later change.
- Occurrence sorting, latest-Visit selection, stay expansion, and marker-colour
  logic have parallel inline implementations that can drift.
- Deletions generally have no confirmation dialog, and only Trip/Visit deletion
  is referentially considered.
- Security depends entirely on external Google key restrictions and the deployed
  (out-of-repo) Firestore rules; both API keys are committed in `src/config.js`.
- `src/main.js` is a single ~2,500-line module of implicit-dependency globals;
  decomposition is planned but not started.
