import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyParticipants,
  composeParticipantSelection,
  deriveLegacyWhoMode,
  detectParticipantMismatch,
  formatParticipantSummary,
  isValidUidArray,
  nextVisitParticipantFields,
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
   Contract §1 — read precedence
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
    { createdBy: A, who: [B], whoMode: "partner" },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, [B]);
  assert.equal(result.source, "place-compat");
}

// C/D. legacy whoMode fallback preserved for genuinely legacy data
{
  const legacyPlace = baseline.places.find(place => place.id === "place-test-legacy-no-created-at").data;
  const result = resolveVisitParticipants({ date: legacyPlace.visitedOn }, legacyPlace, { legacyMemberIds: BASELINE_LEGACY });
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
    { createdBy: A, whoMode: "me" },
    { legacyMemberIds: BASELINE_LEGACY }
  );
  assert.deepEqual(result.participantIds, [A]);
  assert.ok(result.issues.some(issue => issue.code === "malformed-participant-ids"));
}

/* ------------------------------------------------------------
   Contract §2 — mismatch policy
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

// mismatch detection does not apply without both fields
assert.equal(detectParticipantMismatch({ who: [A, B] }), null);
assert.equal(detectParticipantMismatch({ participantIds: [A, B] }), null);

/* ------------------------------------------------------------
   Contract §3 / §8 — write policy & raw-field preservation
   ------------------------------------------------------------ */

// legacy who-only Visit: unrelated edit does NOT backfill participantIds
{
  const raw = { who: [A, B] };
  const fields = nextVisitParticipantFields({ raw, edited: false });
  assert.deepEqual(fields, { who: [A, B] });
  assert.equal(Object.hasOwn(fields, "participantIds"), false);
}

// participantIds-only Visit: unrelated edit preserves it, does NOT add who
{
  const raw = { participantIds: [A, B, C] };
  const fields = nextVisitParticipantFields({ raw, edited: false });
  assert.deepEqual(fields, { participantIds: [A, B, C] });
  assert.equal(Object.hasOwn(fields, "who"), false);
}

// Visit with neither field: keeps today's behaviour (materialise who, never participantIds)
{
  const fields = nextVisitParticipantFields({ raw: {}, edited: false, resolvedIds: [A] });
  assert.deepEqual(fields, { who: [A] });
}

// explicit participant edit / new Visit: write both identically
{
  assert.deepEqual(participantWritePayload([A, C, A]), { participantIds: [A, C], who: [A, C] });
  const created = nextVisitParticipantFields({ raw: {}, edited: true, selectedIds: [A] });
  assert.deepEqual(created, { participantIds: [A], who: [A] });
  const emptied = nextVisitParticipantFields({ raw: { who: [A, B] }, edited: true, selectedIds: [] });
  assert.deepEqual(emptied, { participantIds: [], who: [] });
}

/* ------------------------------------------------------------
   Contract §4 — legacy whoMode serialization
   ------------------------------------------------------------ */

// exactly-two-person legacy universe, exact historical match
assert.equal(deriveLegacyWhoMode([A, B], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "both");
assert.equal(deriveLegacyWhoMode([A], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "me");
assert.equal(deriveLegacyWhoMode([B], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "partner");

// arbitrary 3+ participant data -> no invented whoMode
assert.equal(deriveLegacyWhoMode([A, B, C], { legacyMemberIds: GROUP_ACTIVE, createdBy: A }), "");
assert.equal(deriveLegacyWhoMode([A, B], { legacyMemberIds: [A, B, C, D], createdBy: A }), "", "space universe is not two people");
assert.equal(deriveLegacyWhoMode([], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "");
assert.equal(deriveLegacyWhoMode([A, "stranger"], { legacyMemberIds: BASELINE_LEGACY, createdBy: A }), "");

/* ------------------------------------------------------------
   Active vs removed historical Members
   ------------------------------------------------------------ */
{
  const { visit, place } = groupVisit("place-test-group-garden", "visit-test-group-removed-member");
  const resolved = resolveVisitParticipants(visit, place, { legacyMemberIds: GROUP_ACTIVE });
  assert.deepEqual(resolved.participantIds, [A, D]);

  const parts = partitionResolvedParticipants(resolved.participantIds, GROUP_ACTIVE);
  assert.deepEqual(parts.activeSelected, [A]);
  assert.deepEqual(parts.historical, [D], "removed D remains a historical participant");

  // removed D is never eligible for a NEW selection
  assert.deepEqual(sanitizeParticipantsForNewSelection([A, D, C], GROUP_ACTIVE), [A, C]);

  // an explicit edit keeps the historical member but cannot re-add another removed one
  const selection = composeParticipantSelection({
    checkedActiveIds: [B, A],
    activeMemberOrder: GROUP_ACTIVE,
    historicalIds: parts.historical
  });
  assert.deepEqual(selection, [A, B, D]);
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
}

assert.equal(usableUidArray(["", "  "]), null);
assert.deepEqual(usableUidArray([" x ", "y"]), [" x ", "y"].filter(Boolean));

console.log("participants assertions passed");
