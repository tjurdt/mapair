import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyParticipants,
  deriveLegacyWhoMode,
  detectParticipantMismatch,
  formatParticipantSummary,
  isUsableUid,
  isValidUidArray,
  nextVisitParticipantFields,
  orderParticipantSelection,
  participantColorIndex,
  partitionResolvedParticipants,
  participantWritePayload,
  resolvePlaceCompatParticipants,
  resolveVisitParticipants,
  sanitizeParticipantsForNewSelection,
  usableUidArray
} from "../src/participants.js";

const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-baseline.json", import.meta.url), "utf8"));
const multiUser = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-multi-user.json", import.meta.url), "utf8"));
const docs = new Map(multiUser.documents.map(document => [document.path, document.data]));

const A = "test-user-a", B = "test-user-b", C = "test-user-c", D = "test-user-d";
const GROUP_ACTIVE = [A, B, C];
const BASELINE_LEGACY = Object.keys(baseline.meta.config.members); // [A, B]

function groupVisit(placeId, visitId){
  const place = docs.get(`spaces/test-space-group/places/${placeId}`);
  return { place, visit: place.visits.find(visit => visit.id === visitId) };
}

/* ------------------------------------------------------------
   §1 — Visit read precedence
   ------------------------------------------------------------ */

// A. participantIds authoritative when present and valid
{
  const { visit, place } = groupVisit("place-test-group-museum", "visit-test-group-participant-ids");
  const result = resolveVisitParticipants(visit, place, { legacyMemberIds: GROUP_ACTIVE });
  assert.deepEqual(result.participantIds, [A, B, C]);
  assert.equal(result.source, "visit-participant-ids");
  assert.equal(result.issues.length, 0);
}

// A. explicit empty participantIds MUST NOT fall through to who / place
{
  const result = resolveVisitParticipants(
    { participantIds: [], who: [A, B] },
    { who: [A, B], whoMode: "both", createdBy: A },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, []);
  assert.equal(result.source, "empty");
  assert.equal(result.issues.length, 0);
}

// B. legacy who used when participantIds absent
{
  const { visit, place } = groupVisit("place-test-group-museum", "visit-test-group-legacy-who");
  assert.equal(Object.hasOwn(visit, "participantIds"), false);
  const result = resolveVisitParticipants(visit, place, { legacyMemberIds: GROUP_ACTIVE });
  assert.deepEqual(result.participantIds, [A, B]);
  assert.equal(result.source, "visit-who");
}

// C. place-level compatibility fallback when the Visit has neither field
{
  const result = resolveVisitParticipants(
    { date: "2024-01-01" },
    { createdBy: A, who: [B] },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, [B]);
  assert.equal(result.source, "place-compat");
}

// C/D. legacy whoMode fallback preserved for genuinely legacy data (no usable who)
{
  const result = resolveVisitParticipants(
    { date: "2023-12-15" },
    { createdBy: A, whoMode: "partner" },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, [B], "whoMode:partner resolves to the non-creator legacy member");
}

// both-equal fixture: no conflict, participantIds wins
{
  const { visit, place } = groupVisit("place-test-group-museum", "visit-test-group-both-equal");
  const result = resolveVisitParticipants(visit, place, { legacyMemberIds: GROUP_ACTIVE });
  assert.deepEqual(result.participantIds, [B, C]);
  assert.equal(detectParticipantMismatch(visit).mismatch, false);
}

// Malformed participantIds -> structured issue, safe fallback, not normalized
{
  const visit = { participantIds: [A, "", 7], who: [A, B] };
  const result = resolveVisitParticipants(visit, { createdBy: A }, { legacyMemberIds: BASELINE_LEGACY });
  assert.deepEqual(result.participantIds, [A, B], "falls back to legacy who");
  assert.equal(result.source, "visit-who");
  assert.ok(result.issues.some(issue => issue.code === "malformed-participant-ids"));
  assert.equal(isValidUidArray(visit.participantIds), false);
}

