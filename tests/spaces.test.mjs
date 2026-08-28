import assert from "node:assert/strict";
import fs from "node:fs";
import {
  activeSpacePreferenceKey,
  chooseInitialActiveSpace,
  createSpaceSession,
  discoveryDiagnostics,
  isCurrentSpaceSession,
  nextSpaceSession,
  normalizeDiscoveredSpace,
  orderSpacesForSwitcher,
  personalSpaceId,
  personalSpaceResolution,
  resolveSpaceMembershipPath,
  readActiveSpacePreference,
  spaceDisplayName,
  spaceTypeLabel,
  validateActiveSpacePreference,
  writeActiveSpacePreference,
  clearActiveSpacePreference
} from "../src/spaces.js";

const A = "test-user-a", B = "test-user-b";

/* Discovery helpers -------------------------------------------------------- */
function discovered({ spaceId, uid = A, role = "owner", status = "active", type = "personal", ownerId = A, name = "", root = true }){
  return normalizeDiscoveredSpace({
    spaceId,
    membership: { id: uid, userId: uid, role, status },
    spaceDoc: root ? { name, type, ownerId } : null
  });
}

/* 1 — deterministic Personal Space ID is stable and path-safe -------------- */
assert.equal(personalSpaceId("test-user-a"), "personal-test-user-a");
assert.equal(personalSpaceId("test-user-a"), personalSpaceId("test-user-a"), "stable across calls");
assert.equal(personalSpaceId("a/b#c"), "personal-a%2Fb%23c", "path separators are escaped");
assert.ok(!personalSpaceId("uid").includes("/"), "never contains a path separator");
assert.notEqual(personalSpaceId("aa"), personalSpaceId("ab"), "injective");
assert.throws(() => personalSpaceId(""), /non-empty uid/);

/* 2 — exactly one valid discovered Personal Space -> reuse ---------------- */
{
  const spaces = [
    discovered({ spaceId: "test-space-personal-a", type: "personal", ownerId: A, name: "甲的個人地圖" }),
    discovered({ spaceId: "test-space-group", type: "shared", ownerId: A, role: "owner", name: "四人測試地圖" })
  ];
  const res = personalSpaceResolution(spaces, A);
  assert.equal(res.action, "reuse");
  assert.equal(res.spaceId, "test-space-personal-a", "reuses the fixture ID, not the deterministic one");
}

/* 3 — no Personal Space -> provisioning required ------------------------- */
{
  const spaces = [discovered({ spaceId: "test-space-group", type: "shared", ownerId: A, name: "四人" })];
  const res = personalSpaceResolution(spaces, A);
  assert.equal(res.action, "provision");
  assert.equal(res.spaceId, "personal-test-user-a");
}

/* 4 — two valid Personal Spaces -> fail closed -------------------------- */
{
  const spaces = [
    discovered({ spaceId: "personal-1", type: "personal", ownerId: A }),
    discovered({ spaceId: "personal-2", type: "personal", ownerId: A })
  ];
  const res = personalSpaceResolution(spaces, A);
  assert.equal(res.action, "conflict");
  assert.deepEqual(res.spaceIds.sort(), ["personal-1", "personal-2"]);
}

/* 5 — removed Membership excluded from discovery ----------------------- */
{
  const removed = discovered({ spaceId: "test-space-group", type: "shared", ownerId: A, status: "removed" });
  assert.equal(removed.valid, false);
  assert.ok(removed.issues.some(i => i.code === "inactive-membership"));
  assert.deepEqual(orderSpacesForSwitcher([removed], A), []);
  assert.deepEqual(accessibleIds([removed]), []);
}

/* 6 — malformed Membership / missing root excluded -------------------- */
{
  const badId = normalizeDiscoveredSpace({ spaceId: "s1", membership: { id: A, userId: B, role: "owner", status: "active" }, spaceDoc: { type: "shared", ownerId: A } });
  assert.equal(badId.valid, false);
  assert.ok(badId.issues.some(i => i.code === "membership-id-mismatch"));

  const noRoot = discovered({ spaceId: "s2", type: "shared", ownerId: A, root: false });
  assert.equal(noRoot.valid, false);
  assert.ok(noRoot.issues.some(i => i.code === "missing-space-root"));

  const badType = normalizeDiscoveredSpace({ spaceId: "s3", membership: { id: A, userId: A, role: "owner", status: "active" }, spaceDoc: { type: "team", ownerId: A } });
  assert.equal(badType.valid, false);
  assert.ok(badType.issues.some(i => i.code === "invalid-space-type"));

  const diag = discoveryDiagnostics([badId, noRoot, badType]);
  assert.equal(diag.length, 3);
}

