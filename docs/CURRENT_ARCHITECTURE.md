# Current Architecture

> **v0.3 release candidate:** production now defaults to the No-Space adapter over top-level Users, objective Places, first-class Visits, Contributions, personal Day Orders, and Trips. No production query parameter is required. The legacy architecture described below remains in code for LOCAL compatibility and rollback, but is not a normal production mode. See [NO_SPACE_CORE.md](NO_SPACE_CORE.md).

## Repository shape

The current application is a static client-only site built with Vite:

- `index.html` contains the document shell and CSS.
- `src/main.js` contains the imperative application state, rendering, Firebase access, and Google Maps integration.
- `src/space-membership.js`, `src/participants.js`, `src/spaces.js`, `src/ux-policies.js`, and `src/proximity-geometry.js` contain pure domain/policy helpers that can be tested without Firebase. `src/participants.js` resolves Visit/Place participants for arbitrary Space Members and owns the participant read precedence, mismatch detection, new-selection sanitisation, selection ordering, write serialization, deterministic UID→colour mapping, and legacy `whoMode` derivation. `src/spaces.js` (Phase 3) owns the deterministic Personal Space ID, discovered-Space normalisation and diagnostics, Personal Space provisioning decision, switcher ordering + labels, the scoped active-Space `localStorage` preference, the initial-Space choice policy, and the Space session token used to make stale async callbacks inert.
- `firestore.indexes.json` declares the `members` `(userId, status)` collection-group index for the eventual Phase 6 deployment; the Emulator serves the discovery query unindexed.
- `geo/county.json` contains 22 county features.
- `geo/town.json` contains 368 town features.
- `geo/village/` contains one file per county code, totaling 7,986 village features.
- Firebase ES modules and Google Maps are loaded from vendor CDNs. Turf 7 is loaded as a global from jsDelivr.
- `package.json` and `vite.config.js` define the build; dependency-free Node assertion files under `tests/` cover pure helpers. There is no router or component framework.

## Main runtime flow

1. An early non-module script installs global error and unhandled-rejection handlers.
2. The module script checks embedded Firebase and Google configuration.
3. `boot()` initializes Firebase Auth and Firestore and subscribes to authentication state.
4. Signed-out users see the Google sign-in gate.
5. `renderApp()` replaces `#app` with the complete application shell, initializes Google Maps, wires UI handlers, and starts No-Space subscriptions in production. LOCAL legacy modes retain their existing Space subscriptions.
6. In production, participant-scoped Visit and Trip queries drive exact Place, legacy-import, Contribution, Day Order, User-profile, and app-default document listeners. The adapter projects these into the existing map/filter/stay/geography render pipeline without writing projected data back to Place.
7. UI handlers mutate global state or write directly to Firestore. Snapshot updates eventually reconcile the rendered application with stored data.
8. In Phase 3 LOCAL multi-Space mode (`?firebaseEnv=local&multiSpace=1`) `renderApp()` does not subscribe immediately: it renders the header Space switcher, starts one collection-group Membership discovery listener, ensures/reuses the User's single Personal Space, chooses the initial active Space, and only then calls `subscribe()` via `switchActiveSpace()`. Every subsequent switch re-runs that teardown-then-resubscribe cycle. Without the flag the flow is exactly as before.

There is no component lifecycle. Rendering is imperative: template strings replace DOM subtrees and handlers are rebound after replacement. Current-Space Firestore unsubscribe functions are retained and cleared before resubscription or sign-out. In Phase 3 LOCAL mode `switchActiveSpace()` is the single controlled activation: it closes editors/modals/search, disables add-mode, unsubscribes all current-Space listeners, mints a fresh `spaceSession` token, clears every Space-scoped slice of state, resets data-bound filters (keeping visual prefs), then resubscribes.

## Application state

The module uses shared mutable globals in several groups:

