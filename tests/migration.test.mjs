import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  convertLegacySpace,
  legacyPlaceDocumentId,
  legacyTripDocumentId,
  migrationDocumentIds,
  migrationMarkerDisposition,
  validateMigrationOptions
} from "../scripts/no-space-migration.mjs";
import { externalPlaceDocumentId } from "../src/no-space/places.js";

const fixture=JSON.parse(await readFile(new URL("./fixtures/mapair-baseline.json",import.meta.url),"utf8"));
const input={
  sourceSpace:"us",
  meta:fixture.meta.config,
  places:fixture.places,
  trips:fixture.trips,
  members:fixture.members || [],
  importedAt:"2026-08-29T00:00:00.000Z"
};

const first=convertLegacySpace(input);
const second=convertLegacySpace(input);
const later=convertLegacySpace({...input,importedAt:"2026-09-01T12:34:56.000Z"});
assert.deepEqual(first.blockers,[]);
assert.deepEqual(first.documents,second.documents,"rerunning the converter with the same input is idempotent");
assert.deepEqual(migrationDocumentIds(first),migrationDocumentIds(second));
assert.equal(first.sourceFingerprint,later.sourceFingerprint,"source fingerprints exclude migration-run timestamps");
assert.equal(first.planFingerprint,later.planFingerprint,"dry-run and later apply plans match when source is unchanged");
assert.match(first.sourceFingerprint,/^[a-f0-9]{64}$/);
assert.match(first.planFingerprint,/^[a-f0-9]{64}$/);
assert.deepEqual(first.sourceCounts,{spaceRoot:0,meta:1,places:7,trips:1,members:0,visitOccurrences:8});
assert.equal(first.counts.visits,8,"every embedded occurrence plus visitedOn-only fallback becomes a Visit");
assert.equal(first.counts.places,6,"wishlist-only Places are not migrated");
assert.equal(first.documents.some(item=>item.path.includes("place-test-wishlist")),false);
const defaults=first.documents.find(item=>item.path==="appConfig/defaults").data;
assert.equal(defaults.categories.includes("測試願望"),false,"wishlist-only category wording stays out of the No-Space UI");
assert.equal(Object.hasOwn(defaults.catColors,"測試願望"),false);

const stationVisits=first.visits.filter(visit=>visit.sourcePlaceId==="place-test-station");
const stationTarget=first.placeIdMap["place-test-station"];
assert.equal(stationVisits.length,2);
assert.equal(new Set(stationVisits.map(visit=>visit.id)).size,2);
assert.ok(stationVisits.every(visit=>visit.id.startsWith("v1-")));
assert.equal(stationTarget,legacyPlaceDocumentId("us","place-test-station"));
assert.notEqual(stationTarget,"place-test-station","custom legacy Place IDs are not reused at top level");
assert.ok(stationVisits.every(visit=>visit.placeId===stationTarget));
const stationImport=first.documents.find(item=>item.path===`places/${stationTarget}/legacyImports/space-us`);
assert.ok(stationImport);
assert.deepEqual(stationImport.data.participantUserIds,["test-user-a","test-user-b"],"legacy subjective data is scoped to the Place's resolved Visit participants");
assert.equal(first.documents.some(item=>item.path.includes("/contributions/")),false,"shared legacy opinions are never assigned to a User");

const dayOrder=first.documents.find(item=>item.path==="users/test-user-b/dayOrders/2024-04-11");
assert.ok(dayOrder);
assert.deepEqual(dayOrder.data.visitIds,first.visits
  .filter(visit=>visit.date==="2024-04-11"&&visit.participantUserIds.includes("test-user-b"))
  .sort((a,b)=>(a.legacyOrder??Number.MAX_SAFE_INTEGER)-(b.legacyOrder??Number.MAX_SAFE_INTEGER)||a.sourcePlaceId.localeCompare(b.sourcePlaceId))
  .map(visit=>visit.id));

const tripTarget=first.tripIdMap["trip-test-multiday"];
const trip=first.trips.find(item=>item.id===tripTarget);
assert.ok(trip);
assert.equal(tripTarget,legacyTripDocumentId("us","trip-test-multiday"));
assert.notEqual(tripTarget,"trip-test-multiday","legacy Trip IDs are not reused at top level");
assert.equal(trip.color,fixture.trips.find(item=>item.id==="trip-test-multiday").data.color);
assert.deepEqual(new Set(trip.participantUserIds),new Set(["test-user-a","test-user-b"]));
assert.ok(first.visits.filter(visit=>visit.legacyTripId==="trip-test-multiday").every(visit=>visit.tripId===tripTarget),"Visit Trip references are remapped");
assert.equal(first.documents.some(item=>item.path==="trips/trip-test-multiday"),false);

