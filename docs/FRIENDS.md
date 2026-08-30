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

The participant **filter** dropdown (`participantFilterCandidateIds()`) is
`active member ids + referencedHistoricalIds`, so after the Batch 4 tightening it
still lists everyone relevant: self, linked friends, and any non-friend
co-traveller actually referenced by loaded Visits/Trips.

## Invitation / handshake (Batch 3, implemented)

Batches 1–2 had **no consent step**: `addFriend` wrote `users/{me}/friends/{uid}`
straight to `state:"linked"`. Batch 3 replaces that with a mutual handshake over a
top-level `friendRequests` collection. Existing `linked` entries (created before
Batch 3) are untouched — only new adds go through the request flow.

`friendRequests/{from}__{to}` (deterministic id, one per ordered pair):

| Field | Type | Meaning |
| --- | --- | --- |
| `from` | string | requester UID |
| `to` | string | target UID |
| `state` | string | `"pending"` → `"accepted"` / `"declined"` |
| `createdAt` | timestamp | audit |

Flow:

1. `A` adds `B` (`sendFriendRequest`) → one batch: create `friendRequests/A__B`
   (`state:"pending"`) **and** `users/A/friends/B` with `state:"pending_out"`.
   If `A` already has an incoming `pending` request from `B`, `addFriend`
   auto-accepts instead of sending.
2. `B`'s client lists `friendRequests where to == B`; the manager shows pending
   ones under "好友邀請", and the 👥 button carries a count badge.
3. `B` accepts (`acceptFriendRequest`) → one batch: `users/B/friends/A`
   `state:"linked"` **and** request `state:"accepted"`. Decline sets
   `state:"declined"`.
4. `A`'s outgoing-request listener runs `reconcileFriendRequests()`:
   `accepted` → `finalizeAcceptedRequest` (promote `users/A/friends/B` to
   `linked`, delete the request); `declined` → `discardOutgoingRequest` (delete
   the marker and the request). A guard set stops a snapshot burst re-firing the
   same write.

`pending_out` markers appear in the manager's "邀請中（待對方確認）" section
(with a cancel action) but are held out of the companion pickers —
`friendUserIds()` / `friendPinnedUids()` filter `state === "linked"`.

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

Doc id is `"{from}__{to}"` (deterministic — one request per ordered pair, no
`addDoc`). `party()` uses `resource.data.get(...)` so a `get` of a missing doc or
a `list` phantom resolves to a clean deny instead of an evaluation error.

```
match /friendRequests/{requestId} {
  function party() {
    return signedIn()
      && (resource.data.get('from', '') == request.auth.uid
        || resource.data.get('to', '') == request.auth.uid);
  }
  allow get, list: if party();
  allow create: if signedIn()
    && request.resource.data.from == request.auth.uid
    && request.resource.data.to is string
    && request.resource.data.to != request.auth.uid
    && request.resource.data.state == 'pending'
    && request.resource.data.keys().hasOnly(['from','to','state','createdAt']);
  allow update: if signedIn()
    && request.auth.uid == resource.data.to
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['state'])
    && request.resource.data.state in ['accepted','declined'];
  allow delete: if party();
}
```

### Batch 4 — public short codes

