# Current Data Model

This document records the deployed-compatible data model implemented by the current application. Phase 1 additionally supports read-only, additive root Space and Membership documents when present, but it does not require them, migrate existing data, or implement the complete target model.

## Storage layout

All shared data is under `spaces/{spaceId}`:

```text
spaces/{spaceId}/places/{placeId}
spaces/{spaceId}/trips/{tripId}
spaces/{spaceId}/meta/config
```

The application adds Firestore document IDs as in-memory `id` fields after reading documents.

The active application Space remains the single Space selected by runtime configuration. It is represented in memory as `currentSpaceId` (`us` in production and `test-space-baseline` in LOCAL TEST). There is no Space discovery, switching, or local active-Space preference yet.

## Optional Phase 1 Space and Membership documents

The application can now also read these additive paths:

```text
spaces/{currentSpaceId}
spaces/{currentSpaceId}/members/{uid}
```

The optional root Space currently supports `name`, `type`, `ownerId`, `createdBy`, and `createdAt`. A formal Membership supports `userId`, `role`, `status`, `displayNameSnapshot`, optional `photoURLSnapshot`, `joinedAt`, and optional `removedAt`.

These documents are not created, updated, repaired, or required by normal application startup. Existing production data may omit them. When both formal areas are absent, the client constructs temporary compatible Members in memory from `spaces/{currentSpaceId}/meta/config.members` and nicknames. Existing content remains at its current paths and is not moved.

The normalized in-memory Member interface is:

```text
userId
role
status
displayName
photoURL
source: formal | legacy-meta
```

Formal Members use `owner` or `member` roles. A legacy compatibility Member has no asserted formal role because `meta/config.members` does not encode ownership; it remains active for compatibility only. Formal display names prefer `Membership.displayNameSnapshot`, then a legacy-compatible name, then a generic non-UID fallback. Legacy Member display names retain the current nickname-before-meta-name behavior. The existing visible two-person UI still reads legacy meta directly in Phase 1, so distinguishable formal snapshots do not silently rename current surfaces.

A pure ownership check reports whether there is exactly one active owner Membership and whether its `userId` matches `Space.ownerId`. Zero owners, multiple owners, a removed owner, and owner-ID mismatch are invalid diagnostic states; the application does not repair them. A removed current Membership is marked inaccessible in the target domain, but Phase 1 does not enforce Membership authorization in the UI or Firestore rules.

## Place

A Place is the stable geographic entity. It owns properties that are shared across all Visits.

### Current Place fields

| Field | Meaning |
| --- | --- |
| `name` | Display name. |
| `lat`, `lng` | Numeric coordinates. |
| `source` | Observed values include `google` and `map`. |
| `extId` | Google Place ID when available; used for duplicate detection. |
| `admin` | Reverse-geocoded display metadata: `country`, `county`, and `city`. |
| `status` | `visited` or `wishlist`. |
| `level` | Shared visit depth: `經過`, `接地`, `旅遊`, `住宿`, or `居住`. |
| `rating` | Shared Place rating, from 0.5 through 5 in 0.5 steps; absent/null means unrated. |
| `review` | Shared free-text review. |
| `visits` | Embedded Visit array for visited Places. This is the canonical current visit history. |
| `createdBy` | UID of the creator. |
| `createdAt` | Firestore server timestamp used for collection ordering and fallback list ordering. |
| `ord` | Optional wishlist ordering value. |
| `countyCode`, `townCode`, `villCode` | Cached point-in-polygon administrative identifiers. |

A wishlist Place normally has no Visits and uses Place-level category and participant fields. A visited Place is expected to have one or more Visits. Removing its last Visit changes it to `wishlist`.

## Visit

A Visit is one dated occurrence at a Place. Multiple Visits can refer to the same Place because Visits are embedded in that Place document.

| Field | Meaning |
| --- | --- |
| `id` | UUID when available, otherwise a timestamp/random fallback. Legacy normalized Visits receive an in-memory `legacy_{index}` ID. |
| `kind` | `visit` or `stay`. Unknown/missing values are treated as `visit`, unless a valid legacy `endDate` implies `stay`. |
| `date` | Visit date or stay arrival date, formatted `YYYY-MM-DD`. Visits without a date are omitted when saving. |
| `endDate` | Checkout date for a stay; empty for an ordinary Visit. |
| `tripId` | Referenced Trip document ID, or an empty string for daily life. |
| `category` | One category/purpose for this occurrence. |
| `who` | Array of participant UIDs. |
| `order` | Optional numeric ordering among ordinary Visits on the same day. |