// Malformed participantIds with no usable who -> place compatibility, still reported
{
  const result = resolveVisitParticipants(
    { participantIds: null },
    { createdBy: A },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, [A]);
  assert.ok(result.issues.some(issue => issue.code === "malformed-participant-ids"));
}

/* ------------------------------------------------------------
   §2 — mismatch policy
   ------------------------------------------------------------ */
{
  const { visit } = groupVisit("place-test-group-garden", "visit-test-group-mismatch");
  const detected = detectParticipantMismatch(visit);
  assert.equal(detected.mismatch, true);
  assert.deepEqual(detected.who, [A, B]);
  assert.deepEqual(detected.participantIds, [A, C]);

  // domain/display/filter behaviour uses participantIds [A, C]
  const resolved = resolveVisitParticipants(visit, docs.get("spaces/test-space-group/places/place-test-group-garden"), { legacyMemberIds: GROUP_ACTIVE });
  assert.deepEqual(resolved.participantIds, [A, C]);

  // an unrelated edit (date/category/trip) must preserve BOTH raw arrays
  const preserved = nextVisitParticipantFields({ raw: visit, edited: false });
  assert.deepEqual(preserved.who, [A, B]);
  assert.deepEqual(preserved.participantIds, [A, C]);

  // only an explicit participant edit reconciles them
  const reconciled = nextVisitParticipantFields({ raw: visit, edited: true, selectedIds: [A, B, C] });
  assert.deepEqual(reconciled.participantIds, [A, B, C]);
  assert.deepEqual(reconciled.who, [A, B, C]);
}

assert.equal(detectParticipantMismatch({ who: [A, B] }), null);
assert.equal(detectParticipantMismatch({ participantIds: [A, B] }), null);

/* ------------------------------------------------------------
   §3 / §8 — write policy & raw-field preservation
   ------------------------------------------------------------ */

// legacy who-only Visit: unrelated edit does NOT backfill participantIds
{
  const fields = nextVisitParticipantFields({ raw: { who: [A, B] }, edited: false });
  assert.deepEqual(fields, { who: [A, B] });
  assert.equal(Object.hasOwn(fields, "participantIds"), false);
}

// participantIds-only Visit: unrelated edit preserves it, does NOT add who
{
  const fields = nextVisitParticipantFields({ raw: { participantIds: [A, B, C] }, edited: false });
  assert.deepEqual(fields, { participantIds: [A, B, C] });
  assert.equal(Object.hasOwn(fields, "who"), false);
}

// Visit with neither field: materialise who, never participantIds
assert.deepEqual(nextVisitParticipantFields({ raw: {}, edited: false, resolvedIds: [A] }), { who: [A] });

// explicit participant edit / new Visit: write both identically
{
  assert.deepEqual(participantWritePayload([A, C, A]), { participantIds: [A, C], who: [A, C] });
  assert.deepEqual(nextVisitParticipantFields({ raw: {}, edited: true, selectedIds: [A] }), { participantIds: [A], who: [A] });
  assert.deepEqual(nextVisitParticipantFields({ raw: { who: [A, B] }, edited: true, selectedIds: [] }), { participantIds: [], who: [] });
}

/* ------------------------------------------------------------
   §1 — historical (removed / unknown) participants are ONE-WAY removable
   ------------------------------------------------------------ */
{
  const { visit, place } = groupVisit("place-test-group-garden", "visit-test-group-removed-member");
  const resolved = resolveVisitParticipants(visit, place, { legacyMemberIds: GROUP_ACTIVE }).participantIds;
  assert.deepEqual(resolved, [A, D]);

  const parts = partitionResolvedParticipants(resolved, GROUP_ACTIVE);
  assert.deepEqual(parts.activeSelected, [A]);
  assert.deepEqual(parts.historical, [D]);

  // working selection = active-first order, historical retained (not force-appended,
  // just kept because it is already there)
  assert.deepEqual(orderParticipantSelection([D, A], GROUP_ACTIVE), [A, D]);

  // untouched edit preserves D
  assert.deepEqual(nextVisitParticipantFields({ raw: visit, edited: false }), { participantIds: [A, D] });

  // explicit removal of D -> selection [A]; both fields become [A]
  const afterRemoval = orderParticipantSelection([A, D].filter(x => x !== D), GROUP_ACTIVE);
  assert.deepEqual(afterRemoval, [A]);
  assert.deepEqual(nextVisitParticipantFields({ raw: visit, edited: true, selectedIds: afterRemoval }), { participantIds: [A], who: [A] });

  // D is not an active candidate and cannot be re-added through the active list
  assert.ok(!GROUP_ACTIVE.includes(D));
  assert.deepEqual(sanitizeParticipantsForNewSelection([A, D, C], GROUP_ACTIVE), [A, C]);

  // toggling an active member while D is still present does not drop D
  assert.deepEqual(orderParticipantSelection([A, D, B], GROUP_ACTIVE), [A, B, D]);
}

