import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveRuntimeConfig } from "../src/config.js";
import { resolveProximityMaskMode } from "../src/proximity-geometry.js";
import {
  MAP_SURFACE_Z_INDEX,
  hasFinitePlaceCoordinates,
  isVisitReorderAvailable,
  layoutViewState,
  ordinaryOccurrences,
  placeSharedFields,
  reorderWithinSlots,
  resolveVisitMoveTarget,
  shouldAutoFitViewport,
  shouldFitFilterViewport,
  shouldRenderAdministrativeThematicFill,
  shouldShowAdministrativeLegend,
  shouldShowRegionBlackout,
  shouldShowReorderControls,
  transitionMapSurfaceState,
  visitMatchesReorderScope
} from "../src/ux-policies.js";

const available = overrides => isVisitReorderAvailable({ tripId:"all", ...overrides });
assert.equal(available({}), true, "no-filter ordering is available");
assert.equal(available({ from:"2024-04-01", to:"2024-04-30" }), true, "date-only ordering is available");
assert.equal(available({ tripId:"trip-a", hasSpecificTrip:true }), true, "Trip-only ordering is available");
assert.equal(available({ tripId:"trip-a", hasSpecificTrip:true, from:"2024-04-01" }), true, "Trip + date ordering is available");
assert.equal(available({ who:"test-user-a" }), true, "participant-only ordering is available");
assert.equal(available({ who:"test-user-a", from:"2024-04-01" }), true, "participant + date ordering is available");
assert.equal(available({ who:"test-user-a", tripId:"trip-a", hasSpecificTrip:true }), true, "participant + Trip ordering is available");
assert.equal(available({ who:"test-user-a", tripId:"trip-a", hasSpecificTrip:true, from:"2024-04-01" }), true, "participant + Trip + date ordering is available");
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

const participantA1 = { id:"participant-a1", v:{kind:"visit",tripId:"",who:["a"]} };
const participantX = { id:"participant-x", v:{kind:"visit",tripId:"",who:["b"]} };
const participantA2 = { id:"participant-a2", v:{kind:"visit",tripId:"",who:["a","b"]} };
const participantScope = { participantId:"a", tripId:"" };
const participantMovable = item => visitMatchesReorderScope({tripId:item.v.tripId,participants:item.v.who},participantScope);
const participantSlotted = reorderWithinSlots([participantA1,participantX,participantA2],participantMovable,1,0);
assert.deepEqual(participantSlotted.map(x=>x.id), ["participant-a2","participant-x","participant-a1"], "participant Visits exchange only participant slots");
assert.equal(participantSlotted[1], participantX, "hidden participant Visit stays in place");
assert.equal(visitMatchesReorderScope({participants:["a","b"]},{participantId:"a"}), true, "a both-participant Visit matches participant A");
assert.equal(visitMatchesReorderScope({participants:["a","b"]},{participantId:"b"}), true, "a both-participant Visit matches participant B");

const combinedA1 = { id:"combined-a1", v:{tripId:"trip-a",who:["a"]} };
const wrongTrip = { id:"wrong-trip", v:{tripId:"trip-b",who:["a"]} };
const wrongParticipant = { id:"wrong-participant", v:{tripId:"trip-a",who:["b"]} };
const combinedA2 = { id:"combined-a2", v:{tripId:"trip-a",who:["a","b"]} };
const combinedScope = { participantId:"a", tripId:"trip-a" };
const combinedMovable = item => visitMatchesReorderScope({tripId:item.v.tripId,participants:item.v.who},combinedScope);
const combinedSlotted = reorderWithinSlots([combinedA1,wrongTrip,wrongParticipant,combinedA2],combinedMovable,1,0);
assert.deepEqual(combinedSlotted.map(x=>x.id), ["combined-a2","wrong-trip","wrong-participant","combined-a1"], "participant + Trip uses the intersection while preserving hidden slots");

