# Mapair test fixtures

A fixture is a small, fixed set of input data used to put a test environment into a known state. `mapair-baseline.json` and `mapair-multi-user.json` are completely invented Mapair datasets for the local Firestore Emulator. They contain no production export, real user identity, credential, Firebase configuration, or production-derived user content.

Never seed these fixtures into production. The seed script is hard-coded to the Firestore Emulator at `http://127.0.0.1:8080` and the demo project `demo-mapair-local`; it has no production fallback. These files seed Firestore documents only. They do not create Firebase Authentication users, and Auth Emulator login buttons for Users C and D are outside Phase 0.

## Commands

The no-argument command preserves the original two-user baseline behavior:

```sh
node scripts/seed-emulator.mjs
```

The explicit equivalent is:

```sh
node scripts/seed-emulator.mjs --fixture baseline
```

Load the baseline first and then apply the additive multi-user overlay with:

```sh
node scripts/seed-emulator.mjs --fixture multi-user
```

Clear the Emulator without loading fixtures with:

```sh
node scripts/seed-emulator.mjs --reset-only
```

Validate both JSON fixtures without running Firebase or the Emulator with:

```sh
node scripts/validate-fixtures.mjs
```

## File shape and serialization

The baseline JSON envelope keeps the current Firestore areas separate:

- `spaceId` is the invented target space ID, `test-space-baseline`.
- `meta.config` is the document body for `spaces/{spaceId}/meta/config`.
- Each `trips[]` and `places[]` entry has an `id` for the future document path and a `data` object for the document body. The `id` is not meant to be stored as a Firestore field; the current app adds document IDs only after reading snapshots.
- `fixtureVersion` versions the fixture file itself and is not a Firestore field.

The multi-user fixture is an additive document overlay:

- `fixtureName` is `multi-user`.
- `extends` is `mapair-baseline`, requiring the seed script to load the unchanged baseline first.
- Each `documents[]` entry contains a validated Firestore document `path` and its `data` body.
- Paths are deterministic, must identify documents, may not contain empty/traversal/URL-like segments, and must be unique across the combined fixture universe.

JSON cannot contain native Firestore `Timestamp` values. Every fixture timestamp is encoded as:

```json
{
  "__type": "firestore-timestamp",
  "iso": "2024-01-03T00:00:00.000Z"
}
```

The loader validates the ISO value and converts the complete tagged object to a native Firestore `Timestamp` before writing. It does not store the tagged object or ISO string as the document's `createdAt`. All dates and timestamps are fixed deterministic values; none are calculated relative to the current day.

Document IDs, Visit IDs, participant UIDs, dates, ordering values, coordinates, colors, and timestamp strings are stable. All names and content are synthetic. In the baseline, each coordinate has been validated with point-in-polygon checks against the repository's county, town, and village GeoJSON, and its cached administrative codes identify the containing polygons. The seven baseline Places cover distinct villages and districts across Taipei, Taichung, Kaohsiung, Changhua, and Yilan.

## Baseline record purposes

- `test-user-a` and `test-user-b`: the two fake participant identities in `meta.config.members`, with synthetic nicknames.
- `trip-test-multiday`: a three-day Trip spanning 2024-04-10 through 2024-04-12.
- `place-test-station`: repeated ordinary Visits with different Visit categories and participant combinations; its Daily Visit has no Trip. Its rating, review, and depth are shared Place fields.
- `place-test-park`: Trip Visits on two days, including the first ordinary Visit on 2024-04-10 and the second ordinary Visit on 2024-04-11.
- `place-test-cafe`: the simplest single ordinary Visit and the third ordinary Visit on 2024-04-11.
- `place-test-hotel`: a two-night stay with inclusive arrival 2024-04-10 and exclusive checkout 2024-04-12.
- `place-test-wishlist`: a Wishlist Place with no Visits and Place-level compatibility category/participants.
- `place-test-legacy-no-created-at`: a `visitedOn`-only legacy Place with an empty `visits` array, current Place-level fallback fields, and intentionally no `createdAt`.
- `place-test-dangling-trip`: an ordinary Visit whose `tripId` is deliberately `trip-test-missing`; that ID must not be added to `trips`.

Several records intentionally cover more than one baseline case to keep the fixture compact. The mirrored Place fields on current visited Places match their latest Visit. The baseline file remains the regression source for legacy `who`, `whoMode`, `meta/config.members`, nicknames, Place-level fallbacks, repeated Visits, stay semantics, ordering, and the missing-`createdAt` case.

## Multi-user overlay purpose

`mapair-multi-user.json` surrounds `test-space-baseline` with root Space metadata and A/B Memberships without copying or changing its `meta/config`, Trip, Place, or Visit payload. This local Space is the fixture analog of the future in-place `spaces/us` migration shape: existing history stays at its current paths while formal Space and Membership documents are added around it.

The overlay also adds empty Personal Spaces for A, B, and C; a Shared Space with active A/B/C and removed D; N-person Trip defaults; five Visit participant compatibility cases; accepted, pending, and blocked Friendships; and pending direct, pending share-link, expired, revoked, and accepted invitations. Invitation documents contain preview snapshots only. The exact invite-to-Membership linkage remains a Phase 5 security decision and is deliberately not represented as a fixture contract.

See `MULTI_USER_EXPECTED_RESULTS.md` for the multi-user relationships and expected assertions. The existing `EXPECTED_RESULTS.md` remains dedicated to the original baseline.
