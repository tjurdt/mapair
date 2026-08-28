# Multi-User Product and Data Design

## Status and scope

This document proposes Mapair's target multi-user product, data, and permission model. It does not describe the current implementation and does not authorize a production migration. The current schema remains documented in [DATA_MODEL.md](DATA_MODEL.md), and the reversible path from that schema is defined in [MULTI_USER_MIGRATION_PLAN.md](MULTI_USER_MIGRATION_PLAN.md).

The design keeps the existing Place, embedded Visit, and Trip relationships. It introduces Users, Spaces, Memberships, invitations, and friendships without moving the historical data already under `spaces/us`. It does not introduce a global Place database, a Visit subcollection, mentions, additional roles, production rule changes, or a separate storage architecture for personal maps.

## Current state and target state

| Concern | Current | Target |
| --- | --- | --- |
| Space selection | One configured `spaceId` | A User may belong to many Spaces and selects the active map |
| Space metadata | Settings and two-person identity data in `meta/config` | A root Space document plus formal Membership documents; compatible settings remain in place initially |
| People | `meta/config.members` and UI assumptions about the current user plus one other person | Arbitrary active and removed Space Members |
| Participants | `visit.who` rendered as `me`, `partner`, or `both` | Arbitrary participant UID arrays rendered as named Members |
| Personal history | No distinct Personal Space concept | Every User has a Personal Space using the same Place/Visit/Trip model |
| Shared history | One configured shared map | Any number of Shared Spaces, including two-member Spaces |
| Navigation | No Space switcher | A switcher answers “Which map am I viewing?” |
| Permissions | No formal Membership documents; access depends on externally deployed, hard-coded assumptions | Active Membership is the source of truth for Space access |
| Joining | No general invitation model | Direct and secure share-link invitations |
| Social graph | No friendship model | Friendship supports discovery and inviting but grants no Space access |

## Product vocabulary

### User

A User is a real Mapair account/person, identified internally by an authenticated UID. A User may belong to many Spaces and may have friendships with other Users. A User profile is for identity and display only; it is not a Space permission record.

Store only information needed by the product, such as:

- `displayName`
- `photoURL`
- `createdAt`
- a future optional username or handle

Do not copy sensitive or unrelated authentication-provider profile data into Firestore.

### Friendship

A Friendship is a social and discovery relationship between two Users. It makes a person easier to find when sending a Space invitation and could support future social features.

Friendship never grants access to a Space. People do not need to become friends before joining a Space. Removing a Friendship has no effect on either person's Memberships or on historical Trip and Visit participants.

### Space

A Space is Mapair's primary data and permission boundary: one map/history universe. A Space owns its Places, Trips, Visits through Places, settings, and future photos or memories. A Space may be personal or shared.

A couple is not a special product concept or schema. It is simply a Shared Space with two Members.

### Membership

A Membership is the relationship between a User and a Space and is the source of truth for access. The initial roles are only:

- `owner`
- `member`

Do not introduce `viewer`, `admin`, or `moderator` roles in this version.

Memberships have `active` or `removed` status instead of being erased when a person leaves. A removed Member immediately loses access, but the retained Membership and display snapshots allow historical Trip and Visit participants to remain named. Reactivating a former Member should update the existing Membership rather than create a second identity for the same UID.

### Place

A Place is a stable geographic entity inside exactly one Space. It continues to own shared location metadata and its embedded Visits. The same real-world Google Place may exist independently in multiple Spaces, even when both records have the same Google Place ID.

This migration does not create a global shared Place database and does not move Places between Spaces automatically.

### Trip

A Trip belongs to exactly one Space. It groups Visits through `Visit.tripId`; it does not own or duplicate Places or Visits.

A Trip adds `participantIds: UID[]` as its default participant selection. Trip participation is descriptive, not permission-bearing. Every active Space Member can see the whole Space whether or not that person participated in a particular Trip.

### Visit

A Visit is one dated occurrence at a Place. Its participants record who actually took part in that occurrence.

When a Visit is created in a Trip, the Trip's `participantIds` provide an editable default. Changing the participants of one Visit does not change the Trip defaults or any other Visit. A Visit's participants are historical facts; the Trip participant list is only a creation convenience.

