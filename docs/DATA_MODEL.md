# Current Data Model

> This file documents the retained **legacy Space model** used for rollback and migration input. On the v0.3 release branch, production runtime defaults to the top-level No-Space model documented in [NO_SPACE_CORE.md](NO_SPACE_CORE.md). No production data has been migrated or deleted by development work.

This document records the deployed-compatible data model implemented by the current application. Phase 1 additionally supports read-only, additive root Space and Membership documents when present, but it does not require them, migrate existing data, or implement the complete target model.

## Storage layout

All shared data is under `spaces/{spaceId}`:

```text
spaces/{spaceId}/places/{placeId}
spaces/{spaceId}/trips/{tripId}
spaces/{spaceId}/meta/config
```

The application adds Firestore document IDs as in-memory `id` fields after reading documents.

The active application Space in production remains the single Space selected by runtime configuration. It is represented in memory as `currentSpaceId` (`us` in production). Production has no Space discovery, switching, Personal Space provisioning, or local active-Space preference — none of the Phase 3 surfaces are exposed there.

LOCAL TEST additionally accepts a strict development/test harness parameter, `?firebaseEnv=local&testSpace=group`, which selects `test-space-group` from a fixed two-entry allowlist (`baseline` → `test-space-baseline`, `group` → `test-space-group`). It is localhost-only, rejects unknown or duplicate values, fails closed in production, and never accepts an arbitrary Firestore Space ID. It is not a Space switcher.

## Phase 3 — Personal Space and Space switcher (LOCAL only)

Phase 3 is gated behind `?firebaseEnv=local&multiSpace=1` (localhost only, exactly `multiSpace=1`, rejects duplicate/unknown values, fails closed and never modifies config anywhere but LOCAL TEST). Production multi-Space support stays non-public until Phase 6 Membership-based Firestore rules exist. Without the flag every prior LOCAL workflow — including `?firebaseEnv=local` fixed-Space baseline testing that needs no formal Memberships — is unchanged.

**Personal Space.** A Personal Space is one ordinary Space (`spaces/{id}` + `spaces/{id}/members`, `/places`, `/trips`, `/meta/config`) owned and managed by exactly one User; it is not a cross-Space aggregate and Visits are never copied into it. Every User has exactly one. It is discovered by `Space.type === "personal"` + `Space.ownerId === uid` + an active owner Membership — the discovered Space's stored ID is used as-is (fixtures do not use the deterministic ID). If none exists it is provisioned at the deterministic, path-safe ID `personal-${encodeURIComponent(uid)}` (never shown in normal UI) via one idempotent Firestore transaction that creates the root and the single owner Membership, refuses to overwrite a Shared Space or a foreign-owner document, and never uses `merge` to hide a conflict. More than one valid Personal Space fails closed with a LOCAL diagnostic. A Personal Space stays one-member in v0.2; sharing means creating a Shared Space.

**Discovery.** `collectionGroup("members").where("userId","==",uid).where("status","==","active")` — one authenticated-User listener that outlives Space switches and is torn down on logout / auth change. Each result's parent `spaceId` is derived from the path and its root Space document fetched. Malformed Memberships (document ID ≠ `userId`, non-`owner`/`member` role, non-`active` status) and missing/invalid roots are excluded from the switcher and reported only in LOCAL diagnostics. Access is never inferred from Friendship, Visit/Trip participants, or `createdBy`. The Firestore Emulator serves this query unindexed; `firestore.indexes.json` declares the `members` `(userId, status)` collection-group composite index for the eventual (separately approved) Phase 6 deployment.

**Active-Space preference.** `localStorage` key `mapair.activeSpace.v1:<projectId>:<uid>` — scoped by Firebase project/environment AND UID so accounts never share one active Space. Only written after confirming active Membership; an inaccessible saved value is ignored and replaced by the Personal Space. Storage failure never crashes the app.

**Initial active Space** after sign-in: (A) an explicitly requested, accessible LOCAL `testSpace` — an explicit-but-inaccessible `testSpace` is a LOCAL TEST failure, never a silent fallback; (B) an accessible saved preference; (C) the Personal Space; (D) otherwise fail closed. A new User is never defaulted into every Shared Space.

