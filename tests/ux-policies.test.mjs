import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveRuntimeConfig } from "../src/config.js";
import {
  isVisitReorderAvailable,
  ordinaryOccurrences,
  placeSharedFields,
  reorderWithinSlots,
  resolveVisitMoveTarget,
  shouldAutoFitViewport
} from "../src/ux-policies.js";

const available = overrides => isVisitReorderAvailable({ tripId:"all", ...overrides });
assert.equal(available({}), true, "no-filter ordering is available");
assert.equal(available({ from:"2024-04-01", to:"2024-04-30" }), true, "date-only ordering is available");
assert.equal(available({ tripId:"trip-a", hasSpecificTrip:true }), true, "Trip-only ordering is available");
assert.equal(available({ tripId:"trip-a", hasSpecificTrip:true, from:"2024-04-01" }), true, "Trip + date ordering is available");
assert.equal(available({ who:"test-user-a" }), false, "participant filtering disables ordering");
assert.equal(available({ categoryCount:1 }), false, "category filtering disables ordering");
assert.equal(available({ regionCount:1 }), false, "region filtering disables ordering");
assert.equal(available({ textSearch:"station" }), false, "text search disables ordering");
assert.equal(available({ tripId:"daily" }), false, "Daily filtering does not claim specific-Trip slot semantics");

const morning = { id:"morning", fixed:true, stayAnchor:"morning", v:{kind:"stay"} };
const tripA1 = { id:"a1", fixed:false, stayAnchor:"", v:{kind:"visit",tripId:"trip-a"} };
const nonTrip = { id:"x", fixed:false, stayAnchor:"", v:{kind:"visit",tripId:""} };
const tripA2 = { id:"a2", fixed:false, stayAnchor:"", v:{kind:"visit",tripId:"trip-a"} };
const night = { id:"night", fixed:true, stayAnchor:"night", v:{kind:"stay"} };
assert.deepEqual(ordinaryOccurrences([morning,tripA1,nonTrip,tripA2,night]).map(x=>x.id), ["a1","x","a2"], "stay anchors are excluded");

const slotted = reorderWithinSlots([tripA1,nonTrip,tripA2], x=>x.v.tripId==="trip-a", 1, 0);
assert.deepEqual(slotted.map(x=>x.id), ["a2","x","a1"], "Trip visits exchange only their full-day slots");
assert.equal(slotted[1], nonTrip, "hidden non-Trip visit stays in place");

assert.equal(resolveVisitMoveTarget("first", 2, 4), 0);
assert.equal(resolveVisitMoveTarget("last", 1, 4), 3);
assert.equal(resolveVisitMoveTarget("2", 3, 4), 1);
assert.equal(resolveVisitMoveTarget("up", 0, 4), 0);
assert.equal(resolveVisitMoveTarget("down", 3, 4), 3);

assert.equal(shouldAutoFitViewport({ tripId:"trip-a", regionCount:0 }), true);
assert.equal(shouldAutoFitViewport({ tripId:"trip-a", regionCount:1 }), false);
assert.equal(shouldAutoFitViewport({ tripId:"all", regionCount:1 }), true);

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-baseline.json", import.meta.url), "utf8"));
const station = fixture.places.find(x=>x.id==="place-test-station").data;
const copiedVisitFields = { ...station.visits[0], level:"經過", rating:1, review:"stale visit copy" };
assert.deepEqual(placeSharedFields(station, station.visits[0]), { level:"接地", rating:4.5, review:"測試共用評論：每次造訪都應看到同一段文字。" });
assert.deepEqual(placeSharedFields(station, copiedVisitFields), placeSharedFields(station), "Visit data cannot override shared Place fields");

assert.throws(()=>resolveRuntimeConfig("localhost", ""), /requires the exact query parameter/);
assert.throws(()=>resolveRuntimeConfig("localhost", "?firebaseEnv=local&firebaseEnv=local"), /must be exactly/);
assert.throws(()=>resolveRuntimeConfig("mapair.example", "?firebaseEnv=local"), /only on localhost/);
const localConfig=resolveRuntimeConfig("127.0.0.1", "?firebaseEnv=local");
assert.equal(localConfig.firebase.projectId, "demo-mapair-local");
assert.equal(localConfig.emulators.auth.url, "http://127.0.0.1:9099");
assert.equal(localConfig.emulators.firestore.port, 8080);

console.log("ux-policies assertions passed");