## Product invariants

1. Friendship is not permission.
2. Membership is the source of Space permission.
3. A Space Member is not necessarily a Trip participant.
4. A Trip participant is not necessarily a participant in every Visit.
5. Trip participants are defaults; Visit participants are historical facts.
6. Removing a Member does not rewrite history.
7. A couple has no special schema.
8. Personal and Shared Spaces use the same core storage model.
9. A Place belongs to a Space, not globally to a User.
10. Existing historical data under `spaces/us` stays in place.
11. Future photos and memories inherit Space permissions.
12. Future multi-country geography must not depend on the old two-person model.

## Human-centered behavior

### First sign-in

On the first successful sign-in, a new User receives one Personal Space named “My Map” or its localized equivalent, such as “我的地圖”. It initially contains one active Membership: that User as `owner`.

Provisioning should be idempotent. Retrying after a partial network failure must find or finish the same personal Space rather than create duplicates. The UI should speak about maps and people; internal UIDs, Membership document IDs, and similar engineering terminology must not be exposed to ordinary users.

### Space switcher

The switcher answers the user-facing question “Which map am I viewing?” It shows the current map name and lets the User choose among personal and shared maps, for example:

```text
我的地圖

共同地圖
  Amy 和我
  家庭旅行
  大學朋友

+ 建立共同地圖
```

The active Space is a device-local UI preference, not shared product data. It may be stored in `localStorage`. At startup, the client must validate the stored Space against the User's current active Memberships. If it is no longer accessible, choose a safe accessible default, normally the Personal Space.

Changing Spaces must tear down the prior Space's listeners and clear Space-scoped state before attaching new listeners. Places, Trips, filters, editor state, map selections, and asynchronous results from the old Space must never bleed into the new one.

### Existing Mapair data

The current `spaces/us` data is upgraded in place to the first formal Shared Space. Do not move or copy its existing:

- `places`
- `trips`
- `meta/config`

Create the new root `spaces/us` metadata document and formal Membership documents around those existing subcollections. The current primary User becomes `owner`; the current other User becomes `member`. The exact Space display name can be chosen later. Both Users may also receive new, empty Personal Spaces. All existing shared history remains only in `spaces/us`.

### Creating a Shared Space

The user-facing flow is:

1. Choose “Create shared map”.
2. Give the map a name.
3. Optionally invite people.
4. Open the new shared map.

Creation must atomically establish the Space and the creator's active owner Membership, or be safely retryable without leaving an ownerless Space. Inviting is optional and does not block opening the new map.

### Friends and invitations

An existing Friend is easy to select as a direct invitee. A person who is not a Friend can still join using a secure invitation link. The product must not require Friendship before Membership.

An invitation is pending access, not access itself. The invitee gains access only after authenticated acceptance creates or reactivates that person's own Membership.

### Trip participant defaults

The Trip editor eventually lists arbitrary active Space Members, for example:

```text
Participants
☑ Me
☑ Amy
☐ David
☐ Kevin
```

The selected UIDs become the default for new Visits in that Trip. Existing Visits remain unchanged if Trip defaults are edited.

### Daily Visit defaults

For a Visit without a Trip:

- The first default is the currently authenticated User.
- Later Visit creation may reuse the last participant choice in that Space as a local convenience.
- The default must never silently select every Member of a large Space.

The last selection must be scoped by Space. A choice made in one Space must not become the default in another.

### Removing a Member or Friend

Removing Amy from a Space immediately changes Amy's Membership to `removed` and revokes access. It does not remove Amy's UID from historical Trip or Visit participant arrays. Current Members can still resolve the retained Membership snapshot and render “Amy”.

Removing a Friendship changes only the social relationship. It does not affect Memberships, Trips, or Visits.

### Mentions

Mentions are not part of this migration. If introduced later, candidate people should come from current active Space Members, not from the User's entire Friends list. Friendship only makes inviting someone into the Space easier.

## Proposed Firestore model

