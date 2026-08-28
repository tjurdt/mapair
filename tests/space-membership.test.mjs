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

/* ============================================================
   Phase 3 Revised 2 — discovery ordering, root-read safety,
   stale listener/auth teardown, search session capture (§1–§6).
   ============================================================ */

/* §1 — every discovery snapshot carries a monotonic request version and the
   async result applies only if listener generation, request version, and the
   authenticated User are all still current. */
assert.match(mainSource, /const req = \+\+phase3\.discoveryReq;/,
  "each discovery snapshot must bump a per-snapshot request version");
assert.match(mainSource, /handleDiscoverySnapshot\(gen, req, uid, snap\)/);
const discoverySnapFn = mainSource.match(/async function handleDiscoverySnapshot\([\s\S]*?\n\}/);
assert.ok(discoverySnapFn, "handleDiscoverySnapshot must exist");
assert.match(discoverySnapFn[0],
  /const stillCurrent = \(\) => [^;]*gen === phase3\.discoveryGen[^;]*req === phase3\.discoveryReq[^;]*snapUid === \(user\?\.uid \|\| ""\)[^;]*snapUid === phase3\.discoveryUid/,
  "a discovery result applies only if generation, request version, and User are all current (§1)");
assert.equal((discoverySnapFn[0].match(/if \(!stillCurrent\(\)\) return;/g) || []).length, 2,
  "stillCurrent must be re-checked after every await (§1)");

/* §2 — a Firestore READ FAILURE for a Space root is never treated as "root
   missing". Read failures fail closed for the whole discovery cycle. */
assert.match(discoverySnapFn[0], /Promise\.allSettled\(mine\.map\(m => getDoc\(spaceDocFor\(m\.spaceId\)\)\)\)/,
  "root reads use allSettled so a rejection is distinguishable from a successful non-existent read (§2)");