- Infrastructure: `db`, `auth`, authenticated `user`, Google API classes, `map`, and `geocoder`.
- Space foundation: `currentSpaceId`, optional formal `currentSpace`, `currentMembership`, normalized `spaceMembers`, removed Members, Membership source, ownership validation, and current-Space listener teardown handles.
- Phase 3 (LOCAL multi-Space only): `spaceSession` (`{ spaceId, version }`, replaced per switch — captured by every current-Space subscription and every Space-bound async callback), `spaceSwitchInFlight`, and a `phase3` object holding the discovery listener handle + generation counter, the discovered/normalised Space list, the initial-selection/provisioning flags, and the resolved Personal Space ID. `*For(spaceId)` path helpers bind an explicit Space for every deferred/queued/async write; the bare `spaceDoc()`/`placeDoc()`/etc. wrappers resolve `currentSpaceId` for the live subscription and synchronous handlers only.
- Data: `places`, `trips`, `spaceCats`, `members`, `nicknames`, `catColors`, and `levelColors`.
- Map presentation: `markers`, `choroLevel`, `choroLayer`, `geoCache`, `showPins`, `choroAlpha`, `choroMetric`, `markerMode`, `numberPins`, and legend state.
- Navigation and filters: `tab`, `filter`, `dateScope`, `pickedMonth`, and administrative-region selection state.
- Interaction: add mode, Places session token, search timer, marker-click suppression, modal DOM, list ordering arrays, and responsive layout state.

Most domain and rendering functions read these globals directly, so dependencies are implicit rather than passed through interfaces.

## Firebase integration

The configured shared-space root is exposed in memory as `currentSpaceId`. It still comes directly from runtime configuration (`us` in production and `test-space-baseline` in LOCAL TEST); there is no production local preference, discovery query, or Space switcher. In LOCAL TEST only, `?firebaseEnv=local&testSpace=group` selects `test-space-group` from a fixed allowlist so N-person participant behavior can be exercised against the fixture group Space; it fails closed in production and never accepts an arbitrary Space ID. Narrow path helpers resolve:

- `spaces/{currentSpaceId}`
- `spaces/{currentSpaceId}/members/{uid}`
- `spaces/{currentSpaceId}/places/{placeId}`
- `spaces/{currentSpaceId}/trips/{tripId}`
- `spaces/{currentSpaceId}/meta/config`

The final existing content paths are therefore unchanged. Place and Trip collections are observed with `onSnapshot(query(..., orderBy("createdAt", "desc")))`. The meta document is observed directly. The meta document stores categories, members, nicknames, category colors, and visit-depth colors.

Phase 1 also observes the optional root Space document and its Membership collection. Formal Memberships are normalized to a common Member shape, separated into active and removed Members, matched to the authenticated User, and checked against the root `ownerId`. These reads never create or repair documents. If the formal root and Memberships are absent—or optional formal reads fail in production—the client derives temporary in-memory Members from `meta/config.members` and nicknames.

Phase 3 (LOCAL `?firebaseEnv=local&multiSpace=1` only — production and fixed-Space LOCAL modes are unchanged and expose none of it) adds Membership-based Space discovery, Personal Space provisioning, an active-Space `localStorage` preference (`mapair.activeSpace.v1:<projectId>:<uid>`), a header Space switcher, empty Shared Space creation, and a controlled switch lifecycle with stale-session/cross-Space-write protection. Discovery is one `collectionGroup("members").where("userId","==",uid).where("status","==","active")` listener; each result's root Space is fetched and normalised, malformed Memberships / missing roots are excluded and only diagnosed. Personal Space provisioning and Shared Space creation are single Firestore transactions that create a root plus one active owner Membership, never overwrite a Shared Space or foreign-owner document, and never `merge`. A Personal Space is a normal Space, not a cross-Space aggregate. The separately gated No-Space Phase A runtime now uses “我的足跡” for participant-scoped top-level Visits; it is not part of the Phase 3 switcher. Phase 3 access remains Membership only — never Friendship, participants, or `createdBy`. Trip participant defaults (Phase 4), invitations/friends (Phase 5), and production rules/exposure (Phase 6) are not part of this legacy phase.

