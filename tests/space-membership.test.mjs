import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createMemberDirectory,
  normalizeFormalMembers,
  normalizeLegacyMembers,
  resolveSpaceMembershipFoundation,
  validateFormalSpaceOwnership
} from "../src/space-membership.js";

const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-baseline.json", import.meta.url), "utf8"));
const multiUser = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-multi-user.json", import.meta.url), "utf8"));
const documents = new Map(multiUser.documents.map(document => [document.path, document.data]));

function spaceFixture(spaceId){
  const space = documents.get(`spaces/${spaceId}`);
  const prefix = `spaces/${spaceId}/members/`;
  const memberships = multiUser.documents
    .filter(document => document.path.startsWith(prefix))
    .map(document => ({ id:document.path.slice(prefix.length), ...document.data }));
  return { space, memberships };
}

const legacyNames = baseline.meta.config.members;
const baselineFormal = spaceFixture("test-space-baseline");
const baselineState = resolveSpaceMembershipFoundation({
  spaceId:"test-space-baseline",
  spaceDocument:baselineFormal.space,
  formalMemberships:baselineFormal.memberships,
  legacyMembers:legacyNames,
  legacyNicknames:baseline.meta.config.nicknames,
  currentUserId:"test-user-a"
});
assert.equal(baselineState.membershipSource, "formal");
assert.equal(baselineState.currentMembership.role, "owner");
assert.equal(baselineState.currentMembership.status, "active");
assert.equal(
  baselineState.currentMembership.displayName,
  baselineFormal.memberships.find(member => member.userId === "test-user-a").displayNameSnapshot,
  "formal snapshot must take precedence over distinguishable legacy names"
);
assert.equal(baselineState.ownership.valid, true);

const group = spaceFixture("test-space-group");
const groupMembers = normalizeFormalMembers(group.memberships);
const groupDirectory = createMemberDirectory(groupMembers);
assert.deepEqual(groupDirectory.activeSpaceMembers().map(member => member.userId), ["test-user-a", "test-user-b", "test-user-c"]);
assert.equal(groupDirectory.historicalSpaceMember("test-user-d").status, "removed");
assert.equal(groupDirectory.historicalSpaceMember("test-user-d").displayName, group.memberships.find(member => member.userId === "test-user-d").displayNameSnapshot);
assert.equal(validateFormalSpaceOwnership(group.space, groupMembers).valid, true);
assert.equal(groupMembers.length, 4, "arbitrary N-member normalization must not assume one partner");
const removedCurrentState = resolveSpaceMembershipFoundation({
  spaceId:"test-space-group",
  spaceDocument:group.space,
  formalMemberships:group.memberships,
  currentUserId:"test-user-d"
});
assert.equal(removedCurrentState.currentMembership.status, "removed");
assert.equal(removedCurrentState.currentMembershipAccessible, false);

const withoutOwner = groupMembers.map(member => ({ ...member, role:"member" }));
assert.equal(validateFormalSpaceOwnership(group.space, withoutOwner).code, "zero-active-owner");

const multipleOwners = groupMembers.map(member => (
  member.userId === "test-user-b" ? { ...member, role:"owner" } : member
));
assert.equal(validateFormalSpaceOwnership(group.space, multipleOwners).code, "multiple-active-owners");

assert.equal(validateFormalSpaceOwnership(
  { ...group.space, ownerId:"test-user-b" },
  groupMembers
).code, "owner-id-mismatch");

const removedOwner = groupMembers.map(member => (
  member.userId === "test-user-a" ? { ...member, status:"removed" } : member
));
assert.equal(validateFormalSpaceOwnership(group.space, removedOwner).code, "removed-owner");

