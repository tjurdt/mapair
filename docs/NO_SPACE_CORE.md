# No-Space Core — Phase A

## Status and safety boundary

No-Space Core is a parallel, local-Emulator-only architecture. It activates only at an exact localhost/loopback URL containing `?firebaseEnv=local&noSpace=1`. It cannot run in production, and it fails startup if `multiSpace=1` is also present. The existing fixed-Space production runtime and LOCAL multi-Space harness remain available and unchanged outside this gate.

This phase performs no production migration, rule deployment, data copy, or deletion. Space remains a legacy compatibility architecture pending a separately reviewed migration.

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

- Place reference and optional display override;
- date;
- activity/category;
- participants;
- stay kind and checkout date;
- optional Trip reference.

Personal facts/state are:

- rating;
- memory (the product-facing replacement for legacy “review”);
- visit-depth assessment (`level` compatibility concept);
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

The client queries top-level `visits` and `trips` with `participantUserIds array-contains authenticatedUid`. A participant can edit shared facts. In Phase A only `createdBy` can delete the whole Visit or Trip; `createdBy` is solely destructive-action protection and is not a permission role. The current User cannot remove their own UID as an ersatz Exit operation.

### Place resolution

The Visit query yields Place IDs. The client attaches one document listener per referenced `places/{placeId}` instead of enumerating every global Place. Multiple visible Visits to the same Place are projected into one geographic marker while remaining separate occurrences in filtering and history. Administrative cache writes update only objective Place cache fields.

### Participant directory

The client derives known UIDs from the authenticated User plus participants on visible Visits and Trips. It reads those exact `users/{uid}` documents individually. It never lists the `users` collection and provides no global search. A User with no shared history can therefore create only solo Visits in Phase A.

## Contributions and ratings

Each User writes only `visits/{visitId}/contributions/{theirUid}`. Editing one contribution cannot replace another participant's document. Other contributions are shown read-only to Visit participants. The average is computed at read time over submitted numeric ratings only; missing ratings are excluded and no average is stored.

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

`trips/{tripId}.participantUserIds` defines defaults for future Visits created in that Trip. The array is copied into a new Visit and remains editable there. Updating Trip defaults never rewrites an existing Visit. Phase A prevents the current User from removing themselves from a Trip because explicit Exit semantics are deferred.

## Legacy Place-field decisions

| Legacy Place field | No-Space Phase A decision |
| --- | --- |
| `rating` | Personal `Visit` contribution `rating`; never global Place data. |
| `review` | Renamed “memory” and stored in the personal Visit contribution. |
| `level` | Treated as a subjective visit-depth assessment and stored as personal contribution `level`; runtime map compatibility may project the current User's value without writing it to Place. |
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