const external=convertLegacySpace({sourceSpace:"us",importedAt:input.importedAt,places:[{id:"legacy-google",data:{
  name:"Google place",lat:25,lng:121,source:"google",extId:"ChIJ-test",visitedOn:"2026-01-01",who:["a"]
}}]});
const expectedExternalId=externalPlaceDocumentId({source:"google",extId:"ChIJ-test"});
assert.equal(external.visits[0].placeId,expectedExternalId,"external Places migrate to the same deterministic identity used by runtime writes");
assert.equal(external.documents.some(item=>item.path===`places/${expectedExternalId}`),true);

const otherSource=convertLegacySpace({...input,sourceSpace:"another-space"});
assert.notEqual(first.placeIdMap["place-test-station"],otherSource.placeIdMap["place-test-station"],"custom Place IDs are source-namespaced");
assert.notEqual(first.tripIdMap["trip-test-multiday"],otherSource.tripIdMap["trip-test-multiday"],"Trip IDs are source-namespaced");

const matchingLegacyIds=convertLegacySpace({sourceSpace:"us",importedAt:input.importedAt,
  trips:[{id:"already-used",data:{name:"Legacy Trip",participantIds:["a"]}}],
  places:[{id:"already-used",data:{name:"Legacy Place",lat:25,lng:121,visits:[{
    id:"visit-1",date:"2026-01-03",who:["a"],tripId:"already-used"
  }]}}]
});
const mappedPlace=matchingLegacyIds.placeIdMap["already-used"];
const mappedTrip=matchingLegacyIds.tripIdMap["already-used"];
assert.notEqual(mappedPlace,"already-used");
assert.notEqual(mappedTrip,"already-used");
assert.equal(matchingLegacyIds.documents.some(item=>item.path==="places/already-used"||item.path==="trips/already-used"),false,"unrelated top-level IDs cannot be overwritten by matching legacy IDs");
assert.equal(matchingLegacyIds.visits[0].placeId,mappedPlace);
assert.equal(matchingLegacyIds.visits[0].tripId,mappedTrip);

const blocked=convertLegacySpace({sourceSpace:"us",importedAt:input.importedAt,places:[{id:"empty",data:{
  name:"Explicitly empty",lat:25,lng:121,status:"visited",visits:[{date:"2026-01-02",participantIds:[]}],who:["a"]
}}]});
assert.equal(blocked.counts.visits,0);
assert.equal(blocked.blockers.some(item=>item.code==="empty-visit-participants"),true,"explicit empty participant data blocks instead of inventing a User");

const legacyClockFields=convertLegacySpace({sourceSpace:"us",places:[{id:"clock",data:{
  name:"Clock",lat:25,lng:121,visits:[{
    date:"2026-01-01",who:["a"],time:"14:30",startTime:"14:00",endTime:"15:00",
    arrivalTime:"13:55",departureTime:"15:05"
  }]
}}]});
assert.deepEqual(legacyClockFields.blockers,[],"legacy clock-time fields do not block migration");
assert.equal(legacyClockFields.ignoredLegacyClockFields,5);
assert.equal(legacyClockFields.warnings.some(item=>item.code==="ignored-legacy-clock-fields"&&item.count===5),true);
const clockTargetVisit=legacyClockFields.documents.find(item=>item.path.startsWith("visits/")).data;
assert.equal(clockTargetVisit.date,"2026-01-01","migrated Visits remain date-only");
for(const field of ["time","startTime","endTime","arrivalTime","departureTime"]){
  assert.equal(Object.hasOwn(clockTargetVisit,field),false,`${field} is dropped from the target Visit`);
}

assert.deepEqual(validateMigrationOptions({project:"anything",source_space:"anything",apply:false}),{mode:"dry-run"});
assert.throws(()=>validateMigrationOptions({project:"wrong",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),/locked/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"other",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),/locked/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"wrong"}),/requires --confirm/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"},"127.0.0.1:8085"),/refuses/);
assert.deepEqual(validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),{mode:"apply"});

const completedMarker={
  version:1,sourceSpace:"us",sourceFingerprint:first.sourceFingerprint,planFingerprint:first.planFingerprint,status:"complete"
};
assert.equal(migrationMarkerDisposition(null,first),"proceed");
assert.equal(migrationMarkerDisposition(completedMarker,first),"already-complete");
const changed=convertLegacySpace({...input,meta:{...input.meta,nicknames:{...input.meta.nicknames,"test-user-a":"Changed"}}});
assert.notEqual(changed.sourceFingerprint,first.sourceFingerprint);
assert.notEqual(changed.planFingerprint,first.planFingerprint);
assert.throws(()=>migrationMarkerDisposition(completedMarker,changed),/completed.*different|different.*fingerprint/i);
assert.throws(()=>migrationMarkerDisposition({...completedMarker,sourceFingerprint:"missing",status:"applying"},first),/different fingerprints/i);

console.log("migration assertions passed");