LOCAL TEST logs a compact Membership-source/member-count/current-role/ownership summary to the console. The summary is not emitted in production. Invalid formal ownership and removed-current-Membership states produce warnings only; they do not repair data or enforce access.

Phase 2 generalized the participant and naming UI to arbitrary Space Members. Participant filters, the Visit participant picker, marker/legend "who" colouring, and card/list labels resolve Members through the Membership foundation and `src/participants.js`. `visit.participantIds` is the authoritative participant field, `visit.who` and Place `who`/`whoMode` remain compatibility mirrors, and a `who`/`participantIds` conflict is surfaced (editor notice, LOCAL TEST `console.warn`) rather than silently reconciled. A historical (removed / unknown) participant already on a record is preserved through unrelated edits and can only be removed one-way — never re-added — and a known removed Member (`（已離開）`) is shown distinctly from an unknown historical UID (`未知成員`); raw UIDs are never displayed. New-data participant seeds are intersected with active valid Memberships, and the authenticated-User default is fail-closed. Marker colours are a deterministic UID hash, stable regardless of Member count or order. `reconcileSpaceMembershipFoundation()` refreshes the participant-dependent UI (filter, list, markers, legend) whenever the resolved directory changes, so a late-arriving Membership snapshot still updates those surfaces; a signature guard prevents render loops and no extra listeners or writes are created. Membership-based authorization is still not implemented in application code and remains a later security-rules migration; diagnostics must not be mistaken for security enforcement.