/* 7 — Personal Space sorts before Shared ----------------------------- */
{
  const personal = discovered({ spaceId: "pa", type: "personal", ownerId: A, name: "我的地圖" });
  const s1 = discovered({ spaceId: "s1", type: "shared", ownerId: B, role: "member", name: "Alpha" });
  const s2 = discovered({ spaceId: "s2", type: "shared", ownerId: B, role: "member", name: "Beta" });
  const order = orderSpacesForSwitcher([s2, s1, personal], A).map(s => s.id);
  assert.deepEqual(order, ["pa", "s1", "s2"], "personal first, then shared alphabetically");
}

/* 8 — identical Space names remain distinct internally --------------- */
{
  const x = discovered({ spaceId: "space-x", type: "shared", ownerId: B, role: "member", name: "家庭旅行" });
  const y = discovered({ spaceId: "space-y", type: "shared", ownerId: B, role: "member", name: "家庭旅行" });
  const order = orderSpacesForSwitcher([x, y], A);
  assert.equal(order.length, 2);
  assert.notEqual(order[0].id, order[1].id, "routing still distinguishes them by ID");
  assert.equal(order[0].name, order[1].name);
  assert.equal(spaceDisplayName(order[0]), spaceDisplayName(order[1]));
}

/* 9 — saved accessible preference wins ------------------------------ */
assert.deepEqual(
  chooseInitialActiveSpace({ savedPreferenceId: "s-shared", personalSpaceId: "p-a", accessibleSpaceIds: ["p-a", "s-shared"] }),
  { spaceId: "s-shared", source: "preference" }
);

/* 10 — inaccessible saved preference falls back to Personal -------- */
assert.deepEqual(
  chooseInitialActiveSpace({ savedPreferenceId: "s-gone", personalSpaceId: "p-a", accessibleSpaceIds: ["p-a"] }),
  { spaceId: "p-a", source: "personal" }
);

/* 11 — explicit accessible local testSpace wins ------------------- */
assert.deepEqual(
  chooseInitialActiveSpace({
    explicitRequested: true, explicitTestSpaceId: "test-space-group",
    savedPreferenceId: "p-a", personalSpaceId: "p-a",
    accessibleSpaceIds: ["p-a", "test-space-group"]
  }),
  { spaceId: "test-space-group", source: "explicit" }
);

/* 12 — explicit inaccessible testSpace fails LOCAL TEST ---------- */
{
  const res = chooseInitialActiveSpace({
    explicitRequested: true, explicitTestSpaceId: "test-space-group",
    personalSpaceId: "p-a", accessibleSpaceIds: ["p-a"]
  });
  assert.equal(res.spaceId, null);
  assert.equal(res.error, "explicit-inaccessible", "never silently selects another Space");
}
/* and: no personal available at all -> fail closed */
assert.equal(chooseInitialActiveSpace({ accessibleSpaceIds: [] }).error, "no-personal");

/* 13 — active-Space preference is scoped by project + uid -------- */
{
  assert.equal(activeSpacePreferenceKey("proj-x", A), "mapair.activeSpace.v1:proj-x:test-user-a");
  assert.notEqual(activeSpacePreferenceKey("proj-x", A), activeSpacePreferenceKey("proj-y", A), "scoped by project");
  assert.notEqual(activeSpacePreferenceKey("proj-x", A), activeSpacePreferenceKey("proj-x", B), "scoped by uid");

  const store = new Map();
  const storage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  writeActiveSpacePreference(storage, "proj-x", A, "space-1");
  assert.equal(readActiveSpacePreference(storage, "proj-x", A), "space-1");
  assert.equal(readActiveSpacePreference(storage, "proj-x", B), null, "another account never reads it");
  assert.equal(readActiveSpacePreference(storage, "proj-y", A), null, "another project never reads it");
  clearActiveSpacePreference(storage, "proj-x", A);
  assert.equal(readActiveSpacePreference(storage, "proj-x", A), null);

  // storage failure must not throw
  const broken = { getItem(){ throw new Error("blocked"); }, setItem(){ throw new Error("blocked"); }, removeItem(){ throw new Error("blocked"); } };
  assert.equal(readActiveSpacePreference(broken, "p", A), null);
  assert.doesNotThrow(() => writeActiveSpacePreference(broken, "p", A, "x"));
  assert.doesNotThrow(() => clearActiveSpacePreference(broken, "p", A));
  assert.equal(readActiveSpacePreference(null, "p", A), null);

  assert.equal(validateActiveSpacePreference("space-1", ["space-1", "space-2"]), "space-1");
  assert.equal(validateActiveSpacePreference("space-9", ["space-1"]), null);
  assert.equal(validateActiveSpacePreference("", ["space-1"]), null);
}

