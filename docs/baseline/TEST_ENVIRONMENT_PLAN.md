# Stage 0B Test Environment Plan

## Status and scope

This document proposes a safe testing strategy for Mapair before application-code migration begins. It is a plan for later work, not a description of facilities that already exist. The repository currently has no configured Firebase Emulator Suite, fixture loader, automated test suite, or explicit development/runtime environment selector. This stage does not change application behavior, Firebase configuration, or production data.

## 1. Safety objective

Development and testing must never write to production Firestore or depend on production user data. Production records, identities, credentials, and content must not be copied into fixtures, screenshots, test logs, or local exports.

The safe default for future development and automated testing should be an isolated, disposable environment populated only with invented or anonymized data. Any workflow that creates, updates, reorders, or deletes Places, embedded Visits, Trips, or shared metadata must first prove that its target is an emulator or an explicitly approved non-production project. If that proof is absent or ambiguous, the operation should fail closed.

## 2. Recommended environment layers

The following layers are recommendations for future Stage 0B work; they are not currently configured.

### Production

Production contains the current real Mapair data. It should be used only for normal authorized product use and carefully scoped, non-destructive production verification. It must never be used for destructive testing, fixture loading, reset scripts, automated tests, or migration experiments. Tests must not require production documents to exist or use production content as expected results.

### Local Firebase Emulator Suite

The Local Firebase Emulator Suite should become the primary environment for application development, fixture-driven manual testing, and automated tests. Its disposable local data makes create/update/delete, Visit-array rewrites, Trip deletion, legacy normalization, and reset workflows testable without risking production.

Local emulator use should be deterministic and easy to reset. It should be the default target for all future automated tests and for any destructive manual workflow.

### Optional separate Firebase test/staging project

A separately owned Firebase test or staging project may be useful later for cross-device, real-mobile, hosted integration, and authentication flows that cannot be represented adequately on one developer machine. It must use distinct configuration, access controls, accounts, and invented data, with no shared production collections or copied production users.

This layer is optional and should be created only through a separately approved task. It must not replace the local emulator as the automated-test default, and it must have an explicit reset and retention policy before destructive testing is permitted.

## 3. Firebase Emulator scope

The Emulator Suite is not configured today. Later work could use:

- **Firestore Emulator** to exercise the existing `spaces/{spaceId}/places`, `trips`, and `meta/config` paths; snapshot/query behavior; embedded Visit-array writes; compatibility-field mirroring; ordering; and safe create/update/delete flows.
- **Auth Emulator** to provide invented signed-in identities and test signed-in/signed-out application states without authenticating as production members. At least two fake identities should support current participant-mode behavior.

Emulator behavior is useful but is not proof that deployed security rules, indexes, browser authentication, or production hosting behave identically. Those boundaries need separate, explicitly authorized validation.

Google Maps Platform services are independent external services and are not emulated by the Firebase Emulator Suite. Map rendering, Places autocomplete/nearby search, geocoding, Map IDs, API-key restrictions, vendor localization, quotas, and network failures require controlled integration or manual testing. Firebase emulator isolation alone does not make calls to Google Maps or Places fake or free of external effects.

## 4. Environment-selection safety

A future architecture should make the selected environment explicit, visible, and difficult to confuse. The exact implementation belongs to a later application/configuration task. Desired safeguards are:

- Production must never be the default for automated tests. Test startup should fail if an emulator or explicitly approved test target cannot be verified.
- Local development should display a persistent, unmistakable `TEST` or `LOCAL` indicator in the application so screenshots and manual sessions cannot be mistaken for production.
- Production and development configuration should be separately named and deliberately selected; ambiguous, missing, or mixed configuration should stop startup rather than fall back to production.
- Test fixtures must contain only fake or anonymized names, coordinates, reviews, identifiers, participant UIDs, and Place IDs. They must not be derived from production exports.
- Destructive actions—including deletion, bulk updates, fixture import/reset, and scripts that rewrite complete `visits` arrays—must run only after asserting an emulator or approved test/staging environment.
- Reset/load tooling should reject production project identifiers and production hosts. A destructive command should require a positive environment check, not merely the absence of a production flag.
- Environment identity should be observable in logs and test reports without exposing secrets.