`friendCodes/{code}` → `{ uid }`. A 6-char handle over an unambiguous alphabet
(`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, no `0/O/1/I/L`) so people can be added
without pasting a 28-char UID. Codes are **permanent** (claimed once) and **not
secret** — resolving one only yields a UID, which still needs a friend request.

```
match /friendCodes/{code} {
  allow get: if signedIn();
  allow list: if false;
  allow create: if signedIn()
    && request.resource.data.keys().hasOnly(['uid'])
    && request.resource.data.uid == request.auth.uid;
  allow update, delete: if false;
}
```

`repository.ensureFriendCode()` allocates one in a transaction (retry on a claim
collision) and mirrors it to `users/{uid}.friendCode` for display;
`repository.uidForFriendCode(code)` resolves an entered code. No `users/{uid}`
rule change is needed — that doc already allows the owner any field.

All four blocks (friends, friendRequests, friendCodes) are **implemented** in
`firestore.no-space.rules` and covered by
`tests/firestore-no-space.rules.test.mjs` (owner allowed, third party denied;
`from`/`uid` cannot be spoofed; requester cannot pre-set `accepted`; only `to`
can answer; codes are not enumerable or mutable). They await the same operator
deploy as the pending `validVisit` `level` fix.

## Unfriending

Removing a friend (or never having been friends) must **not** let one person
keep injecting shared records into the other's account. The rule:

- **Selectable = self + currently-linked friends only.** `participantMembers`
  now carries a `selectable` flag; `activeParticipantMembers()` (and therefore
  every companion picker) filters on it. `knownParticipantUserIds` still feeds
  name resolution and the participant filter, but a co-traveller who is not a
  linked friend is a **non-selectable historical member** — their name resolves,
  they stay on records they are already on, they cannot be added to new ones.
- **Existing shared Visits are frozen, not rewritten.** A former friend stays in
  `participantUserIds`; both people keep seeing the Visit. The Visit editor
  lists such people under "也在這次造訪：" with a one-way ✕ the creator can use
  to prune them (they cannot be re-added from that editor). Self-removal ("exit
  a Visit") stays a deferred Phase-A concern — neither side can remove *itself*.
- **Re-connecting needs consent again.** The manager's suggestions list still
  offers a former friend, but "送出邀請" there is a fresh friend request the
  other side must accept.

Backend note: Firestore rules can't fully enforce mutual consent — `A` cannot
read whether `B` has friended `A` back (that doc is under `B`'s user path). So
this is client-enforced; the `participant()` rule still lets any current
participant edit `participantUserIds`. A hard backend guarantee would need a
shared connection document both parties can read.

## Privacy

- `users/{uid}` is readable by any signed-in user who knows the UID
  (`allow get: if signedIn()`, `list` denied). The short code (Batch 4) is the
  same trust level: `friendCodes/{code}` is `get`-able by any signed-in user but
  not enumerable, and only yields a UID — never profile data or a friend link.
- A friend entry (nickname included) lives under the **owner's** user path and
  is unreadable by the friend. Nicknames never leak.
- Co-participants already see each other's names and contributions on a shared
  Visit; Friends adds nothing there.

## Phasing

| Batch | Deliverable | Rules | Behaviour change |
| --- | --- | --- | --- |
| **0** | ✅ This document. | — | none |
| **1** | ✅ `users/{uid}/friends` storage, `noSpaceState.friends` listener, repository `addFriend`/`removeFriend`/`setFriendNickname`/`setFriendPinned`, directory union at both call sites, `participantName` nickname rule, "add by ID" UI. Pinned-first `orderedActiveMembers()` ordering also landed here (it needs only Batch 1 data). | friends subcollection block | friends selectable in Visit/Trip pickers without shared history; picker order |
| **2** | ✅ Dedicated `openFriendsManager()` modal (👥 button in the map controls, plus a "管理好友" link in Settings): add by ID, nickname editing, pin/unpin, remove, and a "曾一起記錄、還沒加好友" suggestions section (`knownParticipantUserIds − self − friends`, one-tap add). The Batch 1 inline Settings section was removed in favour of this. | — | new manager page |
| **3** | ✅ `friendRequests/{from}__{to}` collection + `listenIncoming/OutgoingFriendRequests`. `addFriend` → `sendFriendRequest` (writes a `pending_out` marker + the request); if an incoming request already exists it auto-accepts. Manager gains "好友邀請" (accept/decline) and "邀請中（待對方確認）" (cancel) sections; 👥 button shows an incoming-count badge. `reconcileFriendRequests()` runs from the outgoing listener: on `accepted` it promotes the marker to `linked` and deletes the request, on `declined` it clears both. `pending_out` markers stay out of the pickers (`friendUserIds()` filters `state==="linked"`). | friendRequests block | consent step before a friend link is mutual |
| **4** | ✅ Public short codes (`friendCodes/{code}` + `ensureFriendCode`/`uidForFriendCode`); the manager shows "你的好友碼" and accepts a code or a UID in the add box. Unfriending hardened: `participantMembers.selectable` flag → pickers are self + linked friends only; former friends become non-selectable historical members; Visit editor gains a "也在這次造訪：" prune row. | friendCodes block | picker scoped to friends; short-code add |

## Pure helpers (`src/friends.js`, tested in `tests/friends.test.mjs`)

Firebase-free, auto-discovered by `tests/run.mjs`:

- `isPathSafeId(value)` — guards a pasted UID before it is used in a path.
- `normalizeFriendDoc(friendUid, raw)` → `{ friendUid, nickname, pinned, state }`;
  coerces types, clamps unknown `state` to `"linked"`, returns `null` for a bad
  `friendUid`.
- `validateFriendInput(rawValue, { selfUid, existingUids })` → `{ ok, friendUid }`
  or `{ ok:false, reason }` (`empty` / `invalid` / `self` / `duplicate`).
- `mergeFriendIdsIntoDirectory(knownIds, friendIds)` → deduped, sorted union.
- `orderMembersForPicker(members, { selfUid, pinnedUids })` → self, pinned, rest.
- `randomFriendCode()` / `normalizeFriendCode(v)` / `looksLikeFriendCode(v)` /
  `formatFriendCode(v)` — 6-char code generation, parsing (dash/space tolerant,
  alphabet-checked), and `ABC-D23` display formatting.

The nickname branch in `participantName` is inline (against `friendEntryOf`), not
a separate helper. The request state machine lives in the repository
(`acceptFriendRequest` / `reconcileFriendRequests`), not a pure helper.

## Related documents

- [NO_SPACE_CORE.md](NO_SPACE_CORE.md) — architecture, Firestore paths,
  participant directory, deferred-work list.
- [DATA_MODEL.md](DATA_MODEL.md) — projected shape, participant resolution
  precedence.
- [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md) — listener/projection flow
  that `noSpaceState.friends` plugs into.
- `firestore.no-space.rules` — candidate rules the delta above extends.