/* 14 — stale session version is rejected ------------------------ */
{
  const s1 = createSpaceSession("space-a");
  assert.deepEqual(s1, { spaceId: "space-a", version: 1 });
  const s2 = nextSpaceSession(s1, "space-b");
  assert.equal(s2.version, 2);
  assert.equal(s2.spaceId, "space-b");
  assert.equal(isCurrentSpaceSession(s2, s2), true);
  assert.equal(isCurrentSpaceSession(s1, s2), false, "an older session version is not current");
  assert.equal(isCurrentSpaceSession({ spaceId: "space-b", version: 2 }, s2), true, "value equality, not identity");
  assert.equal(isCurrentSpaceSession(null, s2), false);
}

/* 15 — an A-session callback must not apply to B --------------- */
{
  // Simulated: a callback captured `session` while Space A was active; the app
  // then switched to Space B. The captured session must read as not-current.
  let current = createSpaceSession("space-A");
  const capturedByAWork = current;
  current = nextSpaceSession(current, "space-B");   // user switched
  const applyResult = () => {
    if (!isCurrentSpaceSession(capturedByAWork, current)) return "ignored";
    return "applied";
  };
  assert.equal(applyResult(), "ignored", "the A-session result is dropped once B is active");
  // and a B-session callback still applies
  const capturedByBWork = current;
  assert.equal(isCurrentSpaceSession(capturedByBWork, current), true);
}

/* Labels never expose IDs ------------------------------------- */
assert.equal(spaceTypeLabel({ isPersonal: true }), "私人");
assert.equal(spaceTypeLabel({ isPersonal: false }), "共享");
assert.equal(spaceDisplayName({ isPersonal: true, name: "" }), "我的地圖");
assert.equal(spaceDisplayName({ isPersonal: false, name: "" }), "共享地圖");
assert.equal(spaceDisplayName({ isPersonal: false, name: "大學朋友" }), "大學朋友");

function accessibleIds(list){ return list.filter(s => s.valid).map(s => s.id); }

/* Fixture parity: A discovers baseline + personal-a + group; not b's spaces */
{
  const multiUser = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-multi-user.json", import.meta.url), "utf8"));
  const byPath = new Map(multiUser.documents.map(d => [d.path, d.data]));
  const aMemberships = multiUser.documents.filter(d => /^spaces\/[^/]+\/members\/test-user-a$/.test(d.path));
  const aSpaces = aMemberships
    .filter(d => d.data.status === "active")
    .map(d => {
      const spaceId = d.path.split("/")[1];
      return normalizeDiscoveredSpace({
        spaceId,
        membership: { id: "test-user-a", ...d.data },
        spaceDoc: byPath.get(`spaces/${spaceId}`) || null
      });
    });
  const ids = aSpaces.filter(s => s.valid).map(s => s.id).sort();
  assert.deepEqual(ids, ["test-space-baseline", "test-space-group", "test-space-personal-a"]);
  const res = personalSpaceResolution(aSpaces, "test-user-a");
  assert.equal(res.action, "reuse");
  assert.equal(res.spaceId, "test-space-personal-a");
  const order = orderSpacesForSwitcher(aSpaces, "test-user-a").map(s => s.id);
  assert.equal(order[0], "test-space-personal-a", "own Personal Space leads the switcher");
}