**Switch lifecycle.** One controlled `switchActiveSpace(spaceId)`: verify accessibility → close editors/modals/search suggestions, disable add-mode → unsubscribe all current-Space listeners → mint a fresh `spaceSession` token → clear every Space-scoped slice (`places`, `trips`, `spaceCats`, members/nicknames/colours, `currentSpace`/`currentMembership`/directory/removed Members, referenced historical participants, markers, admin/proximity layers + caches, editor write queues) → reset data-bound filters (`who`/`tripId`/`cats`/`regions` cleared, `dateScope="month"`, `tab="visited"`) while keeping visual prefs (marker mode, pins, layout collapse, proximity radius) → activate the new Space, save the preference, show a loading/empty state, then resubscribe.

**Stale-session protection.** A monotonic `spaceSession` (`{ spaceId, version }`, a new object per switch). Every current-Space subscription and every Space-bound async callback (Places search, nearby search, reverse geocode, admin cache writes, editor autosave queues) captures the session in force when it started; a callback whose captured session is no longer current does not apply its result. Every deferred write also captures its originating Space ID and targets it through a `*For(spaceId)` path helper, so a queued write from Space A can never land in Space B.

**Revised 2 hardening.**

- *Ordered discovery.* Each discovery snapshot is stamped with a monotonically increasing request version alongside the listener generation and the authenticated UID. After every `await`, a result is applied only if the listener generation is current, the UID is unchanged, **and** the snapshot's request version is still the newest — so slow async snapshots can never apply out of order and resurrect a removed Space.
- *Root reads fail closed.* A Space-root `getDoc` that **rejects** is never treated as "root missing". Only a successful read that reports non-existence counts as genuinely missing; a read failure aborts the whole discovery cycle with a LOCAL diagnostic and never lets provisioning create a duplicate Personal Space.
- *Exact membership path.* `collectionGroup("members")` can match any `members` collection; a discovered Membership is trusted only when its document path is exactly `spaces/{spaceId}/members/{uid}` for the authenticated UID (`resolveSpaceMembershipPath` in `src/spaces.js`). Anything else is rejected and only diagnosed.
- *Stale listener errors / auth teardown.* Every current-Space `onSnapshot` error callback (space root, members, places, trips, meta) ignores errors once its Space session is stale; the discovery listener's error callback is guarded by generation + UID. On logout / auth change the Space session is invalidated (`nextSpaceSession(spaceSession, "")`) and the in-flight discovery request is bumped **before** old listeners are torn down.
- *Search session capture.* Google autocomplete captures the Space session and a request generation **before** `searchPlace()` runs; a switch or a newer keystroke invalidates the result, and the check is repeated after `fetchFields()` and `reverseGeocode()` before an editor is opened.
- *Write queue not blindly cleared.* `placeEditorWriteQueues` is **not** cleared on a Space switch — clearing the Map would abandon running Promise chains without cancelling them. Each entry removes itself via its own `.finally`, so a returned-to Space still serializes behind any unresolved write for the same `${spaceId}:${placeId}`.
- *Stronger discovered-Space validation.* `normalizeDiscoveredSpace()` also rejects: a root with no usable `ownerId`; a Personal Space discovered only as `member`; a Personal Space whose `ownerId` ≠ the Membership UID; an `owner` Membership whose UID ≠ `Space.ownerId`; and `Space.ownerId === Membership UID` while the role is not `owner`.

**Shared Space creation** (`＋ 新共享地圖`): asks only for a name, then one transaction creates `spaces/{autoId}` (`type: "shared"`) and the creator's single active owner Membership, then switches to it. No second Member; no invitation UI (Phase 5). No Personal → Shared conversion.