```text
users/{uid}

spaces/{spaceId}
spaces/{spaceId}/members/{uid}
spaces/{spaceId}/places/{placeId}
spaces/{spaceId}/trips/{tripId}
spaces/{spaceId}/meta/config

spaceInvites/{inviteId}
friendships/{stablePairId}

# Possible later addition; not part of this migration
usernames/{normalizedUsername}
```

The Membership document ID is the User's UID. This makes lookups deterministic and prevents duplicate Membership documents for one User in one Space. UIDs remain internal and should not be shown in normal UI.

### User profile fields

| Field | Meaning |
| --- | --- |
| `displayName` | Current product display name. |
| `photoURL` | Optional avatar URL. |
| `createdAt` | Server timestamp for profile creation. |
| `username` | Optional future handle; do not add until uniqueness and discovery are designed. |

### Space fields

| Field | Meaning |
| --- | --- |
| `name` | User-facing map name. |
| `type` | `personal` or `shared`. |
| `ownerId` | UID of the current owner. It must agree with the active owner Membership. |
| `createdBy` | UID that created the Space. |
| `createdAt` | Server timestamp for creation. |

The root Space document provides identity and ownership metadata. Existing categories, nicknames, and color settings remain in `spaces/{spaceId}/meta/config` during the additive migration. Moving or reshaping settings is not required for multi-user foundations and must not be coupled to the first production migration.

### Membership fields

| Field | Meaning |
| --- | --- |
| `userId` | Member UID; must match the document ID. |
| `role` | `owner` or `member`. |
| `status` | `active` or `removed`. |
| `displayNameSnapshot` | Last Space-resolvable display name for history. |
| `photoURLSnapshot` | Optional avatar snapshot when useful. |
| `joinedAt` | Timestamp of first accepted Membership. |
| `removedAt` | Timestamp when access was removed; absent/null while active. |

Membership is the permission source of truth. Do not add `Space.participantIds` as an access mechanism. Space metadata may denormalize counts for display later, but such projections cannot grant access.

Removed Membership documents are retained. The snapshot fields ensure historical participant rendering survives removal or later loss of the global User profile. Participant pickers for new data show only active Members; historical views resolve both active and removed Memberships referenced by the record.

### Place, Visit, and Trip fields

Places, including their embedded Visit arrays, remain at `spaces/{spaceId}/places/{placeId}`. Trips remain at `spaces/{spaceId}/trips/{tripId}`. This design does not move Visits to a subcollection.

Trip gains:

```text
participantIds: UID[]
```

The target Visit domain interface exposes:

```text
participantIds: UID[]
```

The persisted Visit transition is described under participant compatibility below. Neither Trip nor Visit participant fields affect permissions.

## Discovering a User's Spaces

The initial source of truth should be a collection-group query over Memberships rather than a second, fragile membership index:

```javascript
collectionGroup("members")
  where("userId", "==", authenticatedUid)
  where("status", "==", "active")
```

For each Membership result, the client derives the parent `spaceId` from the document path and fetches the corresponding root Space document. It should ignore malformed or missing Space metadata safely and report such cases in non-sensitive diagnostics.

The deployed project must have collection-group indexes that support the query. Declare and emulator-test a collection-group index for `members` covering `userId` and `status` if Firestore does not satisfy the query through its automatic indexes; the Firestore missing-index response should be treated as a development signal, not handled by weakening the query. Any later sorting field, such as Space name or recent activity, may require an additional composite index.

Rules for this query must let a User read their own Membership documents while preventing arbitrary Membership enumeration. Reading Space metadata still requires an active Membership.

A duplicated `users/{uid}/spaces/{spaceId}` projection may be added later if measured scale or latency justifies it. It is an optimization maintained transactionally or by trusted backend code, not the initial permission source of truth.

## Participant compatibility and recommendation

### Current storage seam

The current implementation persists Visit participant UIDs in `visit.who` and derives the two-person UI modes `me`, `partner`, and `both`. It also maintains Place-level `who` and `whoMode` summaries and fallbacks for legacy records. Those fallbacks feed current filtering, marker colors, editors, wishlist behavior, and legacy normalization.

### Compatibility API

Introduce one domain/API helper that exposes `participantIds` to new code:

1. If a Visit has a non-empty `participantIds` array, return it.
2. Otherwise, if it has a non-empty legacy `who` array, return that.
3. Otherwise, use the existing Place-level `who`/`whoMode` compatibility logic.

