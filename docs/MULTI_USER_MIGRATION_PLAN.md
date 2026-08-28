# Multi-User Migration Plan

## Objective and constraints

Migrate Mapair from one configured two-person Space to the multi-user model in [MULTI_USER_DESIGN.md](MULTI_USER_DESIGN.md) without relocating or rewriting existing shared history. This is a plan only. The current implementation remains documented in [DATA_MODEL.md](DATA_MODEL.md).

Every phase must be independently reviewable, additive before subtractive, and reversible. Application behavior, Firebase configuration, Firestore rules, and production data remain unchanged until a separately approved implementation task explicitly changes them.

## Non-negotiable migration safety

- Never mutate production data during development or testing.
- Build and test all migration logic against the Firebase Emulator Suite first, using invented or anonymized fixtures.
- Export and verify a recoverable production backup before the eventual production migration.
- Preserve `spaces/us` in place. Do not move its `places`, `trips`, or `meta/config` documents.
- Do not delete old fields during the first successful write.
- Make the migration additive before it becomes subtractive.
- Do not run an automatic destructive migration during normal application startup.
- Production migration must be an explicit, one-time operation with a target summary, confirmation, audit output, and safe retry behavior.
- A migration must fail closed if it cannot prove the intended project, environment, Space, and preconditions.
- Do not copy production names, UIDs, content, coordinates, credentials, or exports into repository fixtures.
- Preserve Place-level legacy fallbacks and mirrored `visitedOn`, `tripId`, `categories`, `who`, and `whoMode` fields until a separately verified cleanup phase.

## Cross-phase invariants

1. Friendship is not permission.
2. Membership is the source of Space permission.
3. Space Membership, Trip participation, and Visit participation are three independent facts.
4. Trip participants provide defaults; Visit participants remain independently editable history.
5. Removing a Member revokes access without rewriting historical participant arrays.
6. Personal and Shared Spaces use the same Places, embedded Visits, and Trips model.
7. A Place belongs to exactly one Space; no global Place migration is introduced.
8. Existing history remains under `spaces/us`.
9. No phase treats a couple as a special schema.
10. Future photos, memories, and multi-country features inherit the Space boundary and arbitrary-Member model.

## Release gating and ordering

The numbered phases describe implementation dependencies, but not every completed phase may be exposed to production immediately. In particular, building a Space switcher or invitations before Phase 6 is useful for emulator development, yet exposing multiple private Spaces while deployed rules still use hard-coded two-person assumptions could disclose data across Spaces.

Therefore:

- Phases 1–5 may be developed and tested behind disabled feature flags or in the Emulator.
- Production creation/switching of private multi-user Spaces and invitation acceptance is blocked until Phase 6 Membership-based rules pass adversarial Emulator tests and are deployed through a separately approved operation.
- Old two-person compatibility code remains available through the rollout and rollback window. It is removed only in Phase 7.

## Phase 0 — Documentation and fixtures

Current runtime behavior remains unchanged. Establish the design, acceptance vocabulary, and safe data coverage before implementation.

### Schema changes

None in application or Firestore. Define proposed User, Space, Membership, invitation, Friendship, Trip participant, and Visit compatibility shapes only in documentation and fixture specifications.

### UI changes

None. Record intended desktop and mobile workflows for first sign-in, Space switching, shared-Space creation, N-person participant selection, invitation acceptance, member removal, and inaccessible active-Space fallback.

### Data migration

None. Do not read production data for fixture construction. Specify the future one-time migration inputs, preconditions, dry-run output, and idempotency requirements.

### Local fixture changes

Extend the existing anonymized baseline later to at least three Users and multiple Spaces. Include:

- one Personal Space with one owner;
- `spaces/us` as a Shared Space with an owner and member;
- another Shared Space with at least three active Members and one removed Member;
- repeated Visits and a Trip with different `participantIds` defaults;
- Visit cases containing only `who`, only `participantIds`, both equal, and a deliberately mismatched pair for failure testing;
- a removed Member still referenced by historical Trip and Visit participant arrays;
- direct, share-link, expired, revoked, and already accepted invitations;
- accepted, pending, removed, and blocked Friendships;
- two Users with overlapping Friendship but no shared Space, and shared Membership without Friendship.

