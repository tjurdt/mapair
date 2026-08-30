import assert from "node:assert/strict";
import {
  isPathSafeId,
  mergeFriendIdsIntoDirectory,
  normalizeFriendDoc,
  orderMembersForPicker,
  validateFriendInput
} from "../src/friends.js";

const SELF = "uid-self", A = "uid-aaa", B = "uid-bbb", C = "uid-ccc";

/* ------------------------------------------------------------
   isPathSafeId
   ------------------------------------------------------------ */
assert.equal(isPathSafeId("abcDEF123"), true, "plain UID is path-safe");
assert.equal(isPathSafeId("  spaced  "), true, "trims before checking");
assert.equal(isPathSafeId(""), false, "empty is not path-safe");
assert.equal(isPathSafeId("a/b"), false, "slash is rejected");
assert.equal(isPathSafeId("."), false, "dot is rejected");
assert.equal(isPathSafeId(".."), false, "double dot is rejected");
assert.equal(isPathSafeId(42), false, "non-string is rejected");

/* ------------------------------------------------------------
   normalizeFriendDoc
   ------------------------------------------------------------ */
{
  const n = normalizeFriendDoc(A, { nickname: "  Bestie ", pinned: true, state: "linked", createdAt: 1 });
  assert.deepEqual(n, { friendUid: A, nickname: "Bestie", pinned: true, state: "linked" });
}
{
  // missing / unknown fields collapse to safe defaults
  const n = normalizeFriendDoc(A, {});
  assert.deepEqual(n, { friendUid: A, nickname: "", pinned: false, state: "linked" });
}
{
  const n = normalizeFriendDoc(A, { state: "banana", pinned: "yes", nickname: 5 });
  assert.equal(n.state, "linked", "unknown state collapses to linked");
  assert.equal(n.pinned, false, "non-true pinned is false");
  assert.equal(n.nickname, "", "non-string nickname is dropped");
}
assert.equal(normalizeFriendDoc("a/b", {}), null, "unusable id yields null");
assert.equal(normalizeFriendDoc("", {}), null, "empty id yields null");
assert.equal(normalizeFriendDoc(A, { state: "pending_out" }).state, "pending_out", "pending_out is preserved");

/* ------------------------------------------------------------
   validateFriendInput
   ------------------------------------------------------------ */
assert.deepEqual(validateFriendInput("  " + A + " ", { selfUid: SELF, existingUids: [B] }), { ok: true, friendUid: A });
assert.deepEqual(validateFriendInput("", {}), { ok: false, reason: "empty" });
assert.deepEqual(validateFriendInput("x/y", {}), { ok: false, reason: "invalid" });
assert.deepEqual(validateFriendInput(SELF, { selfUid: SELF }), { ok: false, reason: "self" });
assert.deepEqual(validateFriendInput(B, { existingUids: [B] }), { ok: false, reason: "duplicate" });

/* ------------------------------------------------------------
   mergeFriendIdsIntoDirectory
   ------------------------------------------------------------ */
assert.deepEqual(
  mergeFriendIdsIntoDirectory([SELF, B], [A, B]),
  [A, B, SELF].sort(),
  "dedupes and sorts the union"
);
assert.deepEqual(mergeFriendIdsIntoDirectory([], []), [], "empty union is empty");
assert.deepEqual(mergeFriendIdsIntoDirectory([SELF], [""]), [SELF], "unusable friend ids are dropped");

/* ------------------------------------------------------------
   orderMembersForPicker
   ------------------------------------------------------------ */
{
  const members = [
    { userId: C, displayName: "Zoe" },
    { userId: SELF, displayName: "Me" },
    { userId: A, displayName: "Ann" },
    { userId: B, displayName: "Bob" }
  ];
  const ordered = orderMembersForPicker(members, { selfUid: SELF, pinnedUids: [B] });
  assert.deepEqual(ordered.map(m => m.userId), [SELF, B, A, C], "self, then pinned, then rest by name");
}
{
  // no self, no pins -> pure name order, input untouched
  const members = [{ userId: B, displayName: "Bob" }, { userId: A, displayName: "Ann" }];
  const ordered = orderMembersForPicker(members, {});
  assert.deepEqual(ordered.map(m => m.userId), [A, B]);
  assert.deepEqual(members.map(m => m.userId), [B, A], "does not mutate the input array");
}

console.log("friends assertions passed");
