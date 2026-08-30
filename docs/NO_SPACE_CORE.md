# No-Space Core

> "Phase A" throughout this document names the currently-shipped scope. The
> production data migration and the candidate Firestore rules are separate,
> not-yet-executed operations (see [MAPAIR_V0_3_RELEASE.md](MAPAIR_V0_3_RELEASE.md)).

## Status and safety boundary

No-Space is the only architecture. Production needs no query parameter. LOCAL
development uses `?firebaseEnv=local` (localhost only, exactly that value), which
connects the Auth and Firestore emulators and otherwise runs the identical
No-Space client. There are no architecture feature flags; the earlier
`spaces/{spaceId}` / `multiSpace` / `noSpace` runtime paths and their modules
have been removed. `spaces/us` still exists in production Firestore but is not
read by the client — it is migration input only.

Development performs no production migration, rule deployment, data copy, or deletion. The migration and candidate rules require separate review and explicit operator action.

## Domain model

```text
User <------> Visit <------> User
                 |
               Place
                 |
                Trip

Personal:
User ------> Visit Contribution
User ------> Day Order
```

A Visit is a first-class shared experience document. A Place is objective geographic identity. A Trip supplies optional grouping and defaults for future Visits. A rating, memory, and visit-depth assessment belong to one User's contribution to one Visit. Ordering belongs to one User on one date.

Shared Visit facts are:

- Place reference;
- date;
- activity/category;
- participants;
- **visit depth ("造訪深度" / `level`)** — one of 經過 / 接地 / 旅遊 / 住宿 / 居住, shared by everyone on the Visit;
- checkout date, when the depth is 住宿;
- optional Trip reference.

There is no separate stay toggle: a Visit is a stay **iff** its shared depth is
住宿, and only then does it carry (and require) a checkout date. `kind`
(`visit` / `stay`) is still written for compatibility but is derived from the
depth.

Personal facts/state are:

- rating;
- memory (the product-facing replacement for legacy “review”);
- manual ordering within one date.

## Intentional no-clock-time rule

Mapair stores a date plus each User's manual day sequence. It does not store or request a visit time, start time, end time, or arrival time, and it never orders Visits using clock values. `createdAt` and `updatedAt` are technical audit timestamps, not experience-time inputs and never participate in Visit sequencing.

Stay compatibility still uses date-only `date` and `endDate`: arrival is inclusive, checkout is exclusive for occupied nights, and generated morning/night anchors remain derived display objects rather than stored Visits.

## Firestore paths

```text
users/{uid}
users/{uid}/dayOrders/{YYYY-MM-DD}

places/{placeId}

visits/{visitId}
visits/{visitId}/contributions/{uid}

trips/{tripId}
```

No-Space path construction is centralized in `src/no-space/repository.js`. No No-Space read or write uses `spaces/{spaceId}/places`, `spaces/{spaceId}/trips`, `spaces/{spaceId}/meta`, or `spaces/{spaceId}/members`.

### Visible Visit and Trip queries

The client queries top-level `visits` and `trips` with `participantUserIds array-contains authenticatedUid`. A participant can edit shared facts. Every existing-Visit or existing-Trip mutation transaction first reads the current persisted parent and authorizes against that document, never permission facts supplied by an editor draft. The transaction preserves the stored `createdBy`; a stale editor belonging to a removed participant cannot edit or re-add that User. In Phase A only the currently stored `createdBy` can delete the whole Visit or Trip. `createdBy` is solely destructive-action protection and is not a permission role. The current User cannot remove their own UID as an ersatz Exit operation.

These repository checks are application correctness and do not replace separately reviewed production Firestore Security Rules. `firestore.no-space.rules` is the candidate source and is intentionally isolated from normal `firebase.json` until the deployed rules have been inspected and reconciled.

### Place resolution

Every Visit is schema-validated to contain a non-empty, path-safe `placeId`. The Visit query yields Place IDs, and the client attaches one document listener per referenced `places/{placeId}` instead of enumerating every global Place. Multiple visible Visits to the same Place are projected into one geographic marker while remaining separate occurrences in filtering and history.

Before creating an external/Google Place, the repository performs an exact `extId` lookup and reuses a provider-matching result. If none exists, the provider and complete external ID produce one deterministic, path-safe Place document ID; a transaction creates that Place only if absent while creating the new Visit. Concurrent first records therefore converge on one objective identity. Custom map points without external IDs retain independent auto-generated Place IDs.

Normal Visit editing may change `Visit.placeId` to another known Place but never updates the selected global Place's name or coordinates. Only initial Place creation defines that objective identity; administrative cache writes remain the sole normal Place updates.

### Participant directory