The Wishlist ("想去") feature has been removed. The legacy product model is Space → Place → Visits[]: a Place exists only because it has real Visit history, gated centrally by `hasVisitHistory(place)` (modern `visits` plus legacy `visitedOn` compat). The "想去" tab, the editor's 去過了/想去 status toggle, the 想去設定 section, and the Wishlist participant/category pickers are gone; the "是否去過 / status" marker colour mode is removed from Settings and the legend. Creating a Place always creates its first Visit (Phase 2 defaults). Deleting a Place's last Visit deletes the whole Place document (`deleteVisitOccurrence` and the editor's Visit-row ✕ / `deletePlaceAndClose`); the code never writes an empty active Place and never sets `status:"wishlist"`. Legacy `status:"wishlist"` documents may still exist in Firestore but are dormant and invisible everywhere; `findExistingPlace()` can still reuse one when a member explicitly searches for that Place and records a Visit. No production data migration is performed. A future "Saved Places / Favorites" concept is not implemented and is distinct from the removed Wishlist; the separately gated No-Space “我的足跡” view is distinct from the Personal Space.

Phase 3 Revised 2 hardened Space discovery: per-snapshot monotonic request versions so async snapshots cannot apply out of order; Space-root read *failures* fail the whole discovery cycle closed instead of being read as "root missing"; exact `spaces/{spaceId}/members/{uid}` path validation for collection-group results (`resolveSpaceMembershipPath`); session/generation guards on every current-Space and discovery listener error callback; Space-session invalidation before listener teardown on auth change; Google-autocomplete session capture before the request starts; and `placeEditorWriteQueues` left intact on a switch (each entry self-removes via `.finally`).

Authentication uses Firebase Google popup sign-in. Authorization is not enforced in application code; it depends on deployed Firestore rules. The setup text shows an example allowlist for two authenticated UIDs, but the deployed rules are outside this repository.

Editors autosave through `addDoc`, `updateDoc`, or `setDoc`. Deletion occurs directly through `deleteDoc`. Administrative point-in-polygon results are also written back to Place documents as cached codes.

## Google Maps and geographic data

The application installs the Google Maps bootstrap and imports the maps, marker, places, and geocoding libraries. The map uses an Advanced Marker-compatible Map ID, disables several default controls, and uses greedy gesture handling.

Places autocomplete uses `AutocompleteSuggestion`, a session token, `toPlace()`, and `fetchFields()`. Map-click addition uses nearby search before offering a custom coordinate. Reverse geocoding stores country/county/city display metadata.

Markers are rebuilt completely on render. Normal markers use `PinElement`; sequence mode uses HTML markers labeled by daily position or Trip day/stop. Marker coloring has Place-, Visit-, and occurrence-level paths because some metrics are shared while others belong to a specific Visit.

Administrative rendering loads GeoJSON through `fetch()` and caches it in memory. Turf `booleanPointInPolygon` assigns missing county, town, or village codes. A `google.maps.Data` layer renders boundaries. Region color is derived from filtered visited Places by maximum depth, Place count, earliest occurrence, or latest occurrence.

Village mode first ensures county codes, then sequentially loads all county village files and concatenates their features. Some village features contain null geometry; point-in-polygon errors are caught and ignored.

## Filtering and render flow

The filter contains participant, Trip, category set, from/to dates, and selected regions. Date presets populate the date fields. A specific Trip or a single-day range also establishes a sequence context.

`placeStaticFilter()` applies administrative regions. `visitPassFilter()` combines static, participant, Trip, category, and date intersection tests. `passFilter()` first requires `hasVisitHistory(p)` (a non-empty `visits` array or a legacy `visitedOn`), then makes a Place pass when it has no active Visit constraint or when any Visit matches. Places with no Visit history — including dormant legacy `status:"wishlist"` documents — never pass and are invisible everywhere.

`applyFilter()` is the central render cascade:

1. Render the current list.
2. Rebuild markers.
3. Recompute an active choropleth.
4. Rebuild filter chips and result counts.
5. Schedule map viewport fitting.

Firestore listeners invoke overlapping subsets of the same cascade. Rendering one concern can also update another; for example, list rendering updates filter chips, and marker rendering updates the unified legend.

## Important dependency relationships

- `placeVisits()` normalizes current and legacy records and feeds filtering, lists, Trip counts, marker colors, date calculations, ordering, and legacy summaries.
- `getDayOccurrences()` expands Visits and stays into sequence occurrences. Together with `sortOccurrences()`, it feeds daily lists, Trip sequences, numbered markers, date colors, and reordering.
- `passFilter()` (gated by `hasVisitHistory()`) feeds markers, the visited list, viewport fitting, and choropleth aggregation.
- `sequenceContext()`, `sequenceOccurrences()`, and `sequenceLabels()` connect date/Trip filters to lists and markers.
- `visitLegacyFields()` mirrors the latest Visit back to compatibility fields whenever Visit order or history changes.
- `ensureCounty()`, `ensureTown()`, and `ensureVillage()` connect local geometry, Turf classification, Place mutation, and Firestore writes.

## Known fragility and regression risks

- Category rename and deletion update Place-level `categories` but not embedded `visits[].category`.
- Trip deletion does not clear Visit references to the deleted Trip.
- Whole `visits` arrays are rewritten, so concurrent editors can overwrite one another.
- Autosave writes are not serialized; older asynchronous writes may complete after newer edits.
- Bulk category updates are not awaited or batched.
- Current-Space listener teardown, plus Phase 3 Space discovery, switch-time state clearing, session tokens, and the switcher UI, exist only behind the LOCAL `multiSpace=1` flag; production still runs a single fixed Space with no switching.
- `orderBy("createdAt")` can exclude legacy documents without that field.
- Choropleth requests can overlap and finish out of order.
- Village rendering loads and processes all county files and performs linear point-in-polygon scans.
- Active tabs (only `visited` and `trips` remain) constrain lists and viewport fitting differently from marker rendering.
- Stay checkout is generally exclusive, but date-range intersection uses a boundary comparison that can include checkout day at the range start.
- Cached administrative codes are not invalidated if Place coordinates change.
- Category, visitor, latest-Visit, stay expansion, sorting, and marker-color logic have parallel implementations that can drift.
- Deletions generally have no confirmation or referential cleanup.
- API security depends on external Google key restrictions and deployed Firestore rules.
- Several globals/helpers appear unused, including `MapCtor`, `tripLine`, `NAMEKEY`, `placeDates`, `tripDayNo`, and `dayVisitItems`; removal still requires behavioral verification.
