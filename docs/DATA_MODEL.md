# Data Model

> The running client uses the **No-Space** model: top-level `users`, `places`,
> `visits`, `visits/{id}/contributions`, `users/{uid}/dayOrders`, and `trips`.
> The authoritative specification of that model — Firestore paths, shared vs
> personal facts, the no-clock-time rule, Place resolution, contributions, day
> order, Trip defaults — is [NO_SPACE_CORE.md](NO_SPACE_CORE.md).
>
> This document covers what NO_SPACE_CORE.md does not: **the projected
> Place/Visit/Trip shape** that the map/list/filter/stay pipeline consumes, and
> the **legacy read-compatibility rules** that still apply to pre–No-Space
> records and to migration input. It does not describe a `spaces/{spaceId}`
> runtime — that architecture is archived (see [archive/](archive/)) and its
> modules (`src/spaces.js`, `src/space-membership.js`) are deleted.

## Storage layout

Live reads and writes go through `src/no-space/repository.js` only. The paths are
listed in [NO_SPACE_CORE.md](NO_SPACE_CORE.md#firestore-paths); nothing touches
`spaces/…`.

Legacy shared history still lives at `spaces/us/{places,trips,meta}` in
production. It is **not read by the client** and is untouched by development
work; it exists only as input for the separately approved No-Space migration
(`scripts/migrate-no-space-v1.mjs`, see [MAPAIR_V0_3_RELEASE.md](MAPAIR_V0_3_RELEASE.md)).
The migration has not been run.

The application adds each Firestore document's ID as an in-memory `id` field
after reading it.

## Projected runtime shape

`projectNoSpaceRuntime()` (`src/no-space/visits.js`) folds the top-level
documents into a `places` map where each Place carries an embedded `visits`
array, so the pre-existing Place-oriented rendering, filtering, stay-anchor, and
geography code needs no change. The field tables below describe that projected
shape. A projected field that is *not* also a stored objective Place field
(rating, `level`, embedded `visits`) is derived per current user and never
written back to `places/{id}`.

The same shape is produced when normalising a genuinely legacy record, so the
compatibility rules in **Legacy compatibility fields** below still matter.

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
| `status` | Legacy field. Not written by the No-Space client. Dormant legacy `status:"wishlist"` documents (see below) may still exist in migrated data but are ignored everywhere. |
| `level` | Projected per-user visit depth (`經過`/`接地`/`旅遊`/`住宿`/`居住`) from the current user's Visit contribution; not a stored Place field. |
| `rating` | Projected per-user rating (0.5–5 in 0.5 steps) from the current user's latest Visit contribution; not a stored Place field. |
| `review` | Legacy shared free-text review. Replaced by the personal Visit contribution `memory`. |
| `visits` | Embedded Visit array — **projection only**. Built from the `visits/{visitId}` documents referencing this Place; never stored on `places/{id}`. |
| `createdBy` | UID of the creator. |
| `createdAt` | Firestore server timestamp; used only as a fallback ordering tiebreak. |
| `ord` | Legacy ordering value on old wishlist documents. Not written by current code. |
| `countyCode`, `townCode`, `villCode` | Cached point-in-polygon administrative identifiers (`updatePlaceCache`). |

### Place lifecycle

A Place exists in the active product **only because it has real Visit history** — a non-empty embedded `visits` array, or (read compat) a legacy `visitedOn` date. The central `hasVisitHistory(place)` gate encodes this and is applied before a Place appears in the list, on the map, in participant/category filters, in statistics/counts, or in administrative and proximity coverage.

Creating a Place always creates its first Visit at the same time (Phase 2 new-Visit defaults). Deleting a Place's **last** remaining Visit deletes the whole Place document — the code never writes an empty active Place and never downgrades a Place to `status:"wishlist"`. Deleting one of several Visits just rewrites the `visits` array.

### Legacy wishlist documents (removed feature)

The "想去 / wishlist" feature has been removed. Legacy documents with `status:"wishlist"`, `visits:[]`, and `visitedOn:""` may still be present in Firestore. They are **dormant**: `hasVisitHistory` returns false for them, so they are invisible in every normal surface and are never used as an administrative or proximity seed. This change performs **no production data migration** — no bulk delete, no startup migration, no field erasure. A separately approved migration may clean them up later. `findExistingPlace()` still detects such a document by `extId` / normalized name / location, so if a member explicitly searches for that Place and records a Visit, the existing document is reused and becomes normal Visit-bearing data through that explicit action.

## Visit

A Visit is one dated occurrence at a Place, stored as its own `visits/{visitId}`
document. Multiple Visits can reference the same `placeId`; the projection groups
them under one Place with an embedded `visits` array (see **Projected runtime
shape**).

| Field | Meaning |
| --- | --- |
| `id` | UUID when available, otherwise a timestamp/random fallback. Legacy normalized Visits receive an in-memory `legacy_{index}` ID. |
| `kind` | `visit` or `stay`. Unknown/missing values are treated as `visit`, unless a valid legacy `endDate` implies `stay`. |
| `date` | Visit date or stay arrival date, formatted `YYYY-MM-DD`. Visits without a date are omitted when saving. |
| `endDate` | Checkout date for a stay; empty for an ordinary Visit. |
| `tripId` | Referenced Trip document ID, or an empty string for daily life. |
| `category` | One category/purpose for this occurrence. |
| `participantIds` | Array of participant UIDs. In the projection this equals the stored `visits/{id}.participantUserIds`. |
| `who` | Array of participant UIDs. In the projection, set identical to `participantIds`. Only a genuine legacy record has a `who` that can differ. |
| `order` | Projected per-user position among ordinary Visits on the same day, from `users/{uid}/dayOrders/{date}`. Not a stored Visit field. |

Category, Trip, and participants are canonical on the `visits/{id}` document. Identity and coordinates are canonical on `places/{id}`. Rating, memory, and depth are canonical on `visits/{id}/contributions/{uid}`.

### Visit participant resolution (Phase 2)

Participants are an arbitrary UID set, not a fixed `me` / `partner` / `both`
model. `resolveVisitParticipants` in `src/participants.js` resolves a Visit's
participants in this precedence (used by the projection, legacy read paths, and
the migration tool):

1. If the Visit has its own `participantIds` and it is a valid UID array, that
   is authoritative. An explicit empty array (`participantIds: []`) is honoured
   and does not fall through.
2. Otherwise, if the Visit has a usable legacy `who` array, use it.
3. Otherwise, use the Place-level compatibility fallback. There, a usable
   (non-empty) Place `who` array wins as the full arbitrary UID list; `whoMode`
   is interpreted only when there is no usable `who`, and only for a genuine
   two-person legacy universe whose anchor is the record's own `createdBy` (one
   of the two — never the current viewer, so an old record resolves and
   serializes the same for everyone). An explicit empty Place `who` with no
   meaningful `whoMode` (e.g. a legacy selection cleared to nobody) resolves
   to `[]` and is not silently repopulated with the creator on reload. Only a
   record with no participant data at all falls back to its own `createdBy`.

