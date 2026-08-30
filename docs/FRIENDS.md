# Friends (design contract)

> **Status: not implemented.** This document is the agreed contract for the
> Friends feature. No code, Firestore rule, or production data has changed as a
> result of writing it. The feature is built additively on top of the shipped
> No-Space architecture ([NO_SPACE_CORE.md](NO_SPACE_CORE.md)); it introduces no
> new container, does not touch the Place → Visit → Trip model, and performs no
> production data migration. The Firestore rules delta in
> [Rules delta](#firestore-rules-delta) must be reviewed and deployed by the
> operator like any other rule change (it rides along with the pending
> `validVisit` `level` fix).

## Why this exists

Today the client can only address a person it has **already shared history
with**. `knownParticipantUserIds(currentUserId, visits, trips)`
(`src/no-space/visits.js`) derives the participant directory from the
authenticated user plus every `participantUserIds` entry on visible Visits and
Trips. [NO_SPACE_CORE.md](NO_SPACE_CORE.md#participant-directory) states this
plainly: *"A User with no shared history can therefore create only solo Visits
in Phase A."* Friends, contact records, and global user search are listed as
deferred work.

Friends closes exactly that gap: a per-user address book of other users, keyed
by their Firebase UID, that feeds the **existing** participant directory,
pickers, colouring, legend, and filters. Everything downstream of the directory
already handles an arbitrary-N participant set and needs no change.

## What does **not** change

- The Visit / Trip / Place documents and their schemas
  (`src/no-space/schema.js`).
- `participantUserIds` semantics: still an arbitrary UID set; adding a friend to
  a Visit or Trip is the same write it is today.
- The Visit and Trip participant pickers ([main.js](../src/main.js) `ns_participants`,
  `nst_participants`), marker/legend colouring (`participantColorIndex`),
  participant filter, and `resolveVisitParticipants` precedence.
- Trip → Visit participant defaulting: `visitParticipantsFromTrip()` already
  seeds a new Visit from its Trip's participants and remains editable. "Set a
  Trip's companions, and its Visits default to them" is **already shipped** — it
  only lacked a way to name companions you had not travelled with yet.
- The bidirectional "it shows up on their list too" behaviour: Visits are
  queried `participantUserIds array-contains uid`, so a tagged friend's client
  already loads the Visit and can add their own contribution. Friends does not
  add a sync path; it only makes the person selectable.
- `knownParticipantUserIds` in `src/no-space/visits.js` keeps its exact
  signature — it is shared with the migration tool and its tests. Friend UIDs
  are unioned in at the two `main.js` call sites, never inside the pure helper.

## Data model

### `users/{uid}/friends/{friendUid}`

One document per friend, owned entirely by `{uid}`. `{friendUid}` is the
friend's Firebase UID and must pass `assertDocumentId` (Firebase UIDs are
path-safe; validate anyway).

| Field | Type | Meaning |
| --- | --- | --- |
| `nickname` | string | Private label the owner sets. `""` means "use their profile `displayName`". Never shared with the friend (the doc lives under the owner's user path). |
| `pinned` | bool | `true` floats the friend to the top of companion pickers. Default `false`. |
| `state` | string | `"linked"` in Batch 1 (no handshake). Batch 3 adds `"pending_out"` (request sent, not yet accepted). Any other value is treated as `"linked"` on read. |
| `createdAt` | timestamp | `serverTimestamp()` at creation. Audit only; never used for ordering companions. |

No other keys are permitted (`hasOnly` in the rule).

### Friend vs. participant — two independent concepts

- A **friend** is an entry in *your* `users/{you}/friends` collection. It exists
  so you can pick that person; it says nothing about any Visit.
- A **participant** is a UID in a Visit's or Trip's `participantUserIds`. It
  records who was actually there.
- Removing a friend never edits any `participantUserIds`. Past Visits you shared
  with that person still list them (resolved as a normal known participant via
  shared history, or — if you never shared a Visit — they simply stop appearing
  in your picker). This mirrors the existing "historical participant" rule:
  membership churn never rewrites records.
- Being on a Visit together does **not** auto-create a friend entry. The client
  may *suggest* `knownParticipantUserIds − friends` as "people you've travelled
  with — add them?" (Batch 2), but the user chooses.

## How friends merge into the participant directory

Two integration points, both single computed sets in `main.js`:

1. **Reference listeners** — [`syncNoSpaceReferenceListeners`](../src/main.js)
   builds `profileIds` from `knownParticipantUserIds(...)`. Union friend UIDs in
   so each friend's `users/{uid}` profile (displayName, photoURL) gets a
   listener.
2. **`participantMembers`** — the projection in `subscribeNoSpace`'s refresh
   builds `participantMembers` from `knownParticipantUserIds(...)`. Union friend
   UIDs in, deduped by UID. A friend entry produces
   `{ status:"active", valid:true, source:"friend" }` so it satisfies
   `activeParticipantMembers()` (`valid === true && status === "active"`) and
   therefore appears in every picker. A UID that is both a friend and a shared
   participant appears once, with `source:"friend"`.

New plumbing required:

- `noSpaceState.friends` — map keyed by `friendUid`, populated by a new
  `repository.listenFriends(next, error)` on `users/{me}/friends`, torn down and
  rebuilt per auth change like the other primary listeners.
- `friendUserIds()` accessor in `main.js` reading `noSpaceState.friends`.
- Repository writes: `addFriend(friendUid)`, `removeFriend(friendUid)`,
  `setFriendNickname(friendUid, nickname)`, `setFriendPinned(friendUid, pinned)`.

## Name resolution

`participantName(uid)` gains one rule, checked before the profile `displayName`:

1. `uid` is the authenticated user → unchanged (`真實名稱（我）` / `我`).
2. `uid` has a friend entry with a non-empty `nickname` → the nickname.
3. otherwise → unchanged (profile `displayName`, then `已離開` / `未知同行者`
   fallbacks).

A raw UID is still never displayed.

## Picker ordering

`orderedActiveMembers()` currently sorts self first, then by display name.
New order:

1. the authenticated user
2. pinned friends, by resolved name
3. everyone else, by resolved name

This one change covers both the Visit editor and the Trip editor, which both
call `orderedActiveMembers()`.

The participant **filter** dropdown (`participantFilterCandidateIds()`) will now
also include friends with no shared Visits. That is harmless but slightly noisy;
Batch 2 may restrict the filter list to UIDs actually referenced by loaded data.

## Invitation / handshake (Batch 3)

Batch 1 has **no consent step**: `addFriend` immediately writes
`users/{me}/friends/{friendUid}` with `state:"linked"`. It is a one-directional
address-book entry. The friend is not notified and gets no reciprocal entry; the
existing array-contains query still delivers any Visit you tag them in.

Batch 3 adds a mutual handshake via a top-level `friendRequests` collection:

| Field | Type | Meaning |
| --- | --- | --- |
| `from` | string | requester UID |
| `to` | string | target UID |
| `state` | string | `"pending"` → `"accepted"` / `"declined"` |
| `createdAt` | timestamp | audit |

Flow:

1. `A` adds `B` → `A` creates `friendRequests/{autoId}` (`from:A, to:B,
   state:"pending"`) and writes `users/A/friends/B` with `state:"pending_out"`.
2. `B`'s client queries `friendRequests where to == B && state == "pending"`,
   shows it on the management page.
3. `B` accepts → `B` writes `users/B/friends/A` (`state:"linked"`) and sets the
   request `state:"accepted"`.
4. `A`'s client observes `state:"accepted"`, promotes `users/A/friends/B` to
   `state:"linked"`, and deletes the request. Decline just sets
   `state:"declined"`; `A` removes the `pending_out` entry.

`pending_out` friends are shown on the management page but are **not** offered in
companion pickers.

## Firestore rules delta

### Batch 1 — friends subcollection

`users/{uid}` currently matches only `dayOrders/{date}` beneath it; anything
else under a user document falls through to the global `deny`. Add:

```
match /users/{uid}/friends/{friendUid} {
  allow read, delete: if signedIn() && request.auth.uid == uid;
  allow create, update: if signedIn() && request.auth.uid == uid
    && request.resource.data.keys().hasOnly(['nickname','pinned','state','createdAt'])
    && (!('nickname' in request.resource.data) || request.resource.data.nickname is string)
    && (!('pinned' in request.resource.data) || request.resource.data.pinned is bool)
    && (!('state' in request.resource.data) || request.resource.data.state in ['linked','pending_out']);
}
```

This block is **implemented** in `firestore.no-space.rules` and awaits the same
operator deploy as the pending `validVisit` `level` fix.

No change is needed to look a user up by ID: `users/{uid}` already allows
`get: if signedIn()`.

### Batch 3 — friend requests

```
match /friendRequests/{requestId} {
  function party() { return request.auth.uid in [resource.data.from, resource.data.to]; }
  allow get, list: if signedIn() && party();
  allow create: if signedIn()
    && request.resource.data.from == request.auth.uid
    && request.resource.data.to is string
    && request.resource.data.state == 'pending'
    && request.resource.data.keys().hasOnly(['from','to','state','createdAt']);
  allow update: if signedIn()
    && request.auth.uid == resource.data.to
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state'])
    && request.resource.data.state in ['accepted','declined'];
  allow delete: if signedIn() && party();
}
```

The rules test `tests/firestore-no-space.rules.test.mjs` gains coverage for both
blocks (owner allowed, third party denied; requester cannot pre-set
`accepted`; only `to` can accept).

## Privacy

- `users/{uid}` is readable by any signed-in user who knows the UID
  (`allow get: if signedIn()`, `list` denied). Friends does not widen this:
  UIDs are 28-char random and unlistable. A future human-friendly "share code"
  would need a separate lookup collection and is out of scope.
- A friend entry (nickname included) lives under the **owner's** user path and
  is unreadable by the friend. Nicknames never leak.
- Co-participants already see each other's names and contributions on a shared
  Visit; Friends adds nothing there.

## Phasing

| Batch | Deliverable | Rules | Behaviour change |
| --- | --- | --- | --- |
| **0** | This document. | — | none |
| **1** | `users/{uid}/friends` storage, `noSpaceState.friends` listener, repository `addFriend`/`removeFriend`/`setFriendNickname`/`setFriendPinned`, directory union at both call sites, `participantName` nickname rule, minimal "add by ID" UI in the profile modal. | friends subcollection block | friends selectable in Visit/Trip pickers without shared history |
| **2** | Friend management page: nickname editing, pin/unpin, remove, "people you've travelled with" suggestions; `orderedActiveMembers()` pinned-first ordering. | — | new page; picker order |
| **3** | `friendRequests` collection, mutual handshake, incoming/outgoing lists, `pending_out` state. | friendRequests block | consent step before a friend is mutual |
| **4** | Show own UID for sharing; optional filter-list tidy-up. | — | minor |

## Pure helpers to extract and test (Batch 1)

Land these in a new `src/friends.js` (Firebase-free) with `tests/friends.test.mjs`
(auto-discovered by `tests/run.mjs`, no runner change):

- `normalizeFriendDoc(friendUid, raw)` → `{ friendUid, nickname, pinned, state }`;
  coerces types, clamps unknown `state` to `"linked"`, rejects a bad
  `friendUid`.
- `resolveParticipantName(uid, { selfUid, selfName, profileName, nickname, status })`
  → the precedence in [Name resolution](#name-resolution). `participantName`
  becomes a thin wrapper.
- `mergeFriendIdsIntoDirectory(knownIds, friendIds)` → deduped, sorted union.
- `orderMembersForPicker(members, { selfUid, isPinned })` → self, pinned, rest.
- `friendRequestTransition(request, action, actorUid)` (Batch 3) → next `state`
  or an error, pure.

## Related documents

- [NO_SPACE_CORE.md](NO_SPACE_CORE.md) — architecture, Firestore paths,
  participant directory, deferred-work list.
- [DATA_MODEL.md](DATA_MODEL.md) — projected shape, participant resolution
  precedence.
- [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md) — listener/projection flow
  that `noSpaceState.friends` plugs into.
- `firestore.no-space.rules` — candidate rules the delta above extends.
