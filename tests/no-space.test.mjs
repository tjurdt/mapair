import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  averageSubmittedRating,
  replaceOwnContribution
} from "../src/no-space/contributions.js";
import {
  normalizeDayOrder,
  orderVisitsForDay,
  personalOrderPositions,
  reorderDayVisitIds
} from "../src/no-space/day-order.js";
import {
  canDeleteTrip,
  canDeleteVisit,
  canEditContribution,
  canEditTripSharedFacts,
  canEditVisitSharedFacts,
  canViewTrip,
  canViewVisit,
  retainCurrentParticipant
} from "../src/no-space/policies.js";
import {
  assertNoClockFields,
  findForbiddenClockFields,
  placeObjectiveFields,
  visitSharedFields
} from "../src/no-space/schema.js";
import { applyTripDefaultsToNewVisit, updateTripDefaults } from "../src/no-space/trips.js";
import { knownParticipantUserIds, projectNoSpaceRuntime } from "../src/no-space/visits.js";
import { noSpacePaths } from "../src/no-space/repository.js";

const A = "test-user-a", B = "test-user-b", C = "test-user-c";
const shared = { id:"visit-shared", date:"2026-08-02", participantUserIds:[A,B], createdBy:A };
const soloA = { id:"visit-solo-a", date:"2026-08-02", participantUserIds:[A], createdBy:A };
const soloB = { id:"visit-solo-b", date:"2026-08-02", participantUserIds:[B], createdBy:B };

/* A. Visit visibility */
assert.equal(canViewVisit(A, shared), true);
assert.equal(canViewVisit(B, shared), true);
assert.equal(canViewVisit(C, shared), false);
assert.equal(canViewVisit(B, soloA), false);

/* B. shared editing + creator-only deletion */
assert.equal(canEditVisitSharedFacts(B, shared), true);
assert.equal(canEditVisitSharedFacts(C, shared), false);
assert.equal(canDeleteVisit(A, shared), true);
assert.equal(canDeleteVisit(B, shared), false);
assert.deepEqual(retainCurrentParticipant([B], A), [A,B], "self-removal cannot masquerade as Exit");

/* C. contributions remain independently owned */
assert.equal(canEditContribution(A, A), true);
assert.equal(canEditContribution(A, B), false);
const initialContributions = { [A]:{ rating:4.5, memory:"A memory" }, [B]:{ rating:3.5, memory:"B memory" }, [C]:{ memory:"No rating" } };
assert.equal(averageSubmittedRating(Object.values(initialContributions)), 4);
const afterA = replaceOwnContribution(initialContributions, A, { rating:5, memory:"A changed" });
assert.deepEqual(afterA[B], initialContributions[B]);
assert.deepEqual(afterA[C], initialContributions[C]);
assert.notStrictEqual(afterA, initialContributions);

/* D. personal day order */
const visits = [
  { ...soloA, createdAt:{seconds:1} },
  { ...shared, createdAt:{seconds:2} },
  { ...soloB, createdAt:{seconds:3} },
  { id:"visit-next-day", date:"2026-08-03", participantUserIds:[A], createdAt:{seconds:1} }
];
const aOrder = { "2026-08-02":{ visitIds:[soloA.id, shared.id, "stale-id"] } };
const bOrder = { "2026-08-02":{ visitIds:[soloB.id, shared.id] } };
assert.equal(personalOrderPositions(aOrder, visits).get(shared.id), 2);
assert.equal(personalOrderPositions(bOrder, visits).get(shared.id), 2);
const aFour = { "2026-08-02":{ visitIds:[soloA.id,"another-a","third-a",shared.id] } };
const withAdditional = [...visits, {id:"another-a",date:"2026-08-02",participantUserIds:[A]}, {id:"third-a",date:"2026-08-02",participantUserIds:[A]}];
assert.equal(personalOrderPositions(aFour, withAdditional).get(shared.id), 4);
const reorderedA = reorderDayVisitIds(aOrder["2026-08-02"].visitIds.filter(id=>id!=="stale-id"), shared.id, 0);
assert.deepEqual(reorderedA, [shared.id, soloA.id]);
assert.deepEqual(bOrder["2026-08-02"].visitIds, [soloB.id, shared.id], "A reorder cannot modify B");
assert.deepEqual(normalizeDayOrder("2026-08-02", visits, ["stale-id", shared.id]), [shared.id, soloA.id, soloB.id]);
assert.deepEqual(orderVisitsForDay("2026-08-02", visits, [shared.id]).map(v=>v.id), [shared.id, soloA.id, soloB.id]);
assert.deepEqual(aOrder["2026-08-02"].visitIds, [soloA.id, shared.id, "stale-id"], "filtered ordering is read-only");
const movedVisit = { ...shared, date:"2026-08-03" };
assert.deepEqual(normalizeDayOrder("2026-08-02", [soloA,movedVisit], [shared.id,soloA.id]), [soloA.id]);
assert.deepEqual(normalizeDayOrder("2026-08-03", [movedVisit], []), [shared.id]);