assert.match(discoverySnapFn[0], /const readFailures = settled[\s\S]*?\.filter\(\(\{ s \}\) => s\.status === "rejected"\)/);
assert.match(discoverySnapFn[0], /if \(readFailures\.length\)\{[\s\S]*?failLocal\("Space discovery",[\s\S]*?return;/,
  "any root read failure aborts the discovery cycle and never provisions a Personal Space (§2)");
assert.match(discoverySnapFn[0], /spaceDoc: snap\.exists\(\) \? snap\.data\(\) : null/,
  "only a successful read that does not exist yields a null root (§2)");

/* §3 — collection-group path shape is validated by the pure helper. */
assert.match(mainSource, /import \{[\s\S]*?resolveSpaceMembershipPath[\s\S]*?\} from "\.\/spaces\.js"/);
assert.match(discoverySnapFn[0], /resolveSpaceMembershipPath\(row\.path, snapUid\)/,
  "discovery must validate each Membership document path against the exact Space membership shape (§3)");

/* §4 — stale listener errors + auth teardown. Every current-Space onSnapshot
   error callback is guarded; auth teardown mints a fresh Space session BEFORE
   old listeners are dropped. */
assert.match(mainSource, /const guardedError = handler => error => \{ if \(isStaleSpaceCallback\(session\)\) return; handler\(error\); \};/,
  "current-Space listener error callbacks must be wrapped so a stale Space session's errors are ignored (§4)");
assert.equal((mainSource.match(/guardedError\(error =>/g) || []).length, 5,
  "all five current-Space listeners (space root, members, places, trips, meta) must use the guarded error callback (§4)");
const discoveryErrCb = mainSource.match(/onSnapshot\(q,\s*\n[\s\S]*?err => \{([\s\S]*?)\}\s*\n\s*\);/);
assert.ok(discoveryErrCb, "discovery listener error callback must exist");
assert.match(discoveryErrCb[1], /gen !== phase3\.discoveryGen \|\| uid !== \(user\?\.uid \|\| ""\)/,
  "the discovery listener error callback must ignore errors from a superseded generation or a changed User (§4)");
const authCb = mainSource.match(/onAuthStateChanged\(auth, u => \{([\s\S]*?)\},\s*\n\s*err =>/);
assert.ok(authCb, "onAuthStateChanged callback must exist");
assert.match(authCb[1], /^\s*\/\/[\s\S]*?spaceSession = nextSpaceSession\(spaceSession, ""\);[\s\S]*?teardownPhase3\(\);[\s\S]*?unsubscribeCurrentSpaceListeners\(\);/,
  "auth teardown must invalidate the Space session BEFORE tearing down old listeners (§4)");
const teardownFn = mainSource.match(/function teardownPhase3\(\)\{([\s\S]*?)\n\}/);
assert.ok(teardownFn, "teardownPhase3 must exist");
assert.match(teardownFn[1], /phase3\.discoveryReq\+\+;\s*\n?\s*phase3\.discoveryUid = "";/,
  "teardownPhase3 must invalidate any in-flight discovery request and clear the discovery UID (§4)");

/* §5 — Google autocomplete captures its Space session AND a request generation
   BEFORE searchPlace(); a switch or newer keystroke invalidates the result, and
   each suggestion click keeps the same request session. */
const searchTimerFn = mainSource.match(/searchTimer = setTimeout\(async \(\) => \{([\s\S]*?)\}, 350\);/);
assert.ok(searchTimerFn, "the debounced search callback must exist");
assert.match(searchTimerFn[1], /const reqSession = spaceSession;\s*\n\s*const reqSeq = \+\+searchReqSeq;/,
  "the search request must capture the Space session and a request generation before it starts (§5)");
assert.match(searchTimerFn[1], /const reqCurrent = \(\) => reqSeq === searchReqSeq && isCurrentSpaceSession\(reqSession, spaceSession\);/);
assert.match(searchTimerFn[1], /rs = await searchPlace\(q\);[\s\S]*?if \(!reqCurrent\(\)\)\{ box\.style\.display = "none"; return; \}/,
  "search results are dropped if the request is no longer current (§5)");
assert.equal((searchTimerFn[1].match(/if \(!reqCurrent\(\)\) return;/g) || []).length, 2,
  "reqCurrent must be re-checked after fetchFields() and after reverseGeocode(), before openSeed() (§5)");
assert.match(mainSource, /searchReqSeq\+\+;\s*\/\/ invalidate any in-flight Google autocomplete request/,
  "switchActiveSpace must invalidate pending search requests (§5)");
assert.match(authCb[1], /searchReqSeq\+\+;/, "auth teardown must invalidate pending search requests (§5)");

/* §6 — the write serialization Map is NOT cleared on a Space switch: clearing it
   would abandon still-running Promise chains without cancelling them. */
const clearScopedFn = mainSource.match(/function clearSpaceScopedState\(\)\{([\s\S]*?)\n\}/);
assert.ok(clearScopedFn, "clearSpaceScopedState must exist");
assert.doesNotMatch(clearScopedFn[1], /placeEditorWriteQueues\.clear\(\)/,
  "clearSpaceScopedState must NOT clear placeEditorWriteQueues while writes may still be running (§6)");
assert.match(clearScopedFn[1], /placeEditorWriteQueues` is intentionally NOT cleared/,
  "the reason for not clearing placeEditorWriteQueues must be documented (§6)");
assert.match(mainSource, /settled\.finally\(\(\)=>\{ if\(placeEditorWriteQueues\.get\(key\)===settled\) placeEditorWriteQueues\.delete\(key\); \}\)/,
  "each write queue entry removes itself via its own .finally (§6)");

/* ============================================================
   Part B — Wishlist removed as a product feature (§11–§25).
   ============================================================ */
/* Phase 3 Revised 3: dormant data, auth/session lifecycle, creation deletion,
   and Membership-foundation readiness. */
const recomputeParticipantsFn = mainSource.match(/function recomputeReferencedParticipants\(\)\{([\s\S]*?)\n\}/);
assert.ok(recomputeParticipantsFn, "recomputeReferencedParticipants must exist");
assert.match(recomputeParticipantsFn[1], /for \(const place of Object\.values\(places\)\)\{\s*if \(!hasVisitHistory\(place\)\) continue;\s*whoUids\(place\)/,
  "Visit-less Places must be skipped before any participant fields are read");
for (const name of ["ensureCounty", "ensureTown", "ensureVillage"]){
  const fn = mainSource.match(new RegExp(`async function ${name}\\(\\)\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(fn, `${name} must exist`);
  assert.match(fn[1], /for \(const p of Object\.values\(places\)\)\{[\s\S]*?if \(!hasVisitHistory\(p\)\) continue;/,
    `${name} must skip dormant Places before computing or writing cache fields`);
}

assert.equal((mainSource.match(/createSpaceSession\(""\)/g) || []).length, 1,
  "createSpaceSession must only initialize the module-level session once");
const renderAppFn = mainSource.match(/async function renderApp\(\)\{([\s\S]*?)\n\}/);
assert.ok(renderAppFn, "renderApp must exist");
assert.doesNotMatch(renderAppFn[1], /createSpaceSession\(/,
  "renderApp must never reset the page-lifetime Space session version");
const authLifecycleSteps = [
  'spaceSession = nextSpaceSession(spaceSession, "")',
  "searchReqSeq++",
  "closeAllModals()",
  "cancelAddMode()",
  "clearSearchSuggestions()",
  "teardownPhase3()",
  "unsubscribeCurrentSpaceListeners()",
  "user = u"
];
let previousAuthStep = -1;
for (const step of authLifecycleSteps){
  const index = authCb[1].indexOf(step);
  assert.ok(index > previousAuthStep, `auth teardown step must be ordered: ${step}`);
  previousAuthStep = index;
}

const revised3OpenEditorFn = mainSource.match(/function openEditor\(id, seed, opts=\{\}\)\{([\s\S]*?)\n\}/);
assert.ok(revised3OpenEditorFn, "openEditor must exist for Revised 3 assertions");
const deletePlaceFn = revised3OpenEditorFn[1].match(/async function deletePlaceAndClose\(\)\{([\s\S]*?)\n  \}/);
assert.ok(deletePlaceFn, "deletePlaceAndClose must exist");
assert.match(deletePlaceFn[1], /if \(!editorLive\(\) \|\| deleted\) return;\s*deleted = true;/,
  "deletion must synchronously block later editor writes");
assert.match(deletePlaceFn[1], /await persistQueue;[\s\S]*?placeEditorWriteQueues\.get\(`\$\{editorSpaceId\}:\$\{docId\}`\)[\s\S]*?await deleteDoc\(placeDocFor\(editorSpaceId, docId\)\)/,
  "deletion must await creation and queued writes before deleting the exact originating-Space document");

assert.match(mainSource, /function currentSpaceFoundationReady\(\)\{[\s\S]*?multiSpace:isMultiSpace\(\)[\s\S]*?session:spaceSession[\s\S]*?\.\.\.spaceFoundationReads/,
  "readiness must be session-bound and delegated to the explicit policy");
assert.match(mainSource, /spaceFoundationReads\.reconciled = true;\s*setSpaceEditingAvailable\(true\);/,
  "editing becomes available only after Membership reconciliation completes");
assert.match(mainSource, /function renderList\(\)\{\s*if \(!currentSpaceFoundationReady\(\)\)\{ showSpaceLoadingState\(\); return; \}/,
  "loaded snapshots must stay non-interactive until foundation readiness");
assert.match(revised3OpenEditorFn[1], /^\s*if \(!currentSpaceFoundationReady\(\)\)\{ showSpaceLoadingState\(\); return; \}/,
  "Place editors cannot open before foundation readiness");
const revised3OpenSeedFn = mainSource.match(/function openSeed\(seed\)\{([\s\S]*?)\n\}/);
assert.ok(revised3OpenSeedFn, "openSeed must exist for Revised 3 assertions");
assert.match(revised3OpenSeedFn[1], /^\s*if \(!currentSpaceFoundationReady\(\)\) return;/,
  "search/add Visit creation cannot begin before foundation readiness");
assert.match(mainSource, /function editTrip\(id, onDone\)\{\s*if \(!currentSpaceFoundationReady\(\)\)\{ showSpaceLoadingState\(\); return; \}/,
  "Trip editor writes cannot begin before foundation readiness");

const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

/* §13 — only 去過 | 行程 tabs remain; no 想去 tab. */
assert.doesNotMatch(mainSource, /data-t="wishlist"/, "the 想去 tab must be gone (§13)");
assert.doesNotMatch(mainSource, /想去/, "no 想去 label anywhere in runtime source (§13)");
assert.match(mainSource, /<button class="tab" data-t="visited">去過<\/button>\s*\n\s*<button class="tab" data-t="trips">行程<\/button>/,
  "exactly the 去過 and 行程 tabs remain (§13)");
assert.match(mainSource, /<span class="title">\$\{isNoSpace\(\) \? "我的足跡" : "我們去過的地方"\}<\/span>/,
  "legacy Space mode must retain its original title while the explicit No-Space gate uses 我的足跡 (§13)");
assert.match(mainSource, /if \(tab !== "visited" && tab !== "trips"\) tab = "visited"/,
  "renderList must coerce any unknown tab (e.g. a stale 'wishlist') back to 'visited' (§13)");

/* §14 — the Place editor has no status toggle / 想去設定 / wishlist pickers. */
assert.doesNotMatch(mainSource, /f_status/, "the 去過了/想去 status toggle must be gone from the editor (§14)");
assert.doesNotMatch(mainSource, /f_wishlistSection|f_wishlist|wishSection/, "the 想去設定 section must be gone (§14)");
assert.doesNotMatch(mainSource, /renderWishlistParticipants|wishlistParticipants|wishlistCats/,
  "wishlist participant / category state must be gone (§14, §23)");
assert.doesNotMatch(mainSource, /\bon-w\b/, "the wishlist status button class must be gone from runtime (§14)");
assert.doesNotMatch(indexHtml, /\.on-w\b/, "the .on-w wishlist button style must be removed (§14)");

/* §14 — opening/creating a Place operates directly on Visit history. */
const openEditorFn = mainSource.match(/function openEditor\(id, seed, opts=\{\}\)\{([\s\S]*?)\n\}/);
assert.ok(openEditorFn, "openEditor must exist");
assert.match(openEditorFn[1], /if \(opts\.addVisit \|\| !id \|\| !visits\.length\)\{[\s\S]*?visits\.push\(newWorkingVisit\(/,
  "a new / Visit-less Place always gets a Visit using the Phase 2 defaults — no status choice (§14)");
assert.doesNotMatch(openEditorFn[1], /let status\b|status\s*=\s*b\.dataset\.s|status===["']wishlist["']/,
  "openEditor must not carry a visited/wishlist status variable (§14, §18)");

/* §15 — Visit-level delete: last Visit deletes the whole Place, never status="wishlist". */
const delVisitFn = mainSource.match(/async function deleteVisitOccurrence\(key\)\{([\s\S]*?)\n\}/);
assert.ok(delVisitFn, "deleteVisitOccurrence must exist");
assert.match(delVisitFn[1], /if\(!vv\.length\)\{[\s\S]*?await deleteDoc\(placeDocFor\(opSpaceId,pid\)\)/,
  "deleting the last Visit deletes the whole Place document (§15)");
assert.doesNotMatch(delVisitFn[1], /status:"wishlist"/, "deleting the last Visit must NOT downgrade the Place to wishlist (§15)");
assert.match(openEditorFn[1], /async function deletePlaceAndClose\(\)\{[\s\S]*?deleteDoc\(placeDocFor\(editorSpaceId, docId\)\)/,
  "the editor's last-Visit / 刪除地點 path deletes the Place in its originating Space (§15)");
assert.match(openEditorFn[1], /if\(visits\.length<=1\)\{ deletePlaceAndClose\(\); return; \}/,
  "the Visit-row ✕ deletes the Place when it would remove the final Visit (§15)");
assert.match(openEditorFn[1], /if\(!editorLive\(\) \|\| deleted\) return Promise\.resolve\(\);/,
  "persist() must no-op once the Place has been deleted (§15)");
assert.match(openEditorFn[1], /if\(!data\.visits\.length\) return Promise\.resolve\(\);/,
  "persist() must never autosave an empty (Visit-less) Place (§15)");

/* §16 — a central hasVisitHistory() gate; legacy wishlist docs are dormant. */
assert.match(mainSource, /function hasVisitHistory\(p\)\{\s*\n?\s*return !!p && \(\(Array\.isArray\(p\.visits\) && p\.visits\.length > 0\) \|\| !!p\.visitedOn\);/,
  "hasVisitHistory must gate on modern visits plus legacy visitedOn compat (§16)");
assert.match(mainSource, /function passFilter\(p\)\{[\s\S]*?if \(!hasVisitHistory\(p\)\) return false;/,
  "the normal list/marker filter must exclude Places with no Visit history (§16, §19)");
assert.doesNotMatch(mainSource, /p\.status\s*!==\s*"visited"/, "no runtime path may branch on p.status !== 'visited' any more (§16, §19)");
assert.doesNotMatch(mainSource, /p\.status\s*===\s*"wishlist"|p\.status\s*===\s*tab/, "no runtime path may branch on a wishlist status (§19)");

/* §20 — the 是否去過 / status marker colour mode is gone. */
assert.doesNotMatch(mainSource, /markerMode === "status"|\["status","是否去過"\]|status:"是否去過"/,
  "the status marker colour mode must be removed from Settings and the legend (§20)");
assert.doesNotMatch(mainSource, /getCSS\("--wish"\)/, "markerColor must not fall back to a wishlist colour (§20)");
const markerOptsLine = mainSource.match(/const markerOpts = \[([\s\S]*?)\];/);
assert.ok(markerOptsLine && !/status/.test(markerOptsLine[1]), "Settings marker options must not offer 'status' (§20)");

/* §22 — search / map-add is independent of the active tab. */
const openSeedFn = mainSource.match(/function openSeed\(seed\)\{([\s\S]*?)\n\}/);
assert.ok(openSeedFn, "openSeed must exist");
assert.doesNotMatch(openSeedFn[1], /tab\s*===\s*"visited"|tab\s*===\s*"wishlist"/,
  "openSeed must not depend on the active tab (§22)");
assert.match(openSeedFn[1], /if\(existing\) openEditor\(existing\.id,null,\{addVisit:true\}\);\s*else openEditor\(null,seed\);/,
  "openSeed reuses an existing Place (adding a Visit) or creates a new one with a Visit (§17, §22)");

/* §25 — no new status:"wishlist" writes anywhere in runtime. The only tolerated
   occurrences are documentation comments (legacy-compat explanation). */
const mainCode = mainSource
  .split("\n")
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");
assert.doesNotMatch(mainCode, /["']wishlist["']/,
  "runtime code must never reference a 'wishlist' status/tab value — comments aside (§18, §19, §25)");
assert.doesNotMatch(mainCode, /想去/, "no 想去 UI string in runtime code (§13, §25)");

console.log("space-membership assertions passed");