The client derives known UIDs from the authenticated User plus participants on visible Visits and Trips. It reads those exact `users/{uid}` documents individually. It never lists the `users` collection and provides no global search. A User with no shared history can therefore create only solo Visits in Phase A.

## Contributions and ratings

Each current participant writes only `visits/{visitId}/contributions/{theirUid}`. The write runs in a transaction that reads the current Visit, verifies current participation, and rejects a missing or deleting Visit. Editing one contribution cannot replace another participant's document. Before projection, display, or averaging, contribution documents are intersected with the Visit's current `participantUserIds`. A dormant contribution from a removed participant may remain temporarily, but its memory is hidden and its rating is excluded. Other current-participant contributions are shown read-only. The average is computed at read time over submitted numeric ratings only; missing ratings are excluded and no average is stored.

Creator-only hard deletion transactionally verifies the persisted creator and marks the Visit `deleting` before reading its final contribution set. Visit edits and contribution transactions reject that lifecycle state. One atomic batch then deletes every contribution and the Visit parent, so a successful return guarantees that no contribution child remains. Phase A stops without partial deletion if the batch would exceed Firestore's 500-operation limit and clears the marker so the Visit remains usable. A read or batch failure reports clearly and leaves the marker in place, blocking new writes while allowing the creator to retry deletion safely. Stale day-order references may remain because normalization already ignores them.

The preserved rating range is 0.5–5 in 0.5 increments. An absent/null rating means “not rated.”

## Personal day order

`users/{uid}/dayOrders/{date}.visitIds` is a User-owned sequence. The same shared Visit can have different positions for different Users. Filtering never writes the order.

Pure normalization helpers:

- discard duplicate, unknown, stale, and wrong-date IDs;
- retain valid stored positions;
- append missing Visits deterministically by creation timestamp then document ID;
- tolerate a shared Visit moving to another date without corrupting either date;
- persist only when the User explicitly reorders or a newly-created Visit is appended.

Stay anchors remain fixed derived occurrences; ordinary Visits use the personal sequence.

## Trip defaults

`trips/{tripId}.participantUserIds` defines defaults for future Visits created in that Trip. The array is copied into a new Visit and remains editable there. Updating Trip defaults never rewrites an existing Visit. Phase A prevents the current User from removing themselves from a Trip because explicit Exit semantics are deferred. A migrated `createdBy` value is technical destructive-action protection selected from the resolved participants; it is not proof of historical authorship.

Hard-deleting a Trip does not delete or rewrite historical Visits. Their old `tripId` remains as a dangling historical reference, is excluded from the Daily filter, and renders as “已刪除旅程” instead of being mislabeled as Daily life. When such a Visit is edited, the missing Trip appears as a synthetic selected “已刪除旅程” option, so unrelated changes preserve the original ID. The User may explicitly choose no Trip or another current Trip to detach or reassign it. This is the deterministic Phase A referential-integrity policy; detaching/backfilling history is deferred.

## Legacy Place-field decisions

| Legacy Place field | No-Space Phase A decision |
| --- | --- |
| `rating` | Personal `Visit` contribution `rating`; never global Place data. |
| `review` | Renamed “memory” and stored in the personal Visit contribution. |
| `level` | A **shared** Visit fact ("造訪深度") on `visits/{visitId}`, and the sole trigger for a stay (住宿). The runtime projects the latest Visit's depth as a Place-level fallback without writing it to Place. Legacy per-person contribution `level` values are no longer written or read. |
| `ord` / embedded `visit.order` | Replaced by the current User's date-specific day-order document. |
| `status` / wishlist | Not copied or read. Visible Visits are product truth; Wishlist remains absent. |
| `visits`, `visitedOn` | Not copied to Place. Every occurrence is `visits/{visitId}`. |
| `tripId`, `categories` | Visit facts (`tripId`, `category`), not Place truth. |
| `who`, `whoMode` | Replaced by `Visit.participantUserIds`; no two-person mode. |
| `name`, coordinates, external ID, `admin`, region codes | Objective Place identity/cache and retained on `places/{placeId}`. |

## Runtime adapter and lifecycle

`src/no-space/` contains the schema, policies, contributions, day ordering, Trip defaults, projection helpers, and Firestore repository. The adapter projects top-level documents into the normalized Place/Visit representation consumed by existing map, filter, list, stay-anchor, and administrative-region code. Writes never round-trip through that projection: the No-Space editor and reorder actions call the new repository directly.

Every listener, editor, Google search, geography callback, and write captures the authenticated UID and session token that originated it. Logout/login invalidates the token, closes editors, tears down root and per-document listeners, and makes stale callbacks inert.

## Deferred work

Phase A intentionally excludes Friends, People/contact records, global User search, secret mentions, Exit Visit/Trip, Lock/fork, Saved Filters, Wishlist/Saved Places, photos, production rules, and production migration.
