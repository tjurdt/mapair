# Expected multi-user fixture results

These outcomes describe the additive `mapair-multi-user.json` overlay after the unchanged `mapair-baseline.json` has been loaded. Everything is synthetic and intended only for the Firestore Emulator project `demo-mapair-local`.

## Fixture hierarchy

```text
users/
  test-user-a
  test-user-b
  test-user-c
  test-user-d

spaces/
  test-space-baseline
    meta/config                         (from baseline, unchanged)
    trips/trip-test-multiday            (from baseline, unchanged)
    places/{7 baseline Place IDs}       (from baseline, unchanged)
    members/test-user-a
    members/test-user-b
  test-space-personal-a
    members/test-user-a
  test-space-personal-b
    members/test-user-b
  test-space-personal-c
    members/test-user-c
  test-space-group
    members/test-user-a
    members/test-user-b
    members/test-user-c
    members/test-user-d
    trips/trip-test-group
    places/place-test-group-museum
    places/place-test-group-garden

friendships/
  friendship-test-a-b
  friendship-test-a-c
  friendship-test-b-d

spaceInvites/
  invite-test-pending-direct
  invite-test-pending-link
  invite-test-expired
  invite-test-revoked
  invite-test-accepted
```

## Users, Spaces, and Memberships

The four User profiles are `test-user-a` (測試旅人甲), `test-user-b` (測試旅人乙), `test-user-c` (測試旅人丙), and `test-user-d` (測試旅人丁). They are Firestore profile fixtures only; no Firebase Authentication users are created.

| Space | Type | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| `test-space-baseline` | shared | owner, active | member, active | none | none |
| `test-space-personal-a` | personal | owner, active | none | none | none |
| `test-space-personal-b` | personal | none | owner, active | none | none |
| `test-space-personal-c` | personal | none | none | owner, active | none |
| `test-space-group` | shared | owner, active | member, active | member, active | member, removed |

Every Space has exactly one active owner Membership, and that Membership UID equals `Space.ownerId`. Each Personal Space has only its active owner. Removed D retains `displayNameSnapshot: 測試旅人丁`, `joinedAt`, and `removedAt`, so historical records can remain named while D is excluded from new participant choices.

`test-space-baseline` represents the existing production `spaces/us` migration shape. Its original `meta/config`, `trip-test-multiday`, seven Places, embedded Visits, compatibility fields, and intentionally missing `createdAt` remain unchanged. Only the root Space document and formal A/B Memberships are supplied by the overlay.

## Trip and Visit participants

`trip-test-group` stores all four UIDs in `participantIds`, including removed D. The effective default for a new Visit is the stored array intersected with active Membership UIDs:

```text
[test-user-a, test-user-b, test-user-c]
```

The stored Trip remains unchanged when D is removed.

| Visit | Stored representation | Expected interpretation |
| --- | --- | --- |
| `visit-test-group-legacy-who` | `who: [A, B]`; no `participantIds` | legacy fallback gives A + B |
| `visit-test-group-participant-ids` | `participantIds: [A, B, C]`; no `who` | modern field gives A + B + C |
| `visit-test-group-both-equal` | both fields `[B, C]` | no compatibility conflict |
| `visit-test-group-mismatch` | `who: [A, B]`; `participantIds: [A, C]` | intentional mismatch must be detected/reported, not normalized |
| `visit-test-group-removed-member` | `participantIds: [A, D]` | historical D resolves through the removed Membership snapshot; D is not eligible for new selection |

Together these Visits lock the distinct A+B+C, A+B, and B+C combinations. Participants are independent per Visit and are not reducible to me/partner/both.

## Friendship and invitation independence

- A/B Friendship is `accepted`.
- A/C Friendship is `pending`, requested by A, even though A and C are both active in `test-space-group`.
- B/D Friendship is `blocked`.
- B and C share active Membership in `test-space-group` without any Friendship document.

These cases demonstrate that Friendship does not grant, remove, or explain Space Membership.

The invitation records cover a pending direct invitation, pending share-link invitation, expired invitation, revoked invitation, and accepted invitation. Each contains only the canonical Space ID, creator, nullable direct target, member role, lifecycle timestamps/status, and minimal Space/inviter preview snapshots. They contain no Places, Trips, Members, or Space content.

No `sourceInviteId`, `acceptedViaInviteId`, or equivalent linkage contract is asserted. Exact invite-to-Membership linkage and one-time acceptance remain Phase 5 security decisions requiring adversarial Emulator rules tests or trusted backend design.

## Validation expectations

`node scripts/validate-fixtures.mjs` must pass without Firebase. It validates safe unique paths, recursive tagged timestamps, synthetic IDs, User references, Membership ID consistency, owner invariants, Personal Space isolation, removed D, Trip active-default intersection, all participant compatibility cases, Friendship pairs/statuses, and invitation references/minimal payloads.

`node scripts/seed-emulator.mjs --fixture multi-user` must clear only the hard-coded local Emulator database, load the baseline followed by the overlay, and read back every expected document. It must additionally retain the baseline IDs and confirm that `place-test-legacy-no-created-at` still has no `createdAt`.
