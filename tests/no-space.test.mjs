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
  normalizeLevel,
  placeObjectiveFields,
  tripSharedFields,
  visitSharedFields
} from "../src/no-space/schema.js";
import { contributionFields } from "../src/no-space/contributions.js";
import { applyTripDefaultsToNewVisit, tripReferenceState, updateTripDefaults } from "../src/no-space/trips.js";
import { externalPlaceDocumentId, selectExactExternalPlace } from "../src/no-space/places.js";
import { knownParticipantUserIds, projectNoSpaceRuntime } from "../src/no-space/visits.js";
import { createNoSpaceRepository, noSpacePaths } from "../src/no-space/repository.js";

const A = "test-user-a", B = "test-user-b", C = "test-user-c";
const shared = { id:"visit-shared", date:"2026-08-02", participantUserIds:[A,B], createdBy:A };
const soloA = { id:"visit-solo-a", date:"2026-08-02", participantUserIds:[A], createdBy:A };
const soloB = { id:"visit-solo-b", date:"2026-08-02", participantUserIds:[B], createdBy:B };

function createMemoryFirestore(initialDocuments={},hooks={}){
  const documents=new Map(Object.entries(initialDocuments).map(([path,data])=>[path,{...data}]));
  const events=[];
  let autoId=0;
  const snapshot=(path)=>({
    id:path.split("/").at(-1),
    exists:()=>documents.has(path),
    data:()=>documents.get(path)
  });
  const applyOperation=operation=>{
    if(operation.type==="delete") documents.delete(operation.reference.path);
    else if(operation.type==="set") documents.set(operation.reference.path,operation.merge?{...(documents.get(operation.reference.path)||{}),...operation.data}:{...operation.data});
    else documents.set(operation.reference.path,{...(documents.get(operation.reference.path)||{}),...operation.data});
  };
  const firestore={
    addDoc(){},
    collection:(base,...segments)=>({path:segments.join("/")}),
    doc:(base,...segments)=>{
      if(segments.length) return {path:segments.join("/"),id:segments.at(-1)};
      const id=`auto-${++autoId}`;
      return {path:`${base.path}/${id}`,id};
    },
    getDocs:async collectionRef=>{
      events.push(`getDocs:${collectionRef.path}`);
      if(hooks.beforeGetDocs) await hooks.beforeGetDocs(collectionRef);
      const prefix=`${collectionRef.path}/`;
      const docs=[...documents.entries()].filter(([path])=>path.startsWith(prefix)&&!path.slice(prefix.length).includes("/")).map(([path])=>({
        id:path.split("/").at(-1),ref:{path},data:()=>documents.get(path)
      }));
      return {docs};
    },
    onSnapshot(){},
    query:(...parts)=>({type:"query",parts}),
    runTransaction:async(db,callback)=>{
      const operations=[];
      const transaction={
        get:async reference=>snapshot(reference.path),
        update:(reference,data)=>operations.push({type:"update",reference,data}),
        set:(reference,data,options)=>operations.push({type:"set",reference,data,merge:!!options?.merge}),
        delete:reference=>operations.push({type:"delete",reference})
      };
      const result=await callback(transaction);
      operations.forEach(applyOperation);
      operations.forEach(operation=>events.push(`transaction:${operation.type}:${operation.reference.path}`));
      return result;
    },
    serverTimestamp:()=>({stamp:true}),
    setDoc(){},
    updateDoc(){},
    where:(...parts)=>({type:"where",parts}),
    writeBatch:()=>{
      const operations=[];
      return {
        delete:reference=>operations.push({type:"delete",reference}),
        set:(reference,data,options)=>operations.push({type:"set",reference,data,merge:!!options?.merge}),
        commit:async()=>{
          events.push("batch:commit");
          if(hooks.failNextBatch){ hooks.failNextBatch=false; throw new Error("simulated batch failure"); }
          operations.forEach(applyOperation);
        }
      };
    }
  };
  return {documents,events,firestore};
}

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
// Older data with no stored creator has no creator to protect: any participant deletes.
const noCreatorVisit = { id:"v-old", date:"2026-08-02", participantUserIds:[A,B] };
assert.equal(canDeleteVisit(A, noCreatorVisit), true);
assert.equal(canDeleteVisit(B, noCreatorVisit), true);
assert.equal(canDeleteVisit(C, noCreatorVisit), false, "still limited to participants");
assert.equal(canDeleteTrip(A, { participantUserIds:[A,B] }), true);
assert.equal(canDeleteTrip(C, { participantUserIds:[A,B] }), false);
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
assert.equal(tripSharedFields({name:"Trip",participantUserIds:[A],createdBy:A,color:"#123abc"}).color,"#123abc");
assert.equal(tripSharedFields({name:"Trip",participantUserIds:[A],createdBy:A,color:"unsafe"}).color,"#3f7d78");