const legacyMembers = normalizeLegacyMembers(baseline.meta.config.members, baseline.meta.config.nicknames);
assert.deepEqual(legacyMembers.map(member => member.userId), ["test-user-a", "test-user-b"]);
assert.ok(legacyMembers.every(member => member.source === "legacy-meta" && member.status === "active"));
const legacyState = resolveSpaceMembershipFoundation({
  spaceId:"test-space-baseline",
  legacyMembers:baseline.meta.config.members,
  legacyNicknames:baseline.meta.config.nicknames,
  currentUserId:"test-user-b"
});
assert.equal(legacyState.membershipSource, "legacy-meta");
assert.equal(legacyState.currentSpace.id, "test-space-baseline");
assert.equal(legacyState.currentMembership.userId, "test-user-b");
assert.equal(legacyState.ownership.code, "legacy-not-validated");

const unnamed = normalizeFormalMembers([{ id:"test-user-z", role:"member", status:"active" }]);
assert.equal(unnamed[0].displayName, "Member", "safe fallback must not expose a raw UID");
const compatibleFormal = normalizeFormalMembers(
  [{ id:"test-user-z", role:"member", status:"active", displayNameSnapshot:"" }],
  { "test-user-z":"Compatible Name" }
);
assert.equal(compatibleFormal[0].displayName, "Compatible Name");
assert.equal(createMemberDirectory([]).memberDisplayName("secret-uid"), "Member");

const mismatchedIdentity = normalizeFormalMembers([{
  id:"test-user-a",
  userId:"test-user-b",
  role:"member",
  status:"active"
}])[0];
assert.equal(mismatchedIdentity.userId, "test-user-a", "document ID must remain the canonical Membership identity");
assert.equal(mismatchedIdentity.valid, false);
assert.ok(mismatchedIdentity.issues.some(issue => issue.code === "user-id-mismatch"));
const mismatchedDirectory = createMemberDirectory([mismatchedIdentity]);
assert.equal(mismatchedDirectory.memberById("test-user-b"), null, "stored userId cannot masquerade as another Member");
assert.deepEqual(mismatchedDirectory.activeSpaceMembers(), [], "identity-mismatched Membership cannot become active");

const missingStatus = normalizeFormalMembers([{
  id:"test-user-a",
  userId:"test-user-a",
  role:"member"
}])[0];
assert.equal(missingStatus.valid, false);
assert.equal(missingStatus.status, null);
assert.ok(missingStatus.issues.some(issue => issue.code === "invalid-status"));
assert.deepEqual(createMemberDirectory([missingStatus]).activeSpaceMembers(), []);
const missingStatusState = resolveSpaceMembershipFoundation({
  spaceId:"test-space-invalid",
  spaceDocument:{ ownerId:"test-user-b", type:"shared" },
  formalMemberships:[{
    id:"test-user-a",
    userId:"test-user-a",
    role:"member"
  }],
  currentUserId:"test-user-a"
});
assert.equal(missingStatusState.currentMembership.valid, false);
assert.equal(missingStatusState.currentMembershipAccessible, false);

for (const role of [undefined, "administrator", " owner "]){
  const invalidRole = normalizeFormalMembers([{
    id:"test-user-a",
    userId:"test-user-a",
    ...(role === undefined ? {} : { role }),
    status:"active"
  }])[0];
  assert.equal(invalidRole.valid, false);
  assert.equal(invalidRole.role, null);
  assert.ok(invalidRole.issues.some(issue => issue.code === "invalid-role"));
}

const invalidOwner = normalizeFormalMembers([{
  id:"test-user-a",
  userId:"test-user-a",
  role:"owner"
}]);
const invalidOwnerState = validateFormalSpaceOwnership({ ownerId:"test-user-a" }, invalidOwner);
assert.equal(invalidOwnerState.valid, false, "invalid owner Membership must fail ownership validation");
assert.equal(invalidOwnerState.code, "zero-active-owner");

const noPhantomLegacyMembers = normalizeLegacyMembers(
  { "test-user-a":"A" },
  { "test-user-a":"AA", "stale-user":"Old name" }
);
assert.deepEqual(noPhantomLegacyMembers.map(member => member.userId), ["test-user-a"]);
assert.equal(noPhantomLegacyMembers[0].displayName, "AA");