**Not in Phase 3:** Trip participant defaults (`Trip.participantIds`) — Phase 4; Friends/invites/mentions/member-management UI — Phase 5; production rules/migration/exposure — Phase 6. In the legacy Space plan, **"我的足跡" / My Footprints** was reserved as a separate cross-Space surface and not a Personal Space. No-Space Phase A now implements the participant-scoped top-level Visit view under that title through a distinct LOCAL-only gate; it still does not move or copy `spaces/us` history.

## Optional Phase 1 Space and Membership documents

The application can now also read these additive paths:

```text
spaces/{currentSpaceId}
spaces/{currentSpaceId}/members/{uid}
```

The optional root Space currently supports `name`, `type`, `ownerId`, `createdBy`, and `createdAt`. A formal Membership supports `userId`, `role`, `status`, `displayNameSnapshot`, optional `photoURLSnapshot`, `joinedAt`, and optional `removedAt`.

These documents are not created, updated, or repaired by normal application startup, and are not required in production or in fixed-Space LOCAL modes. Existing production data may omit them. The one exception is Phase 3 LOCAL multi-Space mode, which creates a root Space document and a single active owner Membership when provisioning a Personal Space or creating a Shared Space (see above) — always transactional, never a repair, never `merge`. When both formal areas are absent, the client constructs temporary compatible Members in memory from `spaces/{currentSpaceId}/meta/config.members` and nicknames. Existing content remains at its current paths and is not moved.

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
| `status` | Legacy field. New/updated Visit-bearing Places may still carry `status:"visited"` as a mixed-client compatibility mirror, but no normal domain behaviour depends on it. Dormant legacy `status:"wishlist"` documents (see below) may still exist but are ignored everywhere. No new value is introduced and no field is physically removed. |
| `level` | Shared visit depth: `經過`, `接地`, `旅遊`, `住宿`, or `居住`. |
| `rating` | Shared Place rating, from 0.5 through 5 in 0.5 steps; absent/null means unrated. |
| `review` | Shared free-text review. |
| `visits` | Embedded Visit array for visited Places. This is the canonical current visit history. |
| `createdBy` | UID of the creator. |
| `createdAt` | Firestore server timestamp used for collection ordering and fallback list ordering. |
| `ord` | Legacy ordering value on old wishlist documents. Not written by current code. |
| `countyCode`, `townCode`, `villCode` | Cached point-in-polygon administrative identifiers. |

### Place lifecycle

A Place exists in the active product **only because it has real Visit history** — a non-empty embedded `visits` array, or (read compat) a legacy `visitedOn` date. The central `hasVisitHistory(place)` gate encodes this and is applied before a Place appears in the list, on the map, in participant/category filters, in statistics/counts, or in administrative and proximity coverage.

Creating a Place always creates its first Visit at the same time (Phase 2 new-Visit defaults). Deleting a Place's **last** remaining Visit deletes the whole Place document — the code never writes an empty active Place and never downgrades a Place to `status:"wishlist"`. Deleting one of several Visits just rewrites the `visits` array.

### Legacy wishlist documents (removed feature)

The "想去 / wishlist" feature has been removed. Legacy documents with `status:"wishlist"`, `visits:[]`, and `visitedOn:""` may still be present in Firestore. They are **dormant**: `hasVisitHistory` returns false for them, so they are invisible in every normal surface and are never used as an administrative or proximity seed. This change performs **no production data migration** — no bulk delete, no startup migration, no field erasure. A separately approved migration may clean them up later. `findExistingPlace()` still detects such a document by `extId` / normalized name / location, so if a member explicitly searches for that Place and records a Visit, the existing document is reused and becomes normal Visit-bearing data through that explicit action.

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

Category, Trip, and participants are canonical at Visit level. Rating, review, depth, identity, and coordinates remain canonical at Place level.

### Visit participant resolution (Phase 2)

Participants are arbitrary active or removed Space Members, not a fixed
`me` / `partner` / `both` model. The domain resolves a Visit's participants in
this precedence:

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
| `categories` | Latest Visit category, mirrored to Place level. Its first value is the Visit category fallback. |
| `who` | Latest Visit participants, mirrored to Place level. Full arbitrary-Member UID array (no longer capped at two). |
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