While the UI is being generalized, writes must continue preserving the legacy Place-level `who` and `whoMode` projections exactly as required by current compatibility behavior. The `me`/`partner`/`both` presentation assumptions must be removed before their storage fallbacks can be retired.

### Persisted field recommendation

The final persisted Visit field should be `participantIds`. It states the domain meaning clearly, matches `Trip.participantIds`, and avoids carrying two-person language into the target model.

Do not bulk-rewrite all production Visits in the foundation phase. Use a dual-read, compatibility-write transition:

- New domain and UI code reads `participantIds`, then falls back to `who` and the legacy Place projection.
- During the transition, an edited Visit may write `participantIds` while preserving its existing `who` value as a mirrored compatibility field if any deployed client still reads `who`.
- Do not delete `who`, Place-level `who`, or `whoMode` on the first successful write.
- A later explicit, emulator-proven backfill may add `participantIds` to legacy Visits without removing old fields.
- Stop writing Visit-level `who` only after all supported clients read `participantIds`; remove legacy fields only after the UI, fixtures, rules, data audit, and rollback window prove they are unused.

Temporarily keeping only `who` as the persisted field would reduce immediate writes but prolong ambiguity and make Trip/Visit APIs inconsistent. Dual-writing has document-size and drift risks, especially because complete embedded Visit arrays are currently rewritten. Centralizing serialization and testing equality between the two arrays is therefore required. If a mismatch exists, `participantIds` is authoritative only after the migration phase that explicitly establishes that contract; before then, compatibility code must follow the versioned rollout rules rather than guessing.

## Invitation design

### Invitation shapes

Both invitation modes use `spaceInvites/{inviteId}`:

1. **Direct invitation:** `targetUid` is the known invitee UID.
2. **Share-link invitation:** `targetUid` is null; any authenticated User possessing the unguessable invite ID may accept while it is valid.

Suggested fields are:

| Field | Meaning |
| --- | --- |
| `spaceId` | Space being offered; full Space content is not copied into the invite. |
| `createdBy` | Active owner who created the invite. |
| `targetUid` | Direct invitee UID, or null for a share link. |
| `role` | Offered role. In the initial product, normal invites should offer only `member`. |
| `status` | `pending`, `accepted`, `revoked`, or `expired`. |
| `createdAt` | Server timestamp for creation. |
| `expiresAt` | Required expiration timestamp. |
| `acceptedBy` | UID that accepted, once accepted. |
| `acceptedAt` | Server timestamp for acceptance. |

Invite IDs must be cryptographically unguessable and should appear in the link only as the capability needed to locate the invitation. Links must not contain the Space's data. Expiration must be enforced by security rules or trusted backend time checks, not merely hidden by the UI.

### Secure acceptance contract

Acceptance must create or reactivate only `spaces/{spaceId}/members/{request.auth.uid}`. A client must never be able to use an invitation to add an arbitrary UID, change another Membership, claim owner, or redirect the invite to another Space.

The preferred backend-free candidate is one Firestore transaction or atomic batch that:

1. Reads the pending invite by exact ID.
2. Verifies authentication, expiration, Space, offered role, and `targetUid` when present.
3. Creates or reactivates the authenticated User's own `member` Membership.
4. Changes the same invite to `accepted` with `acceptedBy` equal to the authenticated UID and a server timestamp.

Rules would need to validate the complete before/after state, including both writes with `getAfter()`, prohibit listing share-link invites, and make a consumed/revoked/expired invite unusable. All of these properties require adversarial Emulator tests, including concurrent double acceptance.

Whether the deployed Firestore rules can enforce the entire atomic contract without unacceptable disclosure or race conditions is an explicit implementation decision point. If the rules cannot reliably validate one-time acceptance and Membership reactivation, acceptance must move to a callable Cloud Function or other trusted backend. Public invitation launch is blocked until one approach is proven; this document does not pretend that client-side checks alone are secure.

## Friendship design

Use one canonical `friendships/{stablePairId}` document for a pair, rather than two independently mutable copies. Derive the stable ID from the two sorted UIDs using a documented collision-safe encoding or hash. The stored `userIds` array remains the relationship source of truth.

