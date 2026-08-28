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

The active application Space remains the single Space selected by runtime configuration. It is represented in memory as `currentSpaceId` (`us` in production and `test-space-baseline` in LOCAL TEST). There is no production Space discovery, switching, or local active-Space preference yet.

LOCAL TEST additionally accepts a strict development/test harness parameter, `?firebaseEnv=local&testSpace=group`, which selects `test-space-group` from a fixed two-entry allowlist (`baseline` → `test-space-baseline`, `group` → `test-space-group`). It is localhost-only, rejects unknown or duplicate values, fails closed in production, and never accepts an arbitrary Firestore Space ID. It is not a Space switcher.

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
valid
issues
```

The Membership document ID is the canonical formal Member identity; a stored `userId`, when present, must match it exactly. Formal Members are valid only when `role` explicitly equals `owner` or `member` and `status` explicitly equals `active` or `removed`. Malformed records retain structured issues for diagnostics but cannot become active, accessible, or valid owners. A stored root `id` field likewise cannot override the path-derived `currentSpaceId`.

A legacy compatibility Member has no asserted formal role because `meta/config.members` does not encode ownership; it remains active for compatibility only. Only UIDs present in `meta/config.members` become legacy Members. Nicknames may override those Members' display names but cannot introduce nickname-only phantom Members. Formal display names prefer `Membership.displayNameSnapshot`, then a legacy-compatible name, then a generic non-UID fallback. The existing visible two-person UI still reads legacy meta directly in Phase 1, so distinguishable formal snapshots do not silently rename current surfaces.

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
| `participantIds` | Array of participant UIDs. The modern authoritative participant field (Phase 2). |
| `who` | Array of participant UIDs. Legacy participant field, still written as a mirror for mixed-client compatibility. |
| `order` | Optional numeric ordering among ordinary Visits on the same day. |

Category, Trip, and participants are canonical at Visit level for visited history. Rating, review, depth, identity, and coordinates remain canonical at Place level.

### Visit participant resolution (Phase 2)

Participants are arbitrary active or removed Space Members, not a fixed
`me` / `partner` / `both` model. The domain resolves a Visit's participants in
this precedence:

1. If the Visit has its own `participantIds` and it is a valid UID array, that
   is authoritative. An explicit empty array (`participantIds: []`) is honoured
   and does not fall through.
2. Otherwise, if the Visit has a usable legacy `who` array, use it.
3. Otherwise, use the Place-level compatibility fallback. There, a usable Place
   `who` array wins as the full arbitrary UID list; `whoMode` is interpreted
   only when there is no usable `who`, and only for a genuine two-person legacy
   universe whose anchor (`createdBy`) is one of the two.

Malformed `participantIds` produces a structured diagnostic, never a crash, and
falls back to compatibility without being silently normalized.

When a Visit carries both `participantIds` and `who` and they disagree, the
disagreement is a detectable, reported condition (`同行者資料需確認` in the
editor; a `console.warn` in LOCAL TEST). Domain, display, and filtering use
`participantIds`. Unrelated edits (date, category, Trip, rating, review) must
preserve both original arrays verbatim; only an explicit participant selection
reconciles them, writing `participantIds` and `who` identically. A new Visit
writes both fields identically from creation. Historical Visits are never bulk
migrated.

### Historical (removed / unknown) participants

A participant UID on an existing record that is not an active Member is a
*historical* participant. It stays on the record through unrelated edits, and is
never offered as an unchecked candidate that could be re-added. The user may
explicitly remove it; that removal is **one-way** and counts as a participant
edit (it reconciles `participantIds` and `who` to the remaining selection). New
data never gains a historical UID: every new-Visit participant seed is
intersected with active valid Memberships first.

The UI distinguishes a **known removed Member** (`真實名稱（已離開）`, resolved
from the retained Membership snapshot) from an **unknown historical UID**
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

The shared meta document contains a `members` object keyed by UID; `nicknames`
can override member display names. Phase 2 removed the two-person assumption
from the domain and UI: participant filters, pickers, marker colouring, legend,
and name resolution all operate on arbitrary active Space Members resolved
through the Membership foundation (`src/space-membership.js`), and removed
Members are still resolved for historical display. There is no `partnerUid()` /
`otherOf()` / `me` / `partner` / `both` logic in the domain any more.

Participant pickers and automatic defaults offer only active Members. A
historical (removed / unknown) participant already on a record is preserved
through unrelated edits, is shown with an explicit remove control, and once
removed cannot be re-added — see **Historical (removed / unknown) participants**
above. `meta/config.members` is still the two-person legacy universe used only
to serialize a compatible `whoMode` (see below).

The authenticated User's new-data default is fail-closed: it is selected only
when that User is an active valid Member, otherwise the default is empty.

For the Visit-level resolution precedence, see **Visit participant resolution
(Phase 2)** above.

## Legacy compatibility fields

The current application preserves a prior Place-level representation. These fields are mirrored summaries or fallbacks, not the canonical source for a current visited history:

| Place field | Compatibility role |
| --- | --- |
| `visitedOn` | Latest Visit date. If `visits` is absent/empty, it creates one normalized legacy Visit. |
| `tripId` | Latest Visit's Trip ID; used when constructing a legacy Visit and by Place-level marker fallback. |
| `categories` | Latest Visit category for visited Places; wishlist category remains current Place-level data. Its first value is the Visit category fallback. |
| `who` | Latest Visit participants for visited Places; current Place-level participant data for wishlist Places. Full arbitrary-Member UID array (no longer capped at two). |
| `whoMode` | Legacy serialization only. Emitted as `me` / `partner` / `both` **only** when the legacy `meta/config.members` universe has exactly two distinct Members, `createdBy` is an explicit usable UID inside that universe, and the participant set exactly matches one historical meaning; otherwise `""` (no fallback anchor). Never read for domain, filter, marker, or UI behavior. |

Visit normalization also accepts legacy `visit.categories[0]`, missing Visit IDs, missing `kind`, missing `who`, string/number `order`, and Place records with only `visitedOn`. Normalization preserves a Visit's raw `participantIds` / `who` exactly and never synthesizes or collapses them.

Whenever current Visit history is saved, reordered, or partially deleted, the latest Visit is projected back into `visitedOn`, `tripId`, `categories`, `who`, and `whoMode`. This mirroring and all read fallbacks are required compatibility behavior and must not be removed accidentally.

## Shared meta document

`spaces/{spaceId}/meta/config` contains:

- `categories`: shared category names.
- `members`: UID-to-display-name map.
- `nicknames`: UID-to-user-selected-name map.
- `catColors`: category-to-color map.
- `levelColors`: visit-depth-to-color overrides.

Marker visibility, marker mode, choropleth metric/opacity, active filters, and layout state are runtime-only and are not persisted by the current code.