const canonicalSpaceState = resolveSpaceMembershipFoundation({
  spaceId:"test-space-canonical",
  spaceDocument:{ id:"stored-wrong-space", ownerId:"test-user-a", type:"shared" },
  formalMemberships:[{
    id:"test-user-a",
    userId:"test-user-a",
    role:"owner",
    status:"active"
  }],
  currentUserId:"test-user-a"
});
assert.equal(canonicalSpaceState.currentSpace.id, "test-space-canonical", "path-derived Space ID must override stored id fields");

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
assert.equal((mainSource.match(/runtimeConfig\.spaceId/g) || []).length, 1, "runtime config spaceId should only initialize currentSpaceId");
assert.match(mainSource, /const spaceDoc\s*=\s*\(\)\s*=>\s*spaceDocFor\(currentSpaceId\)/);
assert.match(mainSource, /const membersCol\s*=\s*\(\)\s*=>\s*membersColFor\(currentSpaceId\)/);
assert.match(mainSource, /const spaceDocFor\s*=\s*spaceId\s*=>\s*doc\(db,\s*"spaces",\s*spaceId\)/, "explicit Space path helpers must be Space-ID-parameterised (§17)");
assert.match(mainSource, /const membersColFor\s*=\s*spaceId\s*=>\s*collection\(db,\s*"spaces",\s*spaceId,\s*"members"\)/);
assert.match(mainSource, /currentSpaceUnsubscribes\.set\("space",\s*onSnapshot\(spaceDoc\(\)/);
assert.match(mainSource, /currentSpaceUnsubscribes\.set\("members",\s*onSnapshot\(membersCol\(\)/);
assert.match(mainSource, /snapshot\.docs\.map\(member\s*=>\s*\(\{\s*\.\.\.member\.data\(\),\s*id:member\.id\s*\}\)\)/, "Firestore Membership document ID must overwrite stored id-like data");
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*spaceDoc\s*\(/, "startup/runtime must not create or update root Space documents through the current-Space helper");
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*memberDoc\s*\(/, "startup/runtime must not create or update Membership documents through the current-Space helper");
assert.doesNotMatch(mainSource, /addDoc\s*\(\s*membersCol\s*\(/, "startup/runtime must not create Membership documents");
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*spaceDocFor\s*\(/, "root Space documents are only ever created inside a Phase 3 transaction");
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*memberDocFor\s*\(/, "Membership documents are only ever created inside a Phase 3 transaction");

/* Phase 3 — Personal Space / Shared Space creation is gated and transactional. */
assert.match(mainSource, /function isMultiSpace\(\)\{\s*return isLocalTest\(\)\s*&&\s*runtimeConfig\?\.multiSpace\s*===\s*true;\s*\}/,
  "Phase 3 is LOCAL-only and gated by runtimeConfig.multiSpace");
assert.match(mainSource, /function startPhase3\(\)\{\s*\n?\s*if \(!isMultiSpace\(\)/, "startPhase3 must bail unless multiSpace is on");
assert.match(mainSource, /async function ensurePersonalSpace\(uid\)\{[\s\S]*?runTransaction\(db,[\s\S]*?tx\.set\(spaceRef,/,
  "Personal Space provisioning must use a Firestore transaction");
assert.doesNotMatch(mainSource, /ensurePersonalSpace[\s\S]{0,400}merge\s*:\s*true/, "provisioning must never use merge:true to hide an ownership conflict");
assert.match(mainSource, /async function createSharedSpace\(name\)\{[\s\S]*?runTransaction\(db,/, "Shared Space creation must be transactional");
assert.match(mainSource, /switchActiveSpace\(spaceId, opts = \{\}\)\{\s*\n?\s*if \(!isMultiSpace\(\)\) return;/, "switchActiveSpace must be gated");
assert.match(mainSource, /collectionGroup\(db, "members"\), where\("userId", "==", uid\), where\("status", "==", "active"\)/,
  "discovery must use the target collection-group Membership query (§7)");

/* Phase 3 — cross-Space write protection (§16, §17). */
assert.match(mainSource, /function isStaleSpaceCallback\(session\)\{ return localFailure \|\| session !== spaceSession; \}/);
assert.match(mainSource, /const editorSpaceId = currentSpaceId;/, "openEditor must capture its originating Space");
assert.match(mainSource, /placesColFor\(editorSpaceId\)/);
assert.match(mainSource, /addDoc\(tripsColFor\(tripSpaceId\)/);
assert.match(mainSource, /spaceSession = nextSpaceSession\(spaceSession, spaceId\)/, "each switch mints a fresh Space session token");

/* Phase 2 §3 — new-Visit participant defaults must fail closed. */
assert.match(
  mainSource,
  /function defaultParticipants\(\)\{[^}]*isActiveMember\(uid\)\s*\?\s*\[uid\]\s*:\s*\[\][^}]*\}/,
  "defaultParticipants must select the authenticated User only when active, else fail closed"
);
assert.doesNotMatch(
  mainSource,
  /return\s+sanitized\.length\s*\?\s*sanitized\s*:\s*\[uid\]/,
  "defaultParticipants must not fall back to [uid] when the User is not an active Member"
);
assert.match(
  mainSource,
  /newWorkingVisit\s*=\s*\(base,\s*selected\)\s*=>\s*\(\{[\s\S]*?sanitizeParticipantsForNewSelection\(selected,\s*activeIds\)/,
  "every new working Visit must intersect its participant seed with active Members"
);

/* Phase 2 §4 — the Membership listener refreshes participant-dependent UI,
   guarded and without new listeners/writes. */
assert.match(mainSource, /function reconcileSpaceMembershipFoundation\(\)\{[\s\S]*?refreshParticipantDependentUI\(\)/,
  "reconcileSpaceMembershipFoundation must refresh participant-dependent UI when the directory changes");
assert.match(mainSource, /lastMembershipRenderSignature/,
  "a signature guard must prevent render loops on unchanged Membership snapshots");
const refreshFnMatch = mainSource.match(/function refreshParticipantDependentUI\(\)\{([\s\S]*?)\n\}/);
assert.ok(refreshFnMatch, "refreshParticipantDependentUI must exist");
assert.match(refreshFnMatch[1], /refreshFilterUI\(\);\s*renderList\(\);\s*renderMarkers\(\)/);
assert.doesNotMatch(refreshFnMatch[1], /onSnapshot|addDoc|setDoc|updateDoc|deleteDoc/,
  "participant UI refresh must not create Firestore listeners or writes");

/* Phase 2 §2 — an EXISTING Place's legacy whoMode anchor is never the viewer. */
assert.match(
  mainSource,
  /createdBy:\s*isUsableUid\(p\.createdBy\)\s*\?\s*p\.createdBy\s*:\s*\(id\s*\?\s*""\s*:\s*\(user\?\.uid\s*\|\|\s*""\)\)/,
  "openEditor partCtx must use p.createdBy for an existing Place and never substitute the viewer"
);
assert.doesNotMatch(mainSource, /createdBy:\s*p\.createdBy\s*\|\|\s*user\?\.uid/,
  "the permissive `p.createdBy || user.uid` anchor must be gone");
const lpcMatch = mainSource.match(/function legacyParticipantContext\(\)\{[\s\S]*?\n\}/);
assert.ok(lpcMatch, "legacyParticipantContext must exist");
assert.doesNotMatch(lpcMatch[0], /currentUserId|user\?\.uid|user\.uid/,
  "legacyParticipantContext must not carry the viewer as a whoMode anchor source");

/* Phase 2 §3 — an invalid participant-filter selection resets to "all". */
assert.match(mainSource, /function sanitizeParticipantFilter\(\)\{[\s\S]*?filter\.who\s*=\s*"all"/);
assert.match(mainSource, /function refreshFilterUI\(\)\{[\s\S]*?sanitizeParticipantFilter\(\)/,
  "refreshFilterUI must drop an out-of-candidate participant filter before rendering the select");

console.log("space-membership assertions passed");