assert.equal(resolveVisitMoveTarget("first", 2, 4), 0);
assert.equal(resolveVisitMoveTarget("last", 1, 4), 3);
assert.equal(resolveVisitMoveTarget("2", 3, 4), 1);
assert.equal(resolveVisitMoveTarget("up", 0, 4), 0);
assert.equal(resolveVisitMoveTarget("down", 3, 4), 3);
assert.equal(shouldShowReorderControls(1), false, "one movable Visit has no reorder controls");
assert.equal(shouldShowReorderControls(2), true, "two movable Visits have reorder controls");

assert.equal(shouldAutoFitViewport({ tripId:"trip-a", regionCount:0 }), true);
assert.equal(shouldAutoFitViewport({ tripId:"trip-a", regionCount:1 }), false);
assert.equal(shouldAutoFitViewport({ tripId:"all", regionCount:1 }), false, "any active region filter suppresses passive auto-fit");
assert.equal(shouldFitFilterViewport({ requested:false, regionCount:1 }), false, "administrative map selection explicitly preserves the viewport");
assert.equal(shouldFitFilterViewport({ requested:false, regionCount:0 }), false, "removing the final region through the map still preserves the viewport");
assert.equal(shouldFitFilterViewport({ requested:true, tripId:"trip-a", regionCount:0 }), true, "Trip-only filtering may still fit");

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/mapair-baseline.json", import.meta.url), "utf8"));
const station = fixture.places.find(x=>x.id==="place-test-station").data;
const copiedVisitFields = { ...station.visits[0], level:"經過", rating:1, review:"stale visit copy" };
assert.deepEqual(placeSharedFields(station, station.visits[0]), { level:"接地", rating:4.5, review:"測試共用評論：每次造訪都應看到同一段文字。" });
assert.deepEqual(placeSharedFields(station, copiedVisitFields), placeSharedFields(station), "Visit data cannot override shared Place fields");

assert.equal(hasFinitePlaceCoordinates({lat:25,lng:121}), true, "finite numeric coordinates are marker-safe");
assert.equal(hasFinitePlaceCoordinates(), false, "a missing Place is not marker-safe");
assert.equal(hasFinitePlaceCoordinates({lat:undefined,lng:121}), false, "a missing latitude is not marker-safe");
assert.equal(hasFinitePlaceCoordinates({lat:25,lng:Infinity}), false, "non-finite coordinates are not marker-safe");
assert.equal(hasFinitePlaceCoordinates({lat:"25",lng:121}), false, "numeric strings are not marker-safe");

assert.throws(()=>resolveRuntimeConfig("localhost", ""), /requires the exact query parameter/);
assert.throws(()=>resolveRuntimeConfig("localhost", "?firebaseEnv=local&firebaseEnv=local"), /must be exactly/);
assert.throws(()=>resolveRuntimeConfig("mapair.example", "?firebaseEnv=local"), /only on localhost/);
const localConfig=resolveRuntimeConfig("127.0.0.1", "?firebaseEnv=local");
assert.equal(localConfig.firebase.projectId, "demo-mapair-local");
assert.equal(localConfig.emulators.auth.url, "http://127.0.0.1:9099");
assert.equal(localConfig.emulators.firestore.port, 8080);