/* F. No clock-time contract + objective Place audit */
const visitShape = visitSharedFields({
  placeId:"place-1", date:"2026-08-02", category:"Cafe", participantUserIds:[A],
  tripId:null, kind:"visit", createdBy:A
});
assert.deepEqual(findForbiddenClockFields(visitShape), []);
assert.throws(()=>visitSharedFields({...visitShape,placeId:""}),/placeId must be a non-empty/);
assert.throws(()=>visitSharedFields({...visitShape,placeId:"   "}),/placeId must be a non-empty/);
assert.throws(()=>visitSharedFields({...visitShape,placeId:"places/other"}),/not a valid Firestore document ID/);
assert.throws(()=>visitSharedFields({...visitShape,tripId:"trips/other"}),/tripId is not a valid Firestore document ID/);
assert.equal(visitSharedFields({...visitShape,tripId:""}).tripId,null);
assert.equal(visitSharedFields({...visitShape,tripId:"deleted-trip"}).tripId,"deleted-trip");
assert.throws(() => assertNoClockFields({ startTime:"14:30" }), /forbidden clock-time/);
assert.throws(() => visitSharedFields({ ...visitShape, time:"14:30" }), /forbidden clock-time/);
assert.throws(() => visitSharedFields({ ...visitShape, departureTime:"14:30" }), /forbidden clock-time/);

/* 造訪深度 is a shared Visit fact and is the sole trigger for a stay. */
assert.equal(normalizeLevel("居住"), "居住");
assert.equal(normalizeLevel("nonsense"), "旅遊", "an unknown depth falls back to 旅遊");
assert.equal(normalizeLevel(undefined, "住宿"), "住宿", "the caller may pick the fallback");
assert.equal(visitShape.level, "旅遊", "an unspecified depth defaults to 旅遊");
assert.equal(visitShape.kind, "visit");
assert.equal(visitShape.endDate, "");
const stayVisit = visitSharedFields({ ...visitShape, level:"住宿", endDate:"2026-08-04" });
assert.equal(stayVisit.kind, "stay", "住宿 depth makes the Visit a stay");
assert.equal(stayVisit.endDate, "2026-08-04");
assert.throws(() => visitSharedFields({ ...visitShape, level:"住宿" }), /YYYY-MM-DD/, "a 住宿 Visit still needs a checkout date");
assert.throws(() => visitSharedFields({ ...visitShape, level:"住宿", endDate:"2026-08-02" }), /must follow its arrival/);
const legacyStay = visitSharedFields({
  placeId:"place-1", date:"2026-08-02", participantUserIds:[A], kind:"stay", endDate:"2026-08-04", createdBy:A
});
assert.equal(legacyStay.level, "住宿", "a legacy kind:stay Visit with no depth is read as 住宿");
assert.equal(visitSharedFields({ ...visitShape, level:"經過" }).kind, "visit");
assert.equal(Object.hasOwn(contributionFields({ rating:4, memory:"x", level:"居住" }), "level"), false,
  "depth is no longer stored on a personal contribution");
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
assert.equal(projected["place-1"].visits[0].level, "旅遊", "an unspecified shared depth projects as 旅遊");
assert.deepEqual(knownParticipantUserIds(A, [shared], [trip]), [A,B,C]);