All identities and content must be invented. Preserve the current two-user baseline cases so migration parity remains testable.

### Security implications

Document an adversarial rules-test matrix before rules work begins. Include unauthenticated access, non-Member access, removed-Member access, participant-only access, Friend-only access, owner/member writes, self-acceptance, arbitrary-UID invite abuse, replay, expiration, concurrent acceptance, listing share-link invites, and cross-Space path substitution.

### Rollback strategy

Documentation and fixtures are additive. Remove or revise only the new proposal files if the design is rejected; runtime and production remain untouched.

### Acceptance criteria

- Product and permission terms are unambiguous.
- The current-versus-target model and all twelve product invariants are documented.
- Fixture design covers at least three Users, multiple Spaces, removals, invitations, Friendships, and legacy participant data.
- Desktop and mobile UX expectations are recorded.
- Open architecture decisions have named owners or gates before implementation begins.

## Phase 1 — User, Space, and Membership foundation

Add the identity and permission-shaped documents around current data without changing participant UI or moving existing records.

### Schema changes

- Add `users/{uid}` profile documents with minimal display fields.
- Add a root metadata document at `spaces/us`.
- Add `spaces/us/members/{uid}` for the two current Users.
- Use only `owner` and `member` roles and `active`/`removed` status.
- Keep `spaces/us/meta/config`, including its `members` and `nicknames` compatibility fields, unchanged.
- Keep all Places, embedded Visits, Trips, and legacy participant fields unchanged.

### UI changes

No participant redesign and no production Space switcher. Existing UI continues to render through current compatibility paths. Development-only diagnostics may compare formal Membership names with `meta/config` values without exposing UIDs to normal users.

### Data migration

Create, through an explicit idempotent migration:

- the two minimal User profiles;
- `spaces/us` with `type: shared`, the current primary UID as `ownerId`/`createdBy`, a chosen temporary or final name, and `createdAt`;
- the primary User's active owner Membership;
- the other current User's active member Membership;
- display-name snapshots derived from explicitly reviewed current display metadata.

The migration must preflight the exact two UIDs, refuse ambiguous ownership, report every planned write in dry-run mode, use merge/create preconditions that preserve existing fields, and produce no writes beneath `places`, `trips`, or `meta/config`.

### Local fixture changes

Add root User, Space, and Membership documents around the unchanged baseline Space. Test repeat execution, partial completion, unexpected existing metadata, missing current member data, swapped role input, and snapshot fallback after a User profile becomes unavailable.

### Security implications

Formal Membership documents are not yet the deployed permission source of truth. Existing access behavior remains in effect. New documents must not be mistaken for secured multi-Space support. Test the target rule predicates in the Emulator, but do not deploy or expose new private Spaces yet.

### Rollback strategy

Because current code does not depend on the new root/User/Membership documents, stop reading them and leave the additive documents dormant. If removal is later approved, use a separately reviewed exact-document rollback; never delete `spaces/us` itself because its subcollections contain production history.

### Acceptance criteria

- `spaces/us/places`, `trips`, and `meta/config` are byte-for-byte/logically unchanged.
- The two Memberships have reviewed roles, active status, and useful display snapshots.
- Existing desktop and mobile baseline behavior is unchanged.
- Re-running the migration produces no duplicates or destructive updates.
- A dry run and audit can prove that only the expected root/User/Membership paths are targeted.

## Phase 2 — Remove two-person assumptions

Generalize the domain and presentation layer to arbitrary Space Members while maintaining existing storage compatibility.

### Schema changes

No required production backfill. Introduce a domain `participantIds` interface that reads Visit `participantIds`, then legacy `visit.who`, then Place-level compatibility fields. Continue to accept embedded Visits and current Trip structure.

### UI changes

- Replace `partnerUid`, `otherOf`, and `me`/`partner`/`both` domain assumptions with arbitrary Member lookup and selection.
- Participant filters list named Members rather than “me/partner/both”.
- Participant pickers support N active Members on desktop and mobile.
- Historical display can resolve removed Members referenced by old records.
- Marker/legend presentation must handle arbitrary combinations without assigning special meaning to exactly two people.
- Normal UI never displays raw UIDs or Membership IDs.