These are design requirements for later work. This plan does not prescribe a particular module layout, environment-variable scheme, build tool, port, command, or UI implementation, and it does not change the current embedded configuration.

## 5. Representative fixture design

Future fixtures should model the current schema and compatibility behavior with entirely invented content. Stable document IDs, Visit IDs, participant IDs, dates, coordinates, and timestamps should make assertions readable and reproducible. A compact dataset can combine compatible cases, but each purpose below must remain independently identifiable.

| Fixture | Proposed shape | Purpose |
| --- | --- | --- |
| Two participant identities | Fake users such as `test-user-a` and `test-user-b` in invented shared metadata, with fake display names/nicknames | Exercises `me`, `partner`, and `both` derivation without production Auth users or personal data. |
| Legacy `visitedOn`-only Place | Visited Place with `visitedOn` and legacy Place-level `tripId`, `categories`, `who`/`whoMode`, but no usable `visits` array | Verifies normalization to one legacy Visit and preservation of Place-level read fallbacks. |
| Normal visited Place | One Place containing one ordinary, dated Visit with a stable Visit ID | Establishes the simplest current-schema visited case and basic list/filter/map behavior. |
| Repeated Visits on one Place | One Place with at least two dated Visits | Proves that a shared Place can produce multiple historical occurrences without duplicating Place identity. |
| Visits with different category/purpose | Two Visits on the repeated-Visit Place with distinct categories | Verifies Visit-level category display, filtering, latest-Visit compatibility projection, and category independence. |
| Visits with different participants | Two Visits on one Place, one containing `test-user-a` and another containing `test-user-b` or both | Verifies Visit-level participant authority and participant filters across repeated Visits. |
| Shared Place rating/review/depth | The repeated-Visit Place has one invented rating, review, and depth value | Confirms these values remain Place-level and appear consistently regardless of which Visit opens the Place. |
| Multi-day stay Visit | A `kind: stay` Visit with an arrival date and a later checkout date | Exercises occupied-night and morning anchors, exclusive checkout semantics, night counts, filtering boundaries, and fixed ordering anchors. |
| Same-day ordinary Visit ordering | At least three ordinary Visits on the same date, across multiple Places, with explicit and optionally missing/string-compatible order values | Locks down deterministic ordering, fallback behavior, renumbering, and separation from stay anchors. |
| Multi-day Trip | Invented Trip with a stable ID, start/end dates, color, and Visits on more than one day | Exercises Trip membership, counts, day headings, `D{day}-{position}` labels, and Trip-scoped ordering. |
| Wishlist Place | Place with `status: wishlist`, no Visits, and invented Place-level category/participant compatibility fields | Exercises wishlist rendering, filtering semantics, ordering, and conversion boundaries independently of visited history. |
| Daily/no-Trip Visit | Ordinary Visit whose `tripId` is empty | Verifies Daily filtering and distinguishes daily life from Trip membership. |
| Administrative-code Place | Invented Place with plausible `countyCode`, `townCode`, and `villCode` values plus non-sensitive coordinates | Exercises cached administrative selection/filtering without requiring production-derived Places. Codes should be chosen later against the repository's existing geographic assets, without modifying those assets. |
| Dangling Trip reference | Visit whose invented `tripId` does not match any fixture Trip | Preserves and investigates current compatibility behavior after Trip deletion, including filtering and UI presentation of an unresolved reference. |
| Place without `createdAt` | Legacy-style document that intentionally omits `createdAt` | Investigates the known `orderBy("createdAt")` query exclusion and fallback-order behavior. Because an ordered subscription may not return it, tests should distinguish direct document/fixture inspection from query-visible results. |

Fixture authors should also retain the current legacy mirrored Place fields where the scenario calls for them. Tests must distinguish canonical Visit-level category, Trip, and participants from shared Place-level rating, review, depth, identity, coordinates, and legacy summary/fallback fields.