/* Shared visit depth: projected per-Visit and rolled up to a Place fallback. */
const depthProjection = projectNoSpaceRuntime({
  currentUserId:B,
  visits:[
    { id:"v-early", placeId:"p", date:"2026-01-01", participantUserIds:[A,B], level:"居住", createdBy:A },
    { id:"v-stay", placeId:"p", date:"2026-02-01", participantUserIds:[A,B], kind:"stay", endDate:"2026-02-03", createdBy:A }
  ],
  placesById:{ p:{ name:"P", lat:25, lng:121 } }
})["p"];
assert.equal(depthProjection.visits[0].level, "居住", "explicit shared depth is projected as-is");
assert.equal(depthProjection.visits[1].level, "住宿", "a legacy kind:stay Visit reads as 住宿 depth");
assert.equal(depthProjection.visits[1].kind, "stay");
assert.equal(depthProjection.level, "住宿", "Place depth falls back to the latest Visit's shared depth, for any viewer");

/* A visible Visit may arrive before its exact referenced Place listener. */
const pendingPlaceVisit = { ...soloA, id:"visit-pending-place", placeId:"place-pending" };
let pendingProjection;
assert.doesNotThrow(() => {
  pendingProjection = projectNoSpaceRuntime({ currentUserId:A, visits:[pendingPlaceVisit], placesById:{} });
}, "a temporarily unresolved Place is normal loading state");
assert.deepEqual(pendingProjection, {}, "an unresolved Place does not materialize an invalid runtime Place");
assert.deepEqual(
  projectNoSpaceRuntime({
    currentUserId:A,
    visits:[pendingPlaceVisit],
    placesById:{ "place-pending":{ name:"Loaded place", lat:25.05, lng:121.52 } }
  })["place-pending"].visits.map(visit => visit.id),
  [pendingPlaceVisit.id],
  "the Visit appears normally after its valid Place listener resolves"
);
assert.deepEqual(
  projectNoSpaceRuntime({
    currentUserId:A,
    visits:[pendingPlaceVisit],
    placesById:{ "place-pending":{ name:"Invalid place", lat:undefined, lng:121.52 } }
  }),
  {},
  "a Place without finite numeric coordinates is not projected"
);

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
  const db={}; const transactionSets=[]; let transactionCalls=0;
  const repository=createNoSpaceRepository({db,uid:A,firestore:{
    collection:(base,...segments)=>({path:segments.join("/")}),
    doc:(base,...segments)=>segments.length?{path:segments.join("/"),id:segments.at(-1)}:{path:`${base.path}/visit-created`,id:"visit-created"},
    query:(...parts)=>({type:"query",parts}),where:(...parts)=>({type:"where",parts}),limit:value=>({type:"limit",value}),
    getDocs:async()=>{throw new Error("external Place creation must not enumerate places");},addDoc(){},
    runTransaction:async(dbArg,callback)=>{transactionCalls++;return callback({
      get:async reference=>({exists:()=>reference.path===`places/${externalPlaceDocumentId(googlePlace)}`}),
      set:(reference,data)=>transactionSets.push({reference,data})
    });},serverTimestamp:()=>({stamp:true}),
    writeBatch(){},deleteDoc(){},onSnapshot(){},setDoc(){},updateDoc(){}
  }});
  const created=await repository.createPlaceAndVisit({...googlePlace,lat:25,lng:121},{
    placeId:"",date:"2026-08-07",category:"Cafe",participantUserIds:[A],tripId:null,kind:"visit",endDate:""
  });
  assert.equal(created.placeId,externalPlaceDocumentId(googlePlace));
  assert.equal(created.reusedPlace,true);
  assert.equal(transactionCalls,1);
  assert.deepEqual(transactionSets.map(item=>item.reference.path),["visits/visit-created"],"a deterministic direct lookup reuses the Place without listing the collection");
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