### Data migration

None required. Reads remain compatible with `visit.who` and Place-level projections. Transitional serializers may add `participantIds` when a Visit is otherwise edited, but must retain legacy `who` and Place projections during the mixed-client window and must not rewrite untouched production Places merely to modernize fields.

### Local fixture changes

Exercise one-, two-, three-, and many-Member Spaces; unknown and removed participants; empty arrays; legacy `whoMode`; equal dual fields; and deliberate dual-field divergence. Lock filtering, marker color, display-name resolution, editor defaults, full-array serialization, and compatibility projection behavior with automated tests where possible.

### Security implications

Participant arrays remain ordinary Space content and cannot grant access. Do not make rules inspect Trip/Visit participation as authorization. Only active Members may be candidates for new participant selections, while retained removed Member documents remain readable to current Members for historical rendering.

### Rollback strategy

Keep adapters that can feed the old two-person presentation from current legacy fields for the rollout window. If the generalized UI regresses, disable it and return to the old presentation without undoing any Membership foundation documents. Any newly dual-written `participantIds` remains harmless additive data.

### Acceptance criteria

- No core domain helper assumes exactly one “other” User.
- N-person filtering, editing, marker/legend display, and historical name resolution pass on desktop and mobile.
- Current two-person data renders with parity.
- Legacy-only Visits still read and save without losing `who` or Place-level projections.
- Removing a fixture Member revokes new-selection eligibility but leaves historical displays named.

## Phase 3 — Personal Space and Space switcher

Introduce many Spaces per User, automatic Personal Space provisioning, active-Space selection, and correct listener lifecycle. Keep the feature non-public until Membership rules are ready.

### Schema changes

- Create a root Space and active owner Membership for each Personal Space.
- Reuse the same `places`, `trips`, and `meta/config` paths beneath every Space.
- Query active Memberships through `collectionGroup("members")` and fetch corresponding Space metadata.
- Add the required collection-group index for `userId` and `status` if Emulator/deployed query validation requires it.
- Do not initially add a duplicated `users/{uid}/spaces` index.

### UI changes

- On first sign-in, ensure one “My Map”/localized Personal Space exists.
- Add the “Which map am I viewing?” switcher and Shared Space creation entry point.
- Store the active Space ID as a local UI preference if desired.
- Validate the preference at startup and fall back safely if Membership was removed.
- Show map names and people, never internal IDs.
- Provide usable desktop and mobile switching/loading/empty states.
- On switch, close or invalidate editors tied to the prior Space and clear filters, maps, pending async results, and selections according to a documented policy.

### Data migration

Give each of the two existing Users a new empty Personal Space through an explicit, idempotent operation. Do not copy shared Places, Trips, Visits, or settings out of `spaces/us`. Other new Users receive their Personal Space through the provisioning path after it has passed partial-failure tests.

### Local fixture changes

Test first sign-in, retry after partial creation, existing User without Personal Space, duplicate-prevention, many Membership results, missing Space metadata, local preference to a removed/inaccessible Space, rapid switching, slow/out-of-order snapshots, and simultaneous desktop/mobile sessions. Include Spaces with identical names to ensure internal routing remains ID-safe without exposing IDs.

### Security implications

The collection-group query must return only the authenticated User's own Membership documents. A User may fetch Space metadata/content only with active Membership. Existing hard-coded rules may make multiple private Spaces unsafe, so this phase remains Emulator-only or feature-flagged until Phase 6 is deployed.

### Rollback strategy

Disable the switcher and restore `spaces/us` as the configured active Space for the current Users. New Personal Spaces are additive and empty; leave them dormant rather than risk deleting the wrong Space. Retain the local preference but ignore it while the feature is disabled.

### Acceptance criteria

- Every fixture User gets exactly one retry-safe Personal Space with one active owner.
- Personal and Shared Spaces use identical core paths and domain behavior.
- Existing shared history remains solely in `spaces/us`.
- Rapid switching never renders or writes stale data across Spaces.
- Discovery works without a duplicated User/Space permission index.
- Desktop and mobile switching, inaccessible fallback, and empty-map states pass.