/* E. Trip defaults are copied only into a newly-created Visit */
const trip = { id:"trip-1", participantUserIds:[A,B,C], createdBy:A };
assert.equal(canViewTrip(B, trip), true);
assert.equal(canEditTripSharedFacts(C, trip), true);
assert.equal(canDeleteTrip(A, trip), true);
assert.equal(canDeleteTrip(B, trip), false);
const created = applyTripDefaultsToNewVisit({ date:"2026-08-02" }, trip, A);
assert.deepEqual(created.participantUserIds, [A,B,C]);
const historical = { ...created, id:"historical" };
const changedTrip = updateTripDefaults(trip, [A,B], A);
assert.deepEqual(changedTrip.participantUserIds, [A,B]);
assert.deepEqual(historical.participantUserIds, [A,B,C], "Trip default changes cannot rewrite existing Visits");

/* F. No clock-time contract + objective Place audit */
const visitShape = visitSharedFields({
  placeId:"place-1", date:"2026-08-02", category:"Cafe", participantUserIds:[A],
  tripId:null, kind:"visit", createdBy:A
});
assert.deepEqual(findForbiddenClockFields(visitShape), []);
assert.throws(() => assertNoClockFields({ startTime:"14:30" }), /forbidden clock-time/);
assert.throws(() => visitSharedFields({ ...visitShape, time:"14:30" }), /forbidden clock-time/);
const objective = placeObjectiveFields({ name:"Cafe", lat:25, lng:121, rating:5, review:"subjective", level:"deep", visits:[visitShape] });
assert.equal(Object.hasOwn(objective, "rating"), false);
assert.equal(Object.hasOwn(objective, "review"), false);
assert.equal(Object.hasOwn(objective, "level"), false);
assert.equal(Object.hasOwn(objective, "visits"), false);
assert.equal(Object.hasOwn(objective, "status"), false, "Wishlist/status is not No-Space truth");

/* Runtime adapter keeps repeated Visits first-class while grouping one marker per Place. */
const projected = projectNoSpaceRuntime({
  currentUserId:A,
  visits:[
    { ...soloA, placeId:"place-1", category:"Cafe" },
    { ...shared, id:"visit-repeat", placeId:"place-1", date:"2026-08-04", category:"Dinner" }
  ],
  placesById:{ "place-1":{ name:"Same place", lat:25, lng:121 } },
  contributionsByVisitId:{ "visit-repeat":{ [A]:{rating:4.5,level:"deep"}, [B]:{rating:3.5} } },
  dayOrdersByDate:{}
});
assert.equal(Object.keys(projected).length, 1);
assert.equal(projected["place-1"].visits.length, 2);
assert.equal(projected["place-1"].visits[1]._averageRating, 4);
assert.deepEqual(knownParticipantUserIds(A, [shared], [trip]), [A,B,C]);

/* Centralized paths never point back into spaces/{spaceId}. */
for (const path of [
  noSpacePaths.user(A), noSpacePaths.place("p"), noSpacePaths.visit("v"),
  noSpacePaths.trip("t"), noSpacePaths.contribution("v",A), noSpacePaths.dayOrder(A,"2026-08-02")
]) assert.equal(path.startsWith("spaces/"), false, path);

/* UI contract: the No-Space editor must not render a clock-time input. */
const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
assert.equal(/type=["']time["']/.test(mainSource), false);
assert.match(mainSource, /isNoSpace\(\) \? "我的足跡" : "我們去過的地方"/);
for (const [start,end] of [
  ["function openNoSpaceVisitEditor", "function openEditor"],
  ["function subscribeNoSpace", "function syncNoSpaceReferenceGroup"],
  ["function openNoSpaceTripEditor", "function editTrip"]
]){
  const block=mainSource.slice(mainSource.indexOf(start),mainSource.indexOf(end,mainSource.indexOf(start)+1));
  assert.ok(block.length>0,`${start} block must exist`);
  assert.doesNotMatch(block,/spaces\//);
  assert.doesNotMatch(block,/placeDocFor|tripDocFor|metaDocFor|placesColFor|tripsColFor/);
}
const fixture=JSON.parse(await readFile(new URL("./fixtures/mapair-no-space.json",import.meta.url),"utf8"));
assert.deepEqual(findForbiddenClockFields(fixture),[]);
assert.equal(fixture.documents.some(document=>document.path.startsWith("spaces/")),false);

console.log("no-space assertions passed");