/* Existing mutations authorize from current stored state, not stale drafts. */
{
  const db={};
  const currentVisit={placeId:"place-1",date:"2026-08-02",category:"current",participantUserIds:[A],tripId:"deleted-trip",kind:"visit",endDate:"",createdBy:A};
  const currentTrip={name:"Current",emoji:"",startDate:"",endDate:"",participantUserIds:[A],createdBy:A};
  const historicalVisit={...currentVisit,tripId:"trip-current"};
  const memory=createMemoryFirestore({"visits/visit-current":currentVisit,"visits/visit-historical":historicalVisit,"trips/trip-current":currentTrip});
  const repositoryA=createNoSpaceRepository({db,uid:A,firestore:memory.firestore});
  const repositoryB=createNoSpaceRepository({db,uid:B,firestore:memory.firestore});
  const staleVisit={...currentVisit,category:"stale B write",participantUserIds:[A,B],createdBy:B};
  const staleTrip={...currentTrip,name:"stale B write",participantUserIds:[A,B],createdBy:B};

  await assert.rejects(()=>repositoryB.updateVisit("visit-current",staleVisit),/current participant/i);
  await assert.rejects(()=>repositoryB.setContribution("visit-current",{rating:5}),/current Visit participant/i);
  await assert.rejects(()=>repositoryB.updateTrip("trip-current",staleTrip),/current participant/i);
  await assert.rejects(()=>repositoryB.deleteVisit("visit-current",{createdBy:B}),/stored Visit creator/i);
  await assert.rejects(()=>repositoryB.deleteTrip("trip-current",{createdBy:B}),/stored Trip creator/i);
  assert.deepEqual(memory.documents.get("visits/visit-current"),currentVisit,"stale B must not re-add themselves");

  await repositoryA.updateVisit("visit-current",{...currentVisit,category:"safe update",createdBy:B});
  assert.equal(memory.documents.get("visits/visit-current").createdBy,A,"Visit update preserves stored creator");
  assert.equal(memory.documents.get("visits/visit-current").tripId,"deleted-trip","unrelated edits preserve a dangling Trip reference");
  await repositoryA.updateVisit("visit-current",{...currentVisit,tripId:null,category:"explicit detach"});
  assert.equal(memory.documents.get("visits/visit-current").tripId,null,"explicitly selecting no Trip detaches the Visit");
  await repositoryA.updateTrip("trip-current",{...currentTrip,name:"safe update",createdBy:B});
  assert.equal(memory.documents.get("trips/trip-current").createdBy,A,"Trip update preserves stored creator");
  await repositoryA.deleteTrip("trip-current");
  assert.equal(memory.documents.has("trips/trip-current"),false);
  assert.equal(memory.documents.get("visits/visit-historical").tripId,"trip-current","Trip deletion must not rewrite historical Visits");
}

/* Deletion closes contribution writes before reading and atomically removes the final set. */
{
  const db={},hooks={};
  const visit={placeId:"place-1",date:"2026-08-02",category:"",participantUserIds:[A,B],tripId:null,kind:"visit",endDate:"",createdBy:A};
  const memory=createMemoryFirestore({
    "visits/visit-delete":visit,
    "visits/visit-delete/contributions/a":{rating:4},
    "visits/visit-delete/contributions/b":{rating:3.5}
  },hooks);
  const repositoryA=createNoSpaceRepository({db,uid:A,firestore:memory.firestore});
  const repositoryB=createNoSpaceRepository({db,uid:B,firestore:memory.firestore});
  let racingWriteError=null;
  hooks.beforeGetDocs=async()=>{
    try{await repositoryB.setContribution("visit-delete",{rating:5});}
    catch(error){racingWriteError=error;}
  };
  await repositoryA.deleteVisit("visit-delete");
  assert.match(racingWriteError?.message||"",/being deleted/);
  assert.equal([...memory.documents.keys()].some(path=>path==="visits/visit-delete"||path.startsWith("visits/visit-delete/contributions/")),false);
  assert.ok(memory.events.indexOf("transaction:update:visits/visit-delete")<memory.events.indexOf("getDocs:visits/visit-delete/contributions"));
  assert.ok(memory.events.indexOf("getDocs:visits/visit-delete/contributions")<memory.events.indexOf("batch:commit"));
}