## Phase 4 — Trip participant defaults

Add arbitrary default participants to Trips and sensible Visit-creation behavior without changing existing historical Visits.

### Schema changes

- Add `participantIds: UID[]` to Trip documents when defaults are chosen.
- Continue exposing Visit `participantIds` through the compatibility API.
- Scope any remembered daily participant default by Space and preferably keep it as local UI state unless cross-device persistence is explicitly designed.

### UI changes

- Add an N-Member participant selector to the Trip editor.
- Preselect Trip defaults when creating a Visit in that Trip.
- Keep each Visit independently editable.
- For the first non-Trip Visit, default to the authenticated User.
- Later non-Trip Visits may reuse that Space's last participant choice.
- Never default to all Members merely because they belong to the Space.
- Explain defaults through normal labels; do not imply they affect access.

### Data migration

Do not infer and backfill Trip participants from every historical Visit automatically; different Visits may legitimately differ. Existing Trips without `participantIds` use an empty/default-on-create behavior until a User explicitly saves defaults. Existing Visits remain unchanged.

### Local fixture changes

Cover Trips with no defaults, one default, several defaults, removed historical defaults, and Visits that override the Trip. Verify editing Trip defaults does not rewrite Visits and editing a Visit does not rewrite its Trip. Test daily defaults independently in two Spaces and with large Member lists.

### Security implications

Trip and Visit participant fields are editable normal Space data for active Members in v0.2. They never grant read/write access. Removed Members may remain in existing Trip defaults for history, but new picker choices should use active Members; exact cleanup prompts for stale defaults are a UX decision, not an authorization operation.

### Rollback strategy

Ignore Trip `participantIds` and return to the pre-default creation behavior. The additive arrays can remain stored. Because no existing Visit is rewritten from Trip defaults, rollback does not alter history.

### Acceptance criteria

- New Trip Visits begin with the Trip defaults and can diverge independently.
- Existing Visits are never rewritten when Trip defaults change.
- Daily defaults begin with the authenticated User and never select all large-Space Members automatically.
- Last selections are Space-scoped and do not leak across Spaces.
- Desktop and mobile participant selection remains usable for N Members.

## Phase 5 — Invitations and Friendship

Implement direct and share-link invitations and a separate canonical Friendship graph. Keep production exposure gated on proven rules.

### Schema changes

- Add `spaceInvites/{inviteId}` with Space, creator, optional target, role, lifecycle, expiration, and acceptance fields.
- Add one canonical `friendships/{stablePairId}` document per pair.
- Do not add a username index until uniqueness/discovery has its own approved design.
- Initial invitation role is `member`; ownership transfer is separate.

### UI changes

- Let an owner invite an existing Friend directly.
- Let an owner create, revoke, and view expiration of a secure share link.
- Let an authenticated invitee preview minimal safe invite context and accept or reject.
- Clearly distinguish “Friend” from “Member of this map”.
- Support pending/accepted/revoked/expired outcomes and understandable retry errors.
- Removing a Friend must leave all Space and historical data untouched.

### Data migration

None for existing Spaces or history. Do not infer Friendships from shared Membership; the current two Users may share `spaces/us` without automatically becoming Friends. Invites are created only by explicit user action after launch.

### Local fixture changes

Test direct target mismatch, unauthenticated acceptance, unknown User, non-Friend acceptance, expired/revoked/accepted replay, concurrent share-link acceptance, arbitrary target UID attempts, role escalation, changed `spaceId`, removed/rejoined Membership, inviter losing owner status, invite enumeration attempts, and Friendship removal with shared history.

### Security implications

Accepting an invitation must atomically create/reactivate only the authenticated User's own Membership and consume the exact invite. Client-side validation alone is insufficient. Prove a Firestore transaction/rules design with `getAfter()` and adversarial Emulator tests, or move acceptance to a trusted backend/Cloud Function. Share-link invite listing must be denied. No invitation or Friendship grants Space reads before active Membership exists.

### Rollback strategy

