import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { convertLegacySpace, migrationDocumentIds, validateMigrationOptions } from "../scripts/no-space-migration.mjs";
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
assert.deepEqual(first.blockers,[]);
assert.deepEqual(first.documents,second.documents,"rerunning the converter with the same input is idempotent");
assert.deepEqual(migrationDocumentIds(first),migrationDocumentIds(second));
assert.equal(first.counts.visits,8,"every embedded occurrence plus visitedOn-only fallback becomes a Visit");
assert.equal(first.counts.places,6,"wishlist-only Places are not migrated");
assert.equal(first.documents.some(item=>item.path.includes("place-test-wishlist")),false);
const defaults=first.documents.find(item=>item.path==="appConfig/defaults").data;
assert.equal(defaults.categories.includes("測試願望"),false,"wishlist-only category wording stays out of the No-Space UI");
assert.equal(Object.hasOwn(defaults.catColors,"測試願望"),false);

const stationVisits=first.visits.filter(visit=>visit.sourcePlaceId==="place-test-station");
assert.equal(stationVisits.length,2);
assert.equal(new Set(stationVisits.map(visit=>visit.id)).size,2);
assert.ok(stationVisits.every(visit=>visit.id.startsWith("v1-")));
assert.equal(first.documents.some(item=>item.path==="places/place-test-station/legacyImports/space-us"),true);
assert.equal(first.documents.some(item=>item.path.includes("/contributions/")),false,"shared legacy opinions are never assigned to a User");

const dayOrder=first.documents.find(item=>item.path==="users/test-user-b/dayOrders/2024-04-11");
assert.ok(dayOrder);
assert.deepEqual(dayOrder.data.visitIds,first.visits
  .filter(visit=>visit.date==="2024-04-11"&&visit.participantUserIds.includes("test-user-b"))
  .sort((a,b)=>(a.legacyOrder??Number.MAX_SAFE_INTEGER)-(b.legacyOrder??Number.MAX_SAFE_INTEGER)||a.sourcePlaceId.localeCompare(b.sourcePlaceId))
  .map(visit=>visit.id));

const trip=first.trips.find(item=>item.id==="trip-test-multiday");
assert.ok(trip);
assert.equal(trip.color,fixture.trips.find(item=>item.id==="trip-test-multiday").data.color);
assert.deepEqual(new Set(trip.participantUserIds),new Set(["test-user-a","test-user-b"]));

const external=convertLegacySpace({sourceSpace:"us",importedAt:input.importedAt,places:[{id:"legacy-google",data:{
  name:"Google place",lat:25,lng:121,source:"google",extId:"ChIJ-test",visitedOn:"2026-01-01",who:["a"]
}}]});
const expectedExternalId=externalPlaceDocumentId({source:"google",extId:"ChIJ-test"});
assert.equal(external.visits[0].placeId,expectedExternalId,"external Places migrate to the same deterministic identity used by runtime writes");
assert.equal(external.documents.some(item=>item.path===`places/${expectedExternalId}`),true);

const blocked=convertLegacySpace({sourceSpace:"us",importedAt:input.importedAt,places:[{id:"empty",data:{
  name:"Explicitly empty",lat:25,lng:121,status:"visited",visits:[{date:"2026-01-02",participantIds:[]}],who:["a"]
}}]});
assert.equal(blocked.counts.visits,0);
assert.equal(blocked.blockers.some(item=>item.code==="empty-visit-participants"),true,"explicit empty participant data blocks instead of inventing a User");

assert.throws(()=>convertLegacySpace({sourceSpace:"us",places:[{id:"clock",data:{
  name:"Clock",lat:25,lng:121,visitedOn:"2026-01-01",who:["a"],arrivalTime:"14:30"
}}]}),/clock time/i);

assert.deepEqual(validateMigrationOptions({project:"anything",source_space:"anything",apply:false}),{mode:"dry-run"});
assert.throws(()=>validateMigrationOptions({project:"wrong",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),/locked/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"other",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),/locked/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"wrong"}),/requires --confirm/);
assert.throws(()=>validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"},"127.0.0.1:8085"),/refuses/);
assert.deepEqual(validateMigrationOptions({project:"mapping-505208",source_space:"us",apply:true,confirm:"MAPAIR_NO_SPACE_V1"}),{mode:"apply"});

console.log("migration assertions passed");
