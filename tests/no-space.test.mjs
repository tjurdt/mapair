import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  averageSubmittedRating,
  participantContributions,
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
import { applyTripDefaultsToNewVisit, tripReferenceState, updateTripDefaults } from "../src/no-space/trips.js";
import { externalPlaceDocumentId, selectExactExternalPlace } from "../src/no-space/places.js";
import { knownParticipantUserIds, projectNoSpaceRuntime } from "../src/no-space/visits.js";
import { createNoSpaceRepository, noSpacePaths } from "../src/no-space/repository.js";

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
const currentParticipantOnly=participantContributions({
  [A]:{rating:4.5,memory:"A"},[B]:{rating:3.5,memory:"B"},[C]:{rating:5,memory:"C dormant"}
},[A,B]);
assert.deepEqual(Object.keys(currentParticipantOnly),[A,B]);
assert.equal(averageSubmittedRating(Object.values(currentParticipantOnly)),4);
assert.equal(Object.hasOwn(currentParticipantOnly,C),false,"removed participant memory must not be exposed");

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
assert.deepEqual(tripReferenceState("",{"trip-1":trip}),{kind:"daily",trip:null});
assert.equal(tripReferenceState("trip-1",{"trip-1":trip}).kind,"active");
assert.deepEqual(tripReferenceState("deleted-trip",{"trip-1":trip}),{kind:"missing",trip:null});

/* F. No clock-time contract + objective Place audit */
const visitShape = visitSharedFields({
  placeId:"place-1", date:"2026-08-02", category:"Cafe", participantUserIds:[A],
  tripId:null, kind:"visit", createdBy:A
});
assert.deepEqual(findForbiddenClockFields(visitShape), []);
assert.throws(()=>visitSharedFields({...visitShape,placeId:""}),/placeId must be a non-empty/);
assert.throws(()=>visitSharedFields({...visitShape,placeId:"   "}),/placeId must be a non-empty/);
assert.throws(()=>visitSharedFields({...visitShape,placeId:"places/other"}),/not a valid Firestore document ID/);
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
  contributionsByVisitId:{ "visit-repeat":{ [A]:{rating:4.5,level:"deep"}, [B]:{rating:3.5}, [C]:{rating:5,memory:"dormant"} } },
  dayOrdersByDate:{}
});
assert.equal(Object.keys(projected).length, 1);
assert.equal(projected["place-1"].visits.length, 2);
assert.equal(projected["place-1"].visits[1]._averageRating, 4);
assert.equal(Object.hasOwn(projected["place-1"].visits[1]._contributions,C),false);
assert.deepEqual(knownParticipantUserIds(A, [shared], [trip]), [A,B,C]);

/* Exact external Place identity is deterministic and does not enumerate Places. */
const googlePlace={source:"google",extId:"ChIJ/example",name:"Example"};
assert.equal(externalPlaceDocumentId(googlePlace),externalPlaceDocumentId({...googlePlace,name:"Renamed input"}));
assert.match(externalPlaceDocumentId(googlePlace),/^ext-[a-f0-9]+-[a-f0-9]+$/);
assert.equal(externalPlaceDocumentId({source:"map",extId:null}),null,"custom points keep independent auto IDs");
assert.equal(selectExactExternalPlace([
  {id:"z",source:"google",extId:"other"},
  {id:"b",source:"google",extId:googlePlace.extId},
  {id:"a",source:"google",extId:googlePlace.extId}
],googlePlace).id,"a","pre-existing exact matches are reused deterministically");
{
  const db={}; let addedVisit=null,transactionCalls=0;
  const repository=createNoSpaceRepository({db,uid:A,firestore:{
    collection:(base,...segments)=>({path:segments.join("/")}),
    doc:(base,...segments)=>segments.length?{path:segments.join("/"),id:segments.at(-1)}:{path:`${base.path}/auto`,id:"auto"},
    query:(...parts)=>({type:"query",parts}),where:(...parts)=>({type:"where",parts}),limit:value=>({type:"limit",value}),
    getDocs:async()=>({docs:[{id:"existing-global-place",data:()=>googlePlace}]}),
    addDoc:async(collectionRef,data)=>{addedVisit={collectionRef,data};return{id:"visit-created"};},
    runTransaction:async()=>{transactionCalls++;},serverTimestamp:()=>({stamp:true}),
    writeBatch(){},deleteDoc(){},onSnapshot(){},setDoc(){},updateDoc(){}
  }});
  const created=await repository.createPlaceAndVisit({...googlePlace,lat:25,lng:121},{
    placeId:"",date:"2026-08-07",category:"Cafe",participantUserIds:[A],tripId:null,kind:"visit",endDate:""
  });
  assert.equal(created.placeId,"existing-global-place");
  assert.equal(addedVisit.data.placeId,"existing-global-place");
  assert.equal(transactionCalls,0,"an exact pre-existing Place must be reused without creating another Place");
}
{
  const db={}; const transactionSets=[];
  const repository=createNoSpaceRepository({db,uid:A,firestore:{
    collection:(base,...segments)=>({path:segments.join("/")}),
    doc:(base,...segments)=>segments.length?{path:segments.join("/"),id:segments.at(-1)}:{path:`${base.path}/visit-auto`,id:"visit-auto"},
    query:(...parts)=>({type:"query",parts}),where:(...parts)=>({type:"where",parts}),limit:value=>({type:"limit",value}),
    getDocs:async()=>({docs:[]}),addDoc(){},serverTimestamp:()=>({stamp:true}),writeBatch(){},deleteDoc(){},onSnapshot(){},setDoc(){},updateDoc(){},
    runTransaction:async(dbArg,callback)=>callback({
      get:async()=>({exists:()=>false}),
      set:(reference,data)=>transactionSets.push({reference,data})
    })
  }});
  const created=await repository.createPlaceAndVisit({...googlePlace,lat:25,lng:121},{
    placeId:"",date:"2026-08-07",category:"Cafe",participantUserIds:[A],tripId:null,kind:"visit",endDate:""
  });
  assert.equal(created.placeId,externalPlaceDocumentId(googlePlace));
  assert.deepEqual(transactionSets.map(item=>item.reference.path),[
    `places/${externalPlaceDocumentId(googlePlace)}`,
    "visits/visit-auto"
  ]);
}