Disable invite creation and acceptance. Revoke still-pending invites through an explicit safe operation if required; do not remove already accepted Memberships automatically. Friendship UI can be disabled while canonical records remain inert. Never cascade rollback into Places, Trips, Visits, or Membership history.

### Acceptance criteria

- Direct invites can be accepted only by `targetUid`.
- A share link is unguessable, expires, cannot be listed, and cannot be replayed.
- Acceptance cannot add another UID, change role to owner, or redirect Spaces.
- Concurrent acceptance has one defined, secure result.
- Friends are easier to invite, but non-Friends can join securely.
- Friend removal changes no Membership, Trip, or Visit data.
- Public launch remains blocked until the acceptance security contract is proven.

## Phase 6 — Security migration

Make active Membership the deployed permission source of truth and validate every path before removing old access assumptions.

### Schema changes

No new product schema is required beyond prior phases. Add versioned Firestore rules and required index declarations through a separately approved implementation. Rules reference `spaces/{spaceId}/members/{uid}` and validate root Space ownership consistency.

### UI changes

Handle permission loss and listener errors without showing stale content. If the active Membership becomes removed, tear down Space listeners, clear Space state, and return to the switcher or another accessible Space. Owner-only membership/settings/delete controls must be hidden for members, while rules remain authoritative.

### Data migration

Before rule deployment, audit that every production-accessible Space has exactly one valid active owner and the expected active Memberships. For `spaces/us`, verify the two reviewed Memberships and root metadata without touching its history. Do not deploy rules that strand current Users or rely on incomplete documents.

### Local fixture changes

Run the full adversarial rules matrix against the Emulator:

- unauthenticated, unrelated, Friend-only, participant-only, removed, member, and owner identities;
- reads/writes for Space root, Members, meta/settings, Places/embedded Visits, and Trips;
- own collection-group discovery versus Membership enumeration;
- owner/member permission differences;
- membership creation/removal/reactivation and ownership consistency;
- invitation creation, listing, acceptance, expiration, replay, and path/UID/role substitution;
- Personal Space second-Member constraints;
- simultaneous removal and in-flight writes/listeners.

### Security implications

Target policy:

- Active owners and members can read the Space and edit normal Place/Visit/Trip data in v0.2.
- Only the owner manages Membership, ownership-sensitive settings, and deletion.
- Removed Members cannot read Space content.
- Current Members can resolve retained removed-Member snapshots for history.
- Friendship, participant status, and pending invites grant no access.
- Invitation acceptance is the only narrow non-owner Membership write and is constrained to the authenticated invitee under the accepted design.

Deploying rules and indexes is a production operation outside documentation and requires explicit approval, backups/config review, staged verification, and a rollback artifact containing the prior rules.

### Rollback strategy

Retain the immediately previous known-good ruleset and deployment instructions. If legitimate Users are denied or unauthorized access is suspected, disable newly exposed multi-Space/invite UI and restore the prior reviewed rules through an explicitly approved deployment. Restoring old rules is a temporary containment action; it must not trigger data rewrites or document deletion.

### Acceptance criteria

- Emulator rules tests cover all target paths and adversarial identities.
- No Friend-, Trip-, Visit-, invite-, or removed-Member-only identity can access Space content.
- Owner/member differences are enforced by rules, not only UI.
- Current `spaces/us` Users retain expected access after staged verification.
- Collection-group discovery returns only the authenticated User's active Memberships.
- The previous ruleset and feature-disable procedure are ready before deployment.
- Only after these checks pass may private multi-Space and invitation features be exposed in production.

## Phase 7 — Compatibility cleanup

Remove obsolete two-person and legacy storage compatibility only after data, UI, rules, and rollback evidence prove it is no longer needed.

### Schema changes

Candidates for eventual removal include:

- `meta/config.members` as a Membership source;
- obsolete `meta/config.nicknames` behavior if replaced by an approved naming model;
- Visit `who` after `participantIds` is universal;
- Place-level visited-history `who` and `whoMode` projections;
- `me`/`partner`/`both` compatibility code.