Malformed `participantIds` produces a structured diagnostic, never a crash, and
falls back to compatibility without being silently normalized.

A No-Space Visit stores only `participantUserIds`, so it cannot carry a
`who` / `participantIds` conflict. On a legacy record where the two disagree,
`detectParticipantMismatch` reports it and domain/display/filtering use
`participantIds`; the current No-Space editor does not surface a notice for it.
Legacy `who`-only or mismatched Visits are never bulk migrated or backfilled by
unrelated edits.

### Historical (removed / unknown) participants

A participant UID on an existing record that is not a currently-known participant
is a *historical* participant. It stays on the record through unrelated edits,
and is never offered as an unchecked candidate that could be re-added. The user
may explicitly remove it; that removal is **one-way** and counts as a participant
edit. New data never gains a historical UID: every new-Visit participant seed is
intersected with the active participant set first.

The UI distinguishes a **known removed participant** (`真實名稱（已離開）`,
resolved from a retained `users/{uid}` profile) from an **unknown historical UID**
(`未知成員`). A raw UID is never displayed. The authenticated User shows as
`真實名稱（我）` where a name is known.

The pure resolution, mismatch, sanitisation, ordering, serialization,
deterministic colour, and legacy `whoMode` helpers live in `src/participants.js`.

## Stay semantics

A Visit is a valid stay when `kind` is `stay` and `endDate` is later than `date`. The stored range uses arrival as inclusive and checkout as exclusive for occupied nights. Night count is the day difference, with a minimum display value of one.

For daily and Trip sequences, each occupied night produces two fixed anchors around ordinary Visits:

- A `night` anchor on every date `date <= day < endDate`, sorted after ordinary Visits.
- A `morning` anchor on every date `date < day <= endDate`, sorted before ordinary Visits.