/* Oversized or failed cleanup never partially deletes and remains recoverable. */
{
  const db={},hooks={};
  const visit={placeId:"place-1",date:"2026-08-02",category:"",participantUserIds:[A],tripId:null,kind:"visit",endDate:"",createdBy:A};
  const initial={"visits/visit-large":visit};
  for(let index=0;index<500;index++) initial[`visits/visit-large/contributions/${index}`]={rating:4};
  const memory=createMemoryFirestore(initial,hooks);
  const repository=createNoSpaceRepository({db,uid:A,firestore:memory.firestore});
  await assert.rejects(()=>repository.deleteVisit("visit-large"),/more than 499 contributions/i);
  assert.equal(memory.documents.get("visits/visit-large").deleting,false);
  assert.equal([...memory.documents.keys()].filter(path=>path.startsWith("visits/visit-large/contributions/")).length,500);

  const failed=createMemoryFirestore({"visits/visit-retry":visit,"visits/visit-retry/contributions/a":{rating:4}},{failNextBatch:true});
  const retryRepository=createNoSpaceRepository({db,uid:A,firestore:failed.firestore});
  await assert.rejects(()=>retryRepository.deleteVisit("visit-retry"),/remains marked deleting and may be retried/i);
  assert.equal(failed.documents.get("visits/visit-retry").deleting,true);
  await assert.rejects(()=>retryRepository.setContribution("visit-retry",{rating:5}),/being deleted/i);
  await assert.rejects(()=>retryRepository.updateVisit("visit-retry",visit),/being deleted/i);
  await retryRepository.deleteVisit("visit-retry");
  assert.equal(failed.documents.has("visits/visit-retry"),false);
  assert.equal(failed.documents.has("visits/visit-retry/contributions/a"),false);
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
// A brand-new Place name input is only offered while creating with no resolved
// Place; an existing Visit sees the Place select, so it can never become a new Place.
assert.match(editorBlock,/allowNewPlace[\s\S]{0,60}<input id="ns_place_name"/,"the new-Place name input is gated behind allowNewPlace");
assert.match(editorBlock,/\}else\{\s*\n\s*const created=await repo\.createPlaceAndVisit/,"a new Place is only created when no Place is selected");
assert.match(editorBlock,/value="\$\{esc\(rawVisit\.tripId\)\}" selected>已刪除旅程/,"a dangling Trip must remain selected until explicitly changed");
assert.match(editorBlock,/tripId:g\("ns_trip"\)\.value\|\|null/,"explicitly selecting no Trip detaches the Visit");
assert.doesNotMatch(editorBlock,/repo\.updatePlace\(/,"Visit editing cannot mutate global Place identity");
assert.doesNotMatch(editorBlock,/placeName/,"Visit writes must not create a competing Place-name override");
assert.doesNotMatch(repositorySource,/\bupdatePlace\(/,"Phase A exposes no general global Place mutation method");
const externalCreateBlock=repositorySource.slice(repositorySource.indexOf("async createPlaceAndVisit"),repositorySource.indexOf("updatePlaceCache"));
assert.match(externalCreateBlock,/externalPlaceDocumentId\(objective\)/,"external Place reuse must use deterministic identity");
assert.doesNotMatch(externalCreateBlock,/getDocs|where\(/,"external Place creation must not enumerate the global Places collection");
assert.match(repositorySource,/runTransaction\(db/,'external Place creation must converge transactionally');
assert.match(repositorySource,/if\(current\.deleting\).*cannot accept contributions/,'contributions must reject the deletion lifecycle');
assert.match(repositorySource,/contributionSnapshot\.docs\.forEach\(item=>batch\.delete\(item\.ref\)\)/);
const deleteTripBlock=repositorySource.slice(repositorySource.indexOf("deleteTrip("),repositorySource.indexOf("updateOwnProfile",repositorySource.indexOf("deleteTrip(")));
assert.doesNotMatch(deleteTripBlock,/updateVisit|deleteVisit/,"Trip deletion retains historical Visits");

console.log("no-space assertions passed");