This phase does not automatically remove other Place-level legacy fields (`visitedOn`, `tripId`, or `categories`); each remains until its own validated migration proves no dependency. Wishlist Place-level participant behavior also requires an explicit target decision before shared fields can be removed.

### UI changes

Remove compatibility labels and hidden two-person branches only after arbitrary-Member UX has completed its rollout window. Historical views continue resolving removed Membership snapshots. Any settings/nickname replacement must preserve understandable names on desktop and mobile.

### Data migration

Run a read-only production audit first. Then, only through an explicit one-time, backed-up, confirmed, idempotent migration, backfill missing `participantIds` and report mismatches for manual resolution. Do not delete old fields on the same first successful backfill write. Use a separate later cleanup operation after supported clients, logs, and audits prove the old fields are unused.

Because Visits are embedded and whole Place documents may be concurrently rewritten, the migration must use version/update-time preconditions or transactions, bounded batches, progress checkpoints, and safe retry semantics. It must never run automatically on app startup.

### Local fixture changes

Keep a permanent legacy fixture suite even after cleanup. Test old clients/data against the compatibility window, mixed arrays, mismatch quarantine, interrupted and resumed backfills, concurrent Visit edits, document-size limits, wishlist fallbacks, and rollback reads from retained fields.

### Security implications

Rules must not depend on deprecated participant or `meta/config.members` fields before those fields are removed. Participant cleanup cannot change permissions. Restrict migration tooling to a verified non-production environment during development and to an explicitly authorized operator for the eventual production run.

### Rollback strategy

The additive backfill is rolled back by returning readers to legacy fields; retained old fields make that possible. Delay physical field deletion through a defined observation window and backup checkpoint. If deletion has eventually occurred, restoration requires the verified production export and a separately approved restore plan.

### Acceptance criteria

- Every production Visit is classified as migrated, intentionally legacy, or manually quarantined; no mismatch is silently chosen.
- All supported clients read `participantIds` and no logs/tests show legacy UI dependency.
- Rules use Membership, never participant or legacy meta fields, for permission.
- Current and legacy fixture suites pass on desktop and mobile.
- Cleanup is a separate confirmed operation after additive migration and observation.
- Obsolete fields are removed only when backup restoration and rollback have been rehearsed safely.

## Eventual production migration runbook requirements

Before any production write, the implementation task must supply a reviewed runbook containing:

1. Exact project ID, target paths, expected existing document counts, and expected current UIDs/roles.
2. A fresh, verified Firestore export and restoration owner/location.
3. Emulator evidence using the same migration version and representative fixtures.
4. A read-only dry run listing planned creates, merges, skips, conflicts, and forbidden paths.
5. An explicit human confirmation after reviewing the dry run.
6. Idempotency keys or deterministic document paths, update-time/precondition handling, bounded writes, and resumable progress output.
7. A denylist that prevents writes under `spaces/us/places`, `spaces/us/trips`, and `spaces/us/meta/config` during the foundation migration.
8. Post-write verification of root Space metadata and Memberships, followed by existing desktop/mobile history smoke tests.
9. A separately approved rules deployment and rollback plan when Phase 6 is reached.
10. An audit artifact containing timestamps, operator, migration version, counts, conflicts, and verification results without sensitive content.

## Unresolved decisions and phase gates

| Decision | Must be resolved before |
| --- | --- |
| Firestore transaction/rules versus trusted backend for secure invite acceptance | Phase 5 public launch |
| Retry-safe Personal Space ID and provisioning authority | Phase 3 implementation |
| Ownership transfer, owner departure/account deletion, and owner recovery | Owner-management launch in Phases 5–6 |
| Membership rejoin timestamps/audit history | Phase 1 schema freeze |
| Friendship `removed` retention versus deletion | Phase 5 schema freeze |
| Exact collection-group and future sorting indexes | Phase 3 production readiness |
| `participantIds` authority/version gate and mismatch policy | Phase 2 writes and Phase 7 backfill |
| Wishlist participant target model | Removal of Place-level participant compatibility in Phase 7 |
| Personal-to-shared conversion semantics | Any conversion UI |
| Long-term location of `meta/config` settings and nickname overrides | Any settings migration; not required for foundation |

