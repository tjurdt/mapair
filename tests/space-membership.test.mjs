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

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
assert.equal((mainSource.match(/runtimeConfig\.spaceId/g) || []).length, 1, "runtime config spaceId should only initialize currentSpaceId");
assert.match(mainSource, /const spaceDoc\s*=\s*\(\)\s*=>\s*doc\(db,\s*"spaces",\s*currentSpaceId\)/);
assert.match(mainSource, /const membersCol\s*=\s*\(\)\s*=>\s*collection\(db,\s*"spaces",\s*currentSpaceId,\s*"members"\)/);
assert.match(mainSource, /currentSpaceUnsubscribes\.set\("space",\s*onSnapshot\(spaceDoc\(\)/);
assert.match(mainSource, /currentSpaceUnsubscribes\.set\("members",\s*onSnapshot\(membersCol\(\)/);
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*spaceDoc\s*\(/, "startup/runtime must not create or update root Space documents");
assert.doesNotMatch(mainSource, /setDoc\s*\(\s*memberDoc\s*\(/, "startup/runtime must not create or update Membership documents");
assert.doesNotMatch(mainSource, /addDoc\s*\(\s*membersCol\s*\(/, "startup/runtime must not create Membership documents");

console.log("space-membership assertions passed");