/* 16 — collection-group Membership path shape validation (§3) ------------- */
{
  // Only an exact spaces/{spaceId}/members/{uid} path is trusted.
  const ok = resolveSpaceMembershipPath("spaces/test-space-group/members/test-user-a", "test-user-a");
  assert.equal(ok.valid, true);
  assert.equal(ok.spaceId, "test-space-group");
  assert.equal(ok.memberUid, "test-user-a");

  // A collectionGroup("members") query can match any collection named "members".
  assert.equal(resolveSpaceMembershipPath("other/foo/members/test-user-a").valid, false, "wrong root collection");
  assert.equal(resolveSpaceMembershipPath("other/foo/members/test-user-a").reason, "not-a-space-membership-path");
  assert.equal(resolveSpaceMembershipPath("spaces/foo/nested/bar/members/test-user-a").valid, false, "deeper than one Space");
  assert.equal(resolveSpaceMembershipPath("spaces/foo/nested/bar/members/test-user-a").reason, "unexpected-path-depth");
  assert.equal(resolveSpaceMembershipPath("spaces//members/test-user-a").valid, false, "empty spaceId segment");
  assert.equal(resolveSpaceMembershipPath("spaces/foo/members/").valid, false, "empty uid segment");
  assert.equal(resolveSpaceMembershipPath("spaces/foo/friends/test-user-a").valid, false, "not the members collection");
  assert.equal(resolveSpaceMembershipPath("").valid, false);
  assert.equal(resolveSpaceMembershipPath(null).valid, false);

  // The discovered member document must belong to the authenticated User.
  const mismatch = resolveSpaceMembershipPath("spaces/s1/members/test-user-b", "test-user-a");
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reason, "member-uid-mismatch");
  // Without an expected uid it only checks shape.
  assert.equal(resolveSpaceMembershipPath("spaces/s1/members/test-user-b").valid, true);
}

/* 17 — strengthened discovered-Space ownership validation (§7) ------------ */
{
  // Personal Space discovered only as a plain member is invalid.
  const personalAsMember = normalizeDiscoveredSpace({
    spaceId: "test-space-personal-a",
    membership: { id: A, userId: A, role: "member", status: "active" },
    spaceDoc: { type: "personal", ownerId: A, name: "個人" }
  });
  assert.equal(personalAsMember.valid, false);
  assert.ok(personalAsMember.issues.some(i => i.code === "personal-not-owner"));

  // Personal Space whose root ownerId is a different UID than the Membership.
  const personalOwnerMismatch = normalizeDiscoveredSpace({
    spaceId: "p", membership: { id: A, userId: A, role: "owner", status: "active" },
    spaceDoc: { type: "personal", ownerId: B, name: "個人" }
  });
  assert.equal(personalOwnerMismatch.valid, false);
  assert.ok(personalOwnerMismatch.issues.some(i => i.code === "personal-owner-mismatch"));

  // Root with no usable ownerId at all.
  const noOwner = normalizeDiscoveredSpace({
    spaceId: "s", membership: { id: A, userId: A, role: "member", status: "active" },
    spaceDoc: { type: "shared", ownerId: "  ", name: "共享" }
  });
  assert.equal(noOwner.valid, false);
  assert.ok(noOwner.issues.some(i => i.code === "missing-owner-id"));

  // owner Membership that does not match Space.ownerId.
  const ownerContradiction = normalizeDiscoveredSpace({
    spaceId: "s", membership: { id: A, userId: A, role: "owner", status: "active" },
    spaceDoc: { type: "shared", ownerId: B, name: "共享" }
  });
  assert.equal(ownerContradiction.valid, false);
  assert.ok(ownerContradiction.issues.some(i => i.code === "owner-id-contradiction"));

  // Space.ownerId == Membership UID but the role is only "member".
  const selfOwnerWrongRole = normalizeDiscoveredSpace({
    spaceId: "s", membership: { id: A, userId: A, role: "member", status: "active" },
    spaceDoc: { type: "shared", ownerId: A, name: "共享" }
  });
  assert.equal(selfOwnerWrongRole.valid, false);
  assert.ok(selfOwnerWrongRole.issues.some(i => i.code === "self-owner-wrong-role"));

  // A well-formed shared Space where the viewer is a member of someone else's Space stays valid.
  const validSharedMember = normalizeDiscoveredSpace({
    spaceId: "s", membership: { id: A, userId: A, role: "member", status: "active" },
    spaceDoc: { type: "shared", ownerId: B, name: "共享" }
  });
  assert.equal(validSharedMember.valid, true);
  // A valid Personal Space discovered as owner still passes.
  const validPersonal = normalizeDiscoveredSpace({
    spaceId: "p", membership: { id: A, userId: A, role: "owner", status: "active" },
    spaceDoc: { type: "personal", ownerId: A, name: "個人" }
  });
  assert.equal(validPersonal.valid, true);
  assert.equal(validPersonal.userId, A, "normalised userId comes from the Membership document ID");
}

console.log("spaces assertions passed");