Thus checkout day has a morning departure anchor but no occupied-night anchor. These generated anchors are not stored and cannot be reordered. If a stay checkout is missing or invalid in the editor, it is replaced with the following day.

## Visit ordering and occurrences

Per-user ordering within one date lives in `users/{uid}/dayOrders/{date}.visitIds`
and is projected onto each Visit as `order`. Generated occurrence objects also
carry their Place, Visit array index, effective sequence date, anchor type, and
whether they are fixed.

Occurrences sort by:

1. Effective date.
2. Stay anchor rank: morning, ordinary Visit, night.
3. Projected day-order position, with unpositioned Visits last.
4. Place `ord` or `createdAt.seconds` fallback.
5. Visit array index.

Reordering is available for ordinary occurrences in day/Trip contexts. Moving a
Visit rewrites only the current user's `dayOrders/{date}` document (optimistic
local update, then `setDoc`); it never touches shared Visit or Place documents,
and another user's ordering is unaffected. Stay anchors remain fixed.

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

## Participant directory

The client derives the known-participant set from the authenticated user plus
every `participantUserIds` entry on visible Visits and Trips
(`knownParticipantUserIds`), then reads those exact `users/{uid}` documents for
display names and photos. It never lists the `users` collection. `main.js`
projects this into a `participantMembers` array (all `status:"active"`, `valid`)
and a `members` UID→name map. There is no `partnerUid()` / `otherOf()` /
`me` / `partner` / `both` logic; participant filters, pickers, marker colouring,
legend, and name resolution operate on this arbitrary-N set.

A participant UID on a record that is not a currently-known participant is a
*historical* participant: it is preserved through unrelated edits, shown with an
explicit one-way remove control, and never offered as a re-addable candidate —
see **Historical (removed / unknown) participants** above. The authenticated
user's new-data default is `[uid]` only when that uid is an active member,
otherwise empty (fail-closed).

For the Visit-level resolution precedence, see **Visit participant resolution
(Phase 2)** above.

## Legacy compatibility fields

The **No-Space client does not write any of these fields** — a stored Visit holds
`participantUserIds` only, and Place identity/coordinates/region-cache only. The
rules below apply when reading a genuinely legacy record (embedded `visits`,
`visitedOn`, `who`/`whoMode`) or as migration input, and to the in-memory
projection, where each projected Visit's `who` is set identical to
`participantIds`.

These Place-level fields are mirrored summaries or fallbacks on legacy records,
not the canonical source for a current visited history:

| Place field | Compatibility role |
| --- | --- |
| `visitedOn` | Latest Visit date. If `visits` is absent/empty, it creates one normalized legacy Visit. |
| `tripId` | Latest Visit's Trip ID; used when constructing a legacy Visit and by Place-level marker fallback. |
| `categories` | Latest Visit category, mirrored to Place level. Its first value is the Visit category fallback. |
| `who` | Latest Visit participants, mirrored to Place level. Full arbitrary UID array (no longer capped at two). |
| `whoMode` | Legacy serialization only (`deriveLegacyWhoMode`). Emitted as `me` / `partner` / `both` **only** when the supplied legacy member universe has exactly two distinct UIDs, `createdBy` is an explicit usable UID inside it, and the participant set exactly matches one historical meaning; otherwise `""` (no fallback anchor). Never read for domain, filter, marker, or UI behaviour. |

Visit normalization also accepts legacy `visit.categories[0]`, missing Visit IDs, missing `kind`, missing `who`, string/number `order`, and Place records with only `visitedOn`. Normalization preserves a Visit's raw `participantIds` / `who` exactly and never synthesizes or collapses them.

The legacy write-back that mirrored the latest Visit into `visitedOn` / `tripId` /
`categories` / `who` / `whoMode` belonged to the embedded-`visits` client and is
**not performed by the No-Space client**. The `whoMode` derivation helper in
`src/participants.js` is retained for the migration tool and for serializing a
compatible value if such a write path is ever reintroduced.

## App defaults document

`appConfig/defaults` holds the shared display defaults the client reads:

- `categories`: shared category names.
- `catColors`: category-to-colour map.
- `levelColors`: visit-depth-to-colour overrides.

Participant display names come from `users/{uid}.displayName`, not from this
document. Marker visibility, marker mode, choropleth metric/opacity, active
filters, and layout state are runtime-only and are not persisted.
