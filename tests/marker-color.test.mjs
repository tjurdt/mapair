import assert from "node:assert/strict";
import { resolveMarkerColor } from "../src/domain/marker-color.js";

// A source whose readers echo fixed values; override per test.
function source(overrides = {}) {
  return {
    category: () => "",
    categoryColor: (name) => `cat:${name}`,
    noCategoryColor: "#none",
    level: () => undefined,
    levelColor: (name) => ({ 旅遊: "#trip", 住宿: "#stay" })[name],
    participantColor: () => "#who",
    tripColor: () => "",
    rating: () => undefined,
    ratingColor: (value) => `rating:${value}`,
    ...overrides
  };
}

/* cat */
assert.equal(resolveMarkerColor("cat", source({ category: () => "咖啡" })), "cat:咖啡");
assert.equal(resolveMarkerColor("cat", source({ category: () => "" })), "#none", "no category -> the none colour, never a fall-through");

/* level */
assert.equal(resolveMarkerColor("level", source({ level: () => "旅遊" })), "#trip");
assert.equal(resolveMarkerColor("level", source({ level: () => undefined })), "", "no level -> fall through");
assert.equal(
  resolveMarkerColor("level", source({ level: () => "不明", levelColor: () => undefined })),
  "",
  "unknown level -> fall through, never undefined"
);

/* who — always a colour, never a fall-through */
assert.equal(resolveMarkerColor("who", source()), "#who");

/* trip */
assert.equal(resolveMarkerColor("trip", source({ tripColor: () => "#t" })), "#t");
assert.equal(resolveMarkerColor("trip", source({ tripColor: () => "" })), "", "no coloured Trip -> fall through");

/* rating */
assert.equal(resolveMarkerColor("rating", source({ rating: () => 4.5 })), "rating:4.5");
assert.equal(resolveMarkerColor("rating", source({ rating: () => 0 })), "", "0 / unrated -> fall through");
assert.equal(resolveMarkerColor("rating", source({ rating: () => undefined })), "");

/* date modes and anything unknown -> "" so the caller uses its default */
assert.equal(resolveMarkerColor("dateFirst", source({ category: () => "咖啡" })), "");
assert.equal(resolveMarkerColor("dateLast", source()), "");
assert.equal(resolveMarkerColor("mystery", source()), "");

/* the documented composition: visit source falls through to place source
   falls through to the CSS default */
const cssDefault = "#visited";
const place = (mode, overrides) => resolveMarkerColor(mode, source(overrides)) || cssDefault;
const visit = (mode, vOverrides, pOverrides) =>
  resolveMarkerColor(mode, source(vOverrides)) || place(mode, pOverrides);

assert.equal(visit("level", { level: () => "住宿" }, { level: () => "旅遊" }), "#stay", "visit level wins");
assert.equal(visit("level", { level: () => undefined }, { level: () => "旅遊" }), "#trip", "falls to place level");
assert.equal(visit("level", { level: () => undefined }, { level: () => undefined }), cssDefault, "falls to CSS default");
assert.equal(visit("trip", { tripColor: () => "" }, { tripColor: () => "#pt" }), "#pt", "trip colour falls place-ward");
assert.equal(visit("cat", { category: () => "" }, { category: () => "咖啡" }), "#none", "cat never falls through, even when empty");

console.log("marker-color assertions passed");