/* Creator deletion atomically queues every contribution and then the Visit. */
{
  const deletes=[]; let commits=0, contributionReads=0;
  let contributionDocs=[
    {ref:{path:"visits/visit-delete/contributions/a"}},
    {ref:{path:"visits/visit-delete/contributions/b"}}
  ];
  const db={};
  const repository=createNoSpaceRepository({db,uid:A,firestore:{
    addDoc(){}, deleteDoc(){}, limit:value=>({type:"limit",value}), onSnapshot(){}, query:(...parts)=>({type:"query",parts}),
    runTransaction(){}, serverTimestamp:()=>({stamp:true}), setDoc(){}, updateDoc(){}, where:(...parts)=>({type:"where",parts}),
    collection:(base,...segments)=>({path:segments.join("/")}),
    doc:(base,...segments)=>({path:segments.join("/"),id:segments.at(-1)}),
    getDocs:async target=>{
      contributionReads++;
      assert.equal(target.path,"visits/visit-delete/contributions");
      return {docs:contributionDocs};
    },
    writeBatch:()=>({
      delete:reference=>deletes.push(reference.path), set(){},
      commit:async()=>{commits++;}
    })
  }});
  await repository.deleteVisit("visit-delete",{createdBy:A});
  assert.equal(contributionReads,1);
  assert.deepEqual(deletes,[
    "visits/visit-delete/contributions/a",
    "visits/visit-delete/contributions/b",
    "visits/visit-delete"
  ]);
  assert.equal(commits,1);
  await assert.rejects(()=>repository.deleteVisit("visit-delete",{createdBy:B}),/only the Visit creator/i);
  contributionDocs=Array.from({length:500},(_,index)=>({ref:{path:`visits/visit-delete/contributions/${index}`}}));
  await assert.rejects(()=>repository.deleteVisit("visit-delete",{createdBy:A}),/more than 499 contributions/i);
  assert.equal(commits,1,"an oversized cascade must stop before committing a partial deletion");
  assert.throws(()=>repository.setContribution("visit-delete",{rating:4},{participantUserIds:[B]}),/current Visit participant/i);
}

/* Centralized paths never point back into spaces/{spaceId}. */
for (const path of [
  noSpacePaths.user(A), noSpacePaths.place("p"), noSpacePaths.visit("v"),
  noSpacePaths.trip("t"), noSpacePaths.contribution("v",A), noSpacePaths.dayOrder(A,"2026-08-02")
]) assert.equal(path.startsWith("spaces/"), false, path);

/* UI contract: the No-Space editor must not render a clock-time input. */
const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const repositorySource=await readFile(new URL("../src/no-space/repository.js",import.meta.url),"utf8");
assert.equal(/type=["']time["']/.test(mainSource), false);
assert.match(mainSource, /isNoSpace\(\) \? "我的足跡" : "我們去過的地方"/);
assert.match(mainSource,/if \(filter\.tripId === "daily"\) return !v\.tripId/,"dangling Trip references are not mislabeled as Daily");
assert.match(mainSource,/已刪除旅程/,"dangling Trip references need an explicit label");
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
const editorBlock=mainSource.slice(mainSource.indexOf("function openNoSpaceVisitEditor"),mainSource.indexOf("function openEditor",mainSource.indexOf("function openNoSpaceVisitEditor")+1));
assert.match(editorBlock,/const allowNewPlace=creating&&!selectedPlaceId/);
assert.match(editorBlock,/if\(rawVisit&&!selectedPlaceId\)/);
assert.doesNotMatch(editorBlock,/repo\.updatePlace\(/,"Visit editing cannot mutate global Place identity");
assert.doesNotMatch(editorBlock,/placeName/,"Visit writes must not create a competing Place-name override");
assert.doesNotMatch(repositorySource,/\bupdatePlace\(/,"Phase A exposes no general global Place mutation method");
assert.match(repositorySource,/where\("extId","==",identity\.extId\)/,"external Place reuse must use exact extId lookup");
assert.match(repositorySource,/runTransaction\(db/,'external Place creation must converge transactionally');
assert.match(repositorySource,/contributionSnapshot\.docs\.forEach\(item=>batch\.delete\(item\.ref\)\)/);
const deleteTripBlock=repositorySource.slice(repositorySource.indexOf("deleteTrip("),repositorySource.indexOf("updateOwnProfile",repositorySource.indexOf("deleteTrip(")));
assert.doesNotMatch(deleteTripBlock,/updateVisit|deleteVisit/,"Trip deletion retains historical Visits");

console.log("no-space assertions passed");
