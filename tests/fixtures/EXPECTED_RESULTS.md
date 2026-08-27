# Expected baseline results

These outcomes describe the current code against `mapair-baseline.json`. They are human-readable assertions for later domain, emulator, and manual tests. Any loader-dependent result assumes the documented tagged timestamps have first been converted to native Firestore `Timestamp` values.

## Administrative regions

Each Place coordinate falls inside the county, town, and village polygon identified by its cached codes:

- `place-test-station`: Taipei City (`63000`), Songshan District (`63000010`), Ciyou Village (`63000010018`)
- `place-test-park`: Taipei City (`63000`), Beitou District (`63000120`), Guandu Village (`63000120038`)
- `place-test-cafe`: Taichung City (`66000`), Xitun District (`66000060`), Dapeng Village (`66000060014`)
- `place-test-hotel`: Taichung City (`66000`), Heping District (`66000290`), Pingdeng Village (`66000290008`)
- `place-test-wishlist`: Kaohsiung City (`64000`), Zuoying District (`64000030`), Chengnan Village (`64000030025`)
- `place-test-legacy-no-created-at`: Changhua County (`10007`), Lukang Township (`10007020`), Ludong Village (`10007020031`)
- `place-test-dangling-trip`: Yilan County (`10002`), Luodong Township (`10002020`), Daxin Village (`10002020004`)

## Repeated Visits and Visit-level fields

- `place-test-station` renders as two distinct Visit occurrences without duplicating the Place: `visit-test-station-daily` on 2024-03-01 and `visit-test-station-trip` on 2024-04-11.
- The 2024-03-01 station Visit displays/filters as category `測試散步`, participant `test-user-a`, and Daily/no Trip.
- The 2024-04-11 station Visit displays/filters as category `測試交通`, participants `test-user-a` plus `test-user-b`, and Trip `trip-test-multiday`.
- With `test-user-a` authenticated, these station Visits derive participant modes `me` and `both`, respectively. `place-test-park` Visits derive `partner`, and `place-test-cafe` derives `me`.
- Opening either station occurrence refers to the same Place-level `rating: 4.5`, review `測試共用評論：每次造訪都應看到同一段文字。`, and depth `接地`.
- The station's compatibility summary matches its latest Visit: `visitedOn: 2024-04-11`, `tripId: trip-test-multiday`, `categories: [測試交通]`, both participant UIDs, and `whoMode: both`.

## Stay anchors and date boundaries

`visit-test-hotel-stay` is a two-night stay: arrival is inclusive on 2024-04-10 and checkout is exclusive on 2024-04-12.

- 2024-04-10: one fixed night anchor, representing night 1/2; no morning anchor.
- 2024-04-11: one fixed morning anchor after night 1/2 and one fixed night anchor for night 2/2.
- 2024-04-12: one fixed morning anchor after night 2/2; no night anchor.
- Stay anchors open the underlying Visit and do not participate in ordinary Visit reorder/delete controls.
- `visitCoversDate` excludes checkout day 2024-04-12 from occupied nights.
- **CURRENT QUIRK:** a date range whose `from` is exactly 2024-04-12 still intersects this stay because the current comparison rejects only checkout values earlier than `from`, not equal to it.

## Same-day ordering

For ordinary Visits on 2024-04-11, stored numeric `order` produces this order before adding stay anchors:

1. `visit-test-station-trip` at `place-test-station` (`order: 1`)
2. `visit-test-park-trip-day2` at `place-test-park` (`order: 2`)
3. `visit-test-cafe-trip-day2` at `place-test-cafe` (`order: 3`)

In the complete day sequence, the hotel morning anchor sorts before those three ordinary Visits and the hotel night anchor sorts after them. Reordering the ordinary Visits should rewrite consecutive order values only for ordinary Visits; generated hotel anchors remain fixed and are never stored.

## Trip results and labels

`trip-test-multiday` contains five stored Visits across four unique Places: the two park Visits, the station Trip Visit, the cafe Visit, and the hotel stay Visit. It has occurrences across all three displayed Trip days after stay expansion.

- 2024-04-10: `visit-test-park-trip-day1` is `D1-1`; the hotel night anchor is `D1-2`.
- 2024-04-11: the hotel morning anchor is `D2-1`; station is `D2-2`; park is `D2-3`; cafe is `D2-4`; the hotel night anchor is `D2-5`.
- 2024-04-12: the hotel checkout-morning anchor is `D3-1`.

Day numbering starts from the fixture Trip's explicit `startDate`, 2024-04-10. Selecting the Trip should clear date bounds to All and show the full sequence.

## Wishlist and Daily filters

- `place-test-wishlist` appears in the Wishlist list, has no Visit occurrence, and uses Place-level category `測試願望` and both participant UIDs.
- A specific Trip filter does not match this Wishlist Place. The Daily filter normally matches it because it has no Visit Trip references.
- **CURRENT QUIRK:** Wishlist filtering uses Place-level category/participant/region compatibility fields and ignores active date bounds.
- The Daily/no-Trip Visit `visit-test-station-daily` matches the Daily filter; all five Visits referencing `trip-test-multiday` and `visit-test-dangling-trip` do not.

## Legacy normalization

`place-test-legacy-no-created-at` has an empty `visits` array and `visitedOn: 2023-12-15`. Current `placeVisits()` therefore normalizes exactly one in-memory Visit with:

- synthetic in-memory ID `legacy_0`
- `kind: visit`
- `date: 2023-12-15`
- empty `endDate` and empty `tripId`
- category `測試舊分類`
- participant `test-user-b`, derived from the Place fallback
- no `order`

The normalized ID is not stored fixture data and should be replaced by a normal stable/generated Visit ID when a later save workflow serializes current Visit history. The legacy Place-level `visitedOn`, `tripId`, `categories`, `who`, and `whoMode` fields must continue to work as fallbacks.

## Dangling Trip

`visit-test-dangling-trip` references `trip-test-missing`, for which no fixture Trip exists. It remains a valid visited occurrence and its unresolved `tripId` remains present; it does not match Daily and cannot establish a specific-Trip sequence context because current `specificTripId()` requires an existing Trip.

**CURRENT QUIRK:** deleting a Trip does not clean Visit references, so the present dangling value models the retained post-deletion shape. The current card falls back to the Daily/no-Trip presentation when it cannot resolve the Trip object, even though filtering logic still treats the non-empty `tripId` as non-Daily.

## Missing `createdAt` investigation

`place-test-legacy-no-created-at` intentionally lacks `createdAt`.

- Direct fixture/domain inspection can normalize it and uses an effective fallback order of `0` when neither `ord` nor `createdAt.seconds` exists.
- **CURRENT QUIRK / NEEDS EMULATOR CONFIRMATION:** the production-shaped Place subscription uses `orderBy("createdAt", "desc")`; Firestore ordered-query behavior may exclude this document entirely. A future emulator test must distinguish query-visible results from direct document/fixture inspection.

No assertion should invent a timestamp for this Place or silently repair it during fixture loading.