Suggested fields are:

```text
userIds: [uidA, uidB]
requestedBy: uid
status: pending | accepted | removed | blocked
createdAt: timestamp
acceptedAt: timestamp | null
```

Only the two involved Users may read or change the relationship, and rules must constrain valid state transitions. `blocked` is future-ready; its UI may be deferred. Removing a Friendship can mark it `removed` or delete the canonical social record according to the later audit/privacy decision, but it must never cascade to Membership, Trip, or Visit data.

Future username discovery may require a uniqueness reservation such as `usernames/{normalizedUsername} -> uid`. Normalization, rename, privacy, abuse, and enumeration rules must be designed before that collection is introduced. It is not part of this migration.

## Target security model

Firestore rules are not changed by this documentation task. The eventual rules must enforce these principles:

- An authenticated User may read a Space and its content only while `spaces/{spaceId}/members/{uid}.status` is `active`.
- In v0.2, active `owner` and `member` roles may edit normal Place, embedded Visit, and Trip data.
- Only the active owner may manage Memberships, change ownership-sensitive Space settings, or delete the Space.
- A removed Member cannot read Space content.
- Active Members may resolve the Space's retained removed-Membership snapshots when needed to display history.
- Trip or Visit participation never grants Space access.
- Friendship never grants Space access.
- A pending invitation does not grant Space access.
- Invite acceptance is a narrow exception to owner-managed Membership writes and may affect only the authenticated invitee's own Membership under the validated invitation contract.
- Space creation must establish a matching active owner Membership and cannot create an owner for another UID.
- Personal Space constraints must prevent a second active Member unless an explicit future conversion/share operation changes the Space to `shared`.

`Space.ownerId` and the active owner Membership duplicate an ownership fact for efficient checks. Ownership transfer, if later supported, must update both atomically. Space deletion is ownership-sensitive and may require trusted backend cleanup because deleting a Firestore document does not delete its subcollections.

## Personal Space rules

- Every User should have one Personal Space.
- A Personal Space initially has one active Member, the owner.
- Personal versus shared is primarily a UX label plus Membership constraints.
- Personal Spaces use exactly the same Places, embedded Visits, Trips, and settings structure as Shared Spaces.
- Do not create a separate path or model for personal data.
- The shared core model allows a Personal Space to be converted to a Shared Space later without migrating all Places.

The initial release need not implement conversion. Until conversion semantics are designed, adding a second Member should require creating or explicitly converting to a Shared Space rather than silently changing the type.

## Future data inherits Space boundaries

Photos, memories, comments, or similar future records must live under or reference exactly one Space and inherit its Membership permission boundary. A photo associated with a Place or Visit does not become accessible through Friendship or participant status.

Future multi-country geographic features must operate on the active Space's Places and must accept arbitrary Member participant sets. Country-specific display or boundary data cannot reintroduce assumptions about one current User and one partner.

## Open architecture decisions

These choices must be resolved and emulator-tested before the corresponding implementation phase can launch:

1. **Invitation execution:** prove the `getAfter()` transaction/rules design or use a trusted backend/Cloud Function.
2. **Personal Space provisioning:** choose a retry-safe Space ID and decide whether a client batch is sufficiently enforceable or a trusted backend is required.
3. **Ownership lifecycle:** define ownership transfer, owner departure, account deletion, and recovery while keeping `ownerId` and Membership role consistent.
4. **Membership reactivation audit:** decide whether `joinedAt` remains the original join time and whether later `rejoinedAt`/event history is needed.
5. **Friend removal retention:** decide between a retained `removed` state and deletion based on privacy, blocking, and audit needs.
6. **Settings evolution:** decide whether any `meta/config` settings eventually move; it is intentionally unchanged in the initial migration.
7. **Space discovery indexes and pagination:** validate the collection-group query and exact deployed index definitions at realistic membership counts.
8. **Participant cutover:** define the release/version gate that makes `participantIds` authoritative and permits `who` dual-writing to end.
9. **Personal-to-shared conversion:** define naming, consent, and Membership changes before exposing the operation.