// an unknown historical UID behaves the same (preserved, one-way removable)
{
  const raw = { participantIds: [A, "ghost-uid"] };
  assert.deepEqual(nextVisitParticipantFields({ raw, edited: false }), { participantIds: [A, "ghost-uid"] });
  const removed = orderParticipantSelection([A, "ghost-uid"].filter(x => x !== "ghost-uid"), GROUP_ACTIVE);
  assert.deepEqual(nextVisitParticipantFields({ raw, edited: true, selectedIds: removed }), { participantIds: [A], who: [A] });
}

/* ------------------------------------------------------------
   §4 / §6 — legacy whoMode serialization must be unambiguous
   ------------------------------------------------------------ */

// exactly-two-person universe, explicit in-universe createdBy, exact set match
assert.equal(deriveLegacyWhoMode([A, B], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "both");
assert.equal(deriveLegacyWhoMode([A], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "me");
assert.equal(deriveLegacyWhoMode([B], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "partner");

// arbitrary 3+ participant data -> no invented whoMode
assert.equal(deriveLegacyWhoMode([A, B, C], { legacyMemberIds: GROUP_ACTIVE, createdBy: A }), "");
assert.equal(deriveLegacyWhoMode([A, B], { legacyMemberIds: [A, B, C, D], createdBy: A }), "");
assert.equal(deriveLegacyWhoMode([], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "");
assert.equal(deriveLegacyWhoMode([A, "stranger"], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "");

// ambiguous anchor -> "" (no fallback to universe[0])
assert.equal(deriveLegacyWhoMode([A], { legacyMemberIds: BASELINE_LEGACY, createdBy: "" }), "", "missing createdBy is ambiguous");
assert.equal(deriveLegacyWhoMode([A], { legacyMemberIds: BASELINE_LEGACY, createdBy: C }), "", "createdBy outside the universe is ambiguous");
assert.equal(deriveLegacyWhoMode([A, B], { legacyMemberIds: BASELINE_LEGACY }), "", "no createdBy is ambiguous even for a full match");

/* ------------------------------------------------------------
   §5 — Place compat precedence: usable `who` beats stale `whoMode`
   ------------------------------------------------------------ */

// N-person place.who is not collapsed by a stale two-person whoMode
assert.deepEqual(
  resolvePlaceCompatParticipants(
    { who: [A, B, C], whoMode: "both", createdBy: A },
    { legacyMemberIds: BASELINE_LEGACY }
  ),
  [A, B, C],
  "usable who wins over whoMode"
);

// whoMode still resolves when there is no usable who, for a genuine two-person universe
assert.deepEqual(
  resolvePlaceCompatParticipants({ whoMode: "partner", createdBy: A }, { legacyMemberIds: BASELINE_LEGACY }),
  [B]
);
assert.deepEqual(
  resolvePlaceCompatParticipants({ whoMode: "both" }, { legacyMemberIds: BASELINE_LEGACY }),
  [A, B]
);

// 3+ member legacy universe: whoMode must not invent a two-person set
assert.deepEqual(
  resolvePlaceCompatParticipants({ whoMode: "both", createdBy: A }, { legacyMemberIds: [A, B, C] }),
  [A],
  "no usable who + non-two-person universe -> creator only"
);
assert.deepEqual(
  resolvePlaceCompatParticipants({ whoMode: "partner", createdBy: C }, { legacyMemberIds: BASELINE_LEGACY }),
  [C],
  "me/partner needs createdBy inside the two-person universe"
);

// empty `who` array is unusable -> falls through, not treated as an explicit empty set
assert.deepEqual(
  resolvePlaceCompatParticipants({ who: [], whoMode: "both", createdBy: A }, { legacyMemberIds: BASELINE_LEGACY }),
  [A, B]
);

/* ------------------------------------------------------------
   §7 — UID-deterministic participant colours
   ------------------------------------------------------------ */
{
  const SIZE = 12;
  const idxA = participantColorIndex(A, SIZE);
  assert.equal(participantColorIndex(A, SIZE), idxA, "same UID -> same index");
  assert.equal(participantColorIndex(" " + A + " ".trim(), SIZE), idxA); // trims

  // adding/removing/reordering other Members never changes a UID's index
  for (const roster of [[A, B, C], [C, B, A], [D, A], [A]]){
    for (const uid of roster){
      assert.equal(participantColorIndex(uid, SIZE), participantColorIndex(uid, SIZE));
    }
  }
  assert.equal(participantColorIndex(B, SIZE), participantColorIndex(B, SIZE));
  assert.ok(Number.isInteger(idxA) && idxA >= 0 && idxA < SIZE);
  assert.equal(participantColorIndex("", SIZE), 0);
  assert.equal(participantColorIndex(A, 0), 0, "defensive: bad palette size");
}

/* ------------------------------------------------------------
   Display helpers
   ------------------------------------------------------------ */
{
  const nameOf = uid => ({ [A]: "甲", [B]: "乙", [C]: "丙", [D]: "丁" })[uid] || "Member";
  assert.equal(formatParticipantSummary([], nameOf, { empty: "未記錄" }), "未記錄");
  assert.equal(formatParticipantSummary([A, B], nameOf), "甲、乙");
  assert.equal(formatParticipantSummary([A, B, C, D], nameOf, { max: 2 }), "甲、乙…共 4 人");
  assert.equal(formatParticipantSummary(["ghost"], nameOf), "Member", "unknown UID never leaks");

  assert.equal(classifyParticipants([]).kind, "none");
  assert.equal(classifyParticipants([A]).kind, "solo");
  assert.equal(classifyParticipants([A, B]).kind, "group");
  assert.equal(classifyParticipants([A, B, C]).kind, "group", "three people are not special vs two");
}

/* ------------------------------------------------------------
   Place-level compatibility parity with the legacy two-person model
   ------------------------------------------------------------ */
{
  const station = baseline.places.find(place => place.id === "place-test-station").data;
  assert.deepEqual(resolvePlaceCompatParticipants(station, { legacyMemberIds: BASELINE_LEGACY }), [A, B]);
  const park = baseline.places.find(place => place.id === "place-test-park").data;
  assert.deepEqual(resolvePlaceCompatParticipants(park, { legacyMemberIds: BASELINE_LEGACY }), [B]);
  const cafe = baseline.places.find(place => place.id === "place-test-cafe").data;
  assert.deepEqual(resolvePlaceCompatParticipants(cafe, { legacyMemberIds: BASELINE_LEGACY }), [A]);
  const wishlist = baseline.places.find(place => place.id === "place-test-wishlist").data;
  assert.deepEqual(resolvePlaceCompatParticipants(wishlist, { legacyMemberIds: BASELINE_LEGACY }), [A, B]);
  const legacyPlace = baseline.places.find(place => place.id === "place-test-legacy-no-created-at").data;
  assert.deepEqual(resolvePlaceCompatParticipants(legacyPlace, { legacyMemberIds: BASELINE_LEGACY }), [B]);
}

assert.equal(usableUidArray(["", "  "]), null);
assert.deepEqual(usableUidArray([" x ", "y"]), [" x ", "y"]);
assert.equal(isUsableUid("  "), false);
assert.equal(isUsableUid("x"), true);

console.log("participants assertions passed");
