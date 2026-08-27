# Mapair baseline fixtures

A fixture is a small, fixed set of input data used to put a test environment into a known state. `mapair-baseline.json` is a completely invented Mapair dataset intended for a future local Firebase Emulator workflow. It contains no production export, real user identity, credential, Firebase configuration, or production-derived user content.

Never seed this fixture into production. No fixture loader or reset script exists yet, and this directory does not connect to Firebase.

## File shape and serialization

The JSON envelope keeps the current Firestore areas separate:

- `spaceId` is the invented target space ID, `test-space-baseline`.
- `meta.config` is the document body for `spaces/{spaceId}/meta/config`.
- Each `trips[]` and `places[]` entry has an `id` for the future document path and a `data` object for the document body. The `id` is not meant to be stored as a Firestore field; the current app adds document IDs only after reading snapshots.
- `fixtureVersion` versions the fixture file itself and is not a Firestore field.

JSON cannot contain native Firestore `Timestamp` values. Every fixture timestamp is encoded as:

```json
{
  "__type": "firestore-timestamp",
  "iso": "2024-01-03T00:00:00.000Z"
}
```

A future loader must validate the ISO value and convert the complete tagged object to a native Firestore `Timestamp` before writing. It must not store the tagged object or ISO string as the document's `createdAt`. All dates and timestamps are fixed historical values; none are relative to the current day.

Document IDs, Visit IDs, participant UIDs, dates, ordering values, coordinates, colors, and timestamp strings are stable. The Place names and data are synthetic. Each coordinate has been validated with point-in-polygon checks against the repository's county, town, and village GeoJSON, and its cached administrative codes identify the containing polygons. The seven Places cover distinct villages and districts across Taipei, Taichung, Kaohsiung, Changhua, and Yilan.

## Record purposes

- `test-user-a` and `test-user-b`: the two fake participant identities in `meta.config.members`, with synthetic nicknames.
- `trip-test-multiday`: a three-day Trip spanning 2024-04-10 through 2024-04-12.
- `place-test-station`: repeated ordinary Visits with different Visit categories and participant combinations; its Daily Visit has no Trip. Its rating, review, and depth are shared Place fields.
- `place-test-park`: Trip Visits on two days, including the first ordinary Visit on 2024-04-10 and the second ordinary Visit on 2024-04-11.
- `place-test-cafe`: the simplest single ordinary Visit and the third ordinary Visit on 2024-04-11.
- `place-test-hotel`: a two-night stay with inclusive arrival 2024-04-10 and exclusive checkout 2024-04-12.
- `place-test-wishlist`: a Wishlist Place with no Visits and Place-level compatibility category/participants.
- `place-test-legacy-no-created-at`: a `visitedOn`-only legacy Place with an empty `visits` array, current Place-level fallback fields, and intentionally no `createdAt`.
- `place-test-dangling-trip`: an ordinary Visit whose `tripId` is deliberately `trip-test-missing`; that ID must not be added to `trips`.

Several records intentionally cover more than one baseline case to keep the fixture compact. The mirrored Place fields on current visited Places match their latest Visit. No seed/import script exists yet.