No fixture files are created by this plan. Exact example values and serialization format should be reviewed before fixture implementation.

## 6. Test-data reset strategy

Fixtures should be deterministic and resettable so every test begins from the same known state. Stable IDs and fixed dates prevent test results from depending on execution time, generated ordering, or leftovers from an earlier run.

A future reset process should target only a verified emulator or approved test/staging namespace, clear its test-owned data, load the complete fixture set, and verify expected document counts and key IDs before tests continue. Tests that mutate data should reset before each isolated case or test group, according to cost, and must not rely on execution order. Failed or interrupted tests should be recoverable by running the same reset again.

Emulator export/import snapshots may later improve startup speed, but the canonical fixture source should remain reviewable, deterministic, and reproducible. Any test/staging reset policy must also prevent collision with other testers, for example through explicitly test-owned spaces or isolated runs; the exact mechanism is later work.

## 7. What can and cannot be tested locally

### Deterministic domain and data behavior

With pure logic extracted later, local automated tests can cover Place/Visit normalization, legacy fallbacks and mirrored fields, repeated Visits, filters, stay expansion, date intersections, occurrence ordering, Trip day labels/counts, participant modes, and handling of dangling references. These tests should need neither Firebase nor browser globals.

Some current behavior is still embedded in `index.html`, so this capability is a future goal rather than an existing test surface.

### Firestore and Auth emulator behavior

Once configured, emulator-backed tests can cover current collection paths, ordered queries and missing-`createdAt` behavior, snapshot updates, document and embedded-array writes, reset/load behavior, signed-in/signed-out state, and invented multi-user identities. Emulator tests can also safely exercise destructive workflows and whole-array rewrites.

They cannot by themselves validate production data, deployed-project configuration, production indexes/rules, or real Google sign-in. Any difference that matters must be tested separately and without destructive production actions.

### Google Maps and Places integration

Firebase emulators do not cover map rendering, autocomplete, nearby search, reverse geocoding, browser permissions, external network errors, quotas, API-key restrictions, localization, or vendor response changes. These require controlled manual or integration testing with approved non-production configuration. Deterministic domain tests should use invented adapter outputs rather than live service results where possible in later architecture work.

### Responsive and visual behavior

Desktop/mobile layout, the current responsive breakpoints, touch and keyboard interaction, modal bottom-sheet behavior, marker overlap/click targets, map viewport motion, legends, choropleth appearance, and collapse combinations require browser/manual validation today. Future end-to-end and visual-regression tests can automate part of this work, but real-device checks remain valuable for mobile behavior and vendor-rendered maps.

## 8. Proposed Stage 0B implementation sequence

Each step should be separately reviewable and must preserve current application behavior unless its task explicitly authorizes a scoped development-only change.

A. **Approve this plan.** Confirm the environment boundaries, fixture coverage, and prohibition on production-derived data.

B. **Create anonymized fixture files.** Define stable fake IDs, dates, coordinates, documents, expected outcomes, and a reviewable fixture format. Do not connect them to production.

C. **Install and configure the Firebase CLI and Emulator Suite.** In a separately approved task, add only the required local tooling and document startup behavior. Confirm that no Firebase emulator configuration exists before treating this step as complete.

D. **Add an explicit development-only emulator connection.** In a later application-code task, make Firestore/Auth emulator selection fail closed and visibly identify local/test mode. Preserve production behavior and configuration boundaries.

E. **Load and reset fixtures.** Add guarded, idempotent tooling that verifies its non-production target, resets only test-owned data, loads fixtures, and checks the resulting baseline.

F. **Run destructive manual tests safely.** Execute add/edit/reorder/delete, last-Visit conversion, Trip deletion/dangling references, and legacy save flows only against the verified emulator or approved test environment; record desktop and mobile results.

G. **Add automated tests later.** Start with deterministic domain tests, then emulator-backed Firestore/Auth tests, followed by narrowly scoped browser/E2E and visual checks. Keep live Google Maps/Places testing isolated from deterministic suites.

Production access, production data migration, Firebase project creation, deployment, and application migration are outside this plan.