Category, Trip, and participants are canonical at Visit level for visited history. Rating, review, depth, identity, and coordinates remain canonical at Place level.

## Stay semantics

A Visit is a valid stay when `kind` is `stay` and `endDate` is later than `date`. The stored range uses arrival as inclusive and checkout as exclusive for occupied nights. Night count is the day difference, with a minimum display value of one.

For daily and Trip sequences, each occupied night produces two fixed anchors around ordinary Visits:

- A `night` anchor on every date `date <= day < endDate`, sorted after ordinary Visits.
- A `morning` anchor on every date `date < day <= endDate`, sorted before ordinary Visits.

Thus checkout day has a morning departure anchor but no occupied-night anchor. These generated anchors are not stored and cannot be reordered. If a stay checkout is missing or invalid in the editor, it is replaced with the following day.

## Visit ordering and occurrences

Stored Visit ordering is represented by `visit.order`. Generated occurrence objects also carry their Place, Visit array index, effective sequence date, anchor type, and whether they are fixed.

Occurrences sort by:

1. Effective date.
2. Stay anchor rank: morning, ordinary Visit, night.
3. Numeric Visit order, with missing order last.
4. Place `ord` or `createdAt.seconds` fallback.
5. Visit array index.

Reordering is available for ordinary occurrences in day/Trip contexts. The application assigns consecutive order values across that day's ordinary Visits, groups changed Visits by Place, and rewrites each affected Place's complete `visits` array. Stay anchors remain fixed.

Trip labels use `D{day}-{position}`. Single-day labels use consecutive integers. Trip day numbering is based on the Trip start date, or on the earliest occurrence when the Trip has no start date.

## Trip

| Field | Meaning |
| --- | --- |
| `name` | Trip display name. |
| `emoji` | Optional display icon. |
| `startDate`, `endDate` | Inclusive displayed Trip range. |
| `color` | Marker/tag color associated with the Trip. |
| `createdBy`, `createdAt` | Creator UID and server timestamp. |

Trips do not own Places or Visit arrays. Membership is determined by `visit.tripId`. Trip counts distinguish Visit count from unique Place count. Deleting a Trip currently does not rewrite referencing Visits.

## Visitor and companion logic

The shared meta document contains a `members` object keyed by UID. The current UI assumes the authenticated user and at most one other member. `nicknames` can override member display names.

For current Visits, `visit.who` is authoritative when it is a non-empty array. UI modes are derived relative to the authenticated user:

- `me`: includes the current UID.
- `partner`: includes the other member UID but not the current UID.
- `both`: includes both UIDs; arrays with more than one unknown participant also fall back to this display mode.

When `visit.who` is absent or empty, participant logic falls back to the Place-level compatibility representation.

The new generic Space Member helpers support arbitrary active and removed Members and historical lookup without `partnerUid()`/`otherOf()`. They are a parallel Phase 1 foundation only. Existing participant editing, filtering, labels, and compatibility projections remain on the two-person logic until Phase 2.

## Legacy compatibility fields

The current application preserves a prior Place-level representation. These fields are mirrored summaries or fallbacks, not the canonical source for a current visited history:

| Place field | Compatibility role |
| --- | --- |
| `visitedOn` | Latest Visit date. If `visits` is absent/empty, it creates one normalized legacy Visit. |
| `tripId` | Latest Visit's Trip ID; used when constructing a legacy Visit and by Place-level marker fallback. |
| `categories` | Latest Visit category for visited Places; wishlist category remains current Place-level data. Its first value is the Visit category fallback. |
| `who` | Latest Visit participants for visited Places; current Place-level participant data for wishlist Places. |
| `whoMode` | `me`, `partner`, or `both` summary interpreted relative to `createdBy` and the other member. |

Visit normalization also accepts legacy `visit.categories[0]`, missing Visit IDs, missing `kind`, missing `who`, string/number `order`, and Place records with only `visitedOn`.

Whenever current Visit history is saved, reordered, or partially deleted, the latest Visit is projected back into `visitedOn`, `tripId`, `categories`, `who`, and `whoMode`. This mirroring and all read fallbacks are required compatibility behavior and must not be removed accidentally.

## Shared meta document

`spaces/{spaceId}/meta/config` contains:

- `categories`: shared category names.
- `members`: UID-to-display-name map.
- `nicknames`: UID-to-user-selected-name map.
- `catColors`: category-to-color map.
- `levelColors`: visit-depth-to-color overrides.

Marker visibility, marker mode, choropleth metric/opacity, active filters, and layout state are runtime-only and are not persisted by the current code.