assert.deepEqual(layoutViewState({map:true,filter:false,list:false},false), {
  mapHidden:true,filterHidden:false,listHidden:false,contentHidden:false,menuOpen:false,compactSidebar:false
}, "desktop map-hidden state gives the side all available width");
assert.equal(layoutViewState({map:false,filter:true,list:true},false).compactSidebar, true, "closed content-only sidebar is compact");
assert.equal(layoutViewState({map:false,filter:true,list:true},true).compactSidebar, false, "opening the layout menu temporarily expands the sidebar");
assert.equal(layoutViewState({map:false,filter:true,list:true},false).contentHidden, true, "both content areas hide tabs and empty side content");
const indexHtml=fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource=fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const renderMarkersSource=mainSource.slice(mainSource.indexOf("function renderMarkers()"),mainSource.indexOf("function dateMarkerLegendBody()"));
assert.equal(
  [...renderMarkersSource.matchAll(/if \(!hasFinitePlaceCoordinates\(p\)\) return;/g)].length,
  2,
  "normal and sequence marker creation are both guarded by the finite-coordinate policy"
);
assert.doesNotMatch(renderMarkersSource,/pin\.element/,"marker rendering does not use deprecated PinElement.element");
assert.match(renderMarkersSource,/pin\.style\.cursor = "pointer";/,"the normal-mode PinElement is styled directly, not via a deprecated inner element");
assert.match(renderMarkersSource,/content = pin;[\s\S]*?new AdvMarker\(\{ map, position:\{lat:p\.lat,lng:p\.lng\}, content,/,"the PinElement is passed to AdvancedMarkerElement as its content");
assert.match(renderMarkersSource,/placeVisits\(p\)\.filter\(v=>visitPassFilter\(p,v\)\)\.length/,"a Place's repeated-Visit count is derived from the filtered Visit list");
assert.match(indexHtml,/\.wrap\.map-hidden\{grid-template-columns:0 minmax\(0,1fr\)\}/,"desktop map column collapses");
assert.match(indexHtml,/\.wrap\.layout-compact\{grid-template-columns:minmax\(0,1fr\) 58px\}/,"desktop compact sidebar releases map width");
assert.match(indexHtml,/\.wrap\.map-hidden\{grid-template-columns:1fr;grid-template-rows:0 minmax\(0,1fr\)\}/,"mobile map-hidden state remains vertically stacked");
assert.match(indexHtml,/\.wrap\.layout-compact\{grid-template-columns:1fr;grid-template-rows:minmax\(0,1fr\) auto\}/,"mobile compact state expands the map vertically");

const combinedSurface = { adminLevel:"town", proximityEnabled:true };
assert.deepEqual(
  transitionMapSurfaceState(combinedSurface,{type:"admin",level:"village"}),
  {adminLevel:"village",proximityEnabled:true},
  "switching town to village preserves proximity"
);
assert.deepEqual(
  transitionMapSurfaceState(combinedSurface,{type:"proximity"}),
  {adminLevel:"town",proximityEnabled:false},
  "toggling proximity does not alter the administrative level"
);
assert.deepEqual(
  transitionMapSurfaceState({adminLevel:"town",proximityEnabled:false},{type:"proximity"}),
  {adminLevel:"town",proximityEnabled:true},
  "administrative and proximity state are independent"
);
assert.deepEqual(
  transitionMapSurfaceState(combinedSurface,{type:"admin",level:"town"}),
  {adminLevel:"off",proximityEnabled:true},
  "clicking the active administrative level returns only that dimension to off"
);
assert.equal(
  shouldShowRegionBlackout({adminLevel:combinedSurface.adminLevel,regionCount:2,proximityEnabled:combinedSurface.proximityEnabled}),
  true,
  "selected-region blackout remains active with proximity"
);
assert.equal(
  shouldRenderAdministrativeThematicFill({adminLevel:"town",proximityEnabled:true}),
  false,
  "proximity disables administrative thematic fill"
);
assert.equal(
  shouldRenderAdministrativeThematicFill({adminLevel:"town",proximityEnabled:false}),
  true,
  "turning proximity off restores administrative thematic fill"
);
assert.equal(
  shouldShowAdministrativeLegend({adminLevel:"town",proximityEnabled:true}),
  false,
  "the administrative thematic legend is hidden with proximity"
);
assert.equal(
  shouldShowAdministrativeLegend({adminLevel:"town",proximityEnabled:false}),
  true,
  "the administrative thematic legend returns when proximity is disabled"
);
assert.match(
  mainSource,
  /function handleAdministrativeRegionClick[\s\S]*?applyFilter\(\{fitViewport:false\}\);/,
  "administrative polygon clicks explicitly request no viewport fitting"
);
assert.equal(
  resolveProximityMaskMode([{key:"townCode",code:"6300500"}],false).type,
  "regions",
  "a selected-region mask constrains proximity even when the Taiwan preference is off"
);
assert.ok(
  MAP_SURFACE_Z_INDEX.adminContext > MAP_SURFACE_Z_INDEX.proximity
    && MAP_SURFACE_Z_INDEX.proximity > MAP_SURFACE_Z_INDEX.adminFill,
  "blackout and boundaries remain above proximity, which remains above administrative fill"
);

console.log("ux-policies assertions passed");
