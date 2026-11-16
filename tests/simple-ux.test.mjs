import assert from "node:assert/strict";
import { PURPOSE_NAMES, LEGACY_CATEGORY_MAP, purposeOf, categoryToStore } from "../src/domain/purposes.js";
import { classifyAreaDepth, depthByPlace, placeAreaKey, DEPTH_ORDER } from "../src/domain/area-depth.js";
import { isForeignPlace, resolveTripType, tripTypePass, TRIP_TYPE_KEYS } from "../src/domain/trip-type.js";
import { tripPass, visitPasses } from "../src/domain/filter.js";
import { readFileSync } from "node:fs";
import { emojiMatches, searchEmoji } from "../src/ui/emoji-picker.js";
import { nextStarRating } from "../src/ui/visit-editor.js";

/* purposes */
assert.deepEqual(PURPOSE_NAMES, ["交通", "文史", "自然", "考察", "娛樂", "飲食", "其他"]);
for (const [legacy, purpose] of Object.entries(LEGACY_CATEGORY_MAP)) {
  assert.ok(PURPOSE_NAMES.includes(purpose), `${legacy} maps to a real purpose`);
}
// every former preset is covered
for (const name of ["餐飲","咖啡","購物","娛樂","文化","景點","自然","戶外","住宿","交通","教育","醫療","宗教","運動","工作","社交","生活","住家","慶祝","其他"]) {
  assert.ok(LEGACY_CATEGORY_MAP[name], `legacy preset ${name} is mapped`);
}
assert.equal(purposeOf("餐飲"), "飲食");
assert.equal(purposeOf("咖啡"), "飲食");
assert.equal(purposeOf("景點"), "文史");
assert.equal(purposeOf("工作"), "考察");
assert.equal(purposeOf("住宿"), "其他");
assert.equal(purposeOf("飲食"), "飲食", "new values pass through");
assert.equal(purposeOf("  自然 "), "自然", "trimmed");
assert.equal(purposeOf(""), "", "no category stays empty");
assert.equal(purposeOf(undefined), "");
assert.equal(purposeOf("拉麵店"), "飲食", "free text: keyword");
assert.equal(purposeOf("龍山寺參拜"), "文史");
assert.equal(purposeOf("合歡山步道"), "自然");
assert.equal(purposeOf("台北車站轉乘"), "交通");
assert.equal(purposeOf("田野調查"), "考察");
assert.equal(purposeOf("看電影"), "娛樂");
assert.equal(purposeOf("隨便寫的"), "其他", "unknown free text -> 其他");

assert.equal(categoryToStore("飲食", "咖啡"), "咖啡", "kept the mapped purpose: original text preserved");
assert.equal(categoryToStore("文史", "咖啡"), "文史", "changed purpose: new value");
assert.equal(categoryToStore("飲食", ""), "飲食");
assert.equal(categoryToStore("", "咖啡"), "", "cleared");

/* area depth */
assert.deepEqual(DEPTH_ORDER, ["接地", "旅遊", "住宿"]);
assert.equal(classifyAreaDepth([]), "");
assert.equal(classifyAreaDepth([{ placeId: "a", purpose: "飲食" }]), "接地");
assert.equal(classifyAreaDepth([
  { placeId: "a", purpose: "飲食" }, { placeId: "b", purpose: "飲食" }, { placeId: "c", purpose: "飲食" }
]), "接地", "3 places but one purpose");
assert.equal(classifyAreaDepth([
  { placeId: "a", purpose: "飲食" }, { placeId: "a", purpose: "文史" }, { placeId: "b", purpose: "飲食" }
]), "接地", "two purposes but only 2 distinct places");
assert.equal(classifyAreaDepth([
  { placeId: "a", purpose: "飲食" }, { placeId: "b", purpose: "文史" }, { placeId: "c", purpose: "" }
]), "旅遊");
assert.equal(classifyAreaDepth([{ placeId: "a", purpose: "飲食", kind: "stay" }]), "住宿", "a stay wins");

assert.equal(placeAreaKey({ id: "p", townCode: "6300100" }), "town:6300100");
assert.equal(placeAreaKey({ id: "p", admin: { country: "日本", county: "東京都", city: "新宿區" } }), "admin:日本|東京都|新宿區");
assert.equal(placeAreaKey({ id: "p" }), "place:p");

{
  const places = [
    { id: "hotel", townCode: "T1" }, { id: "cafe", townCode: "T1" },
    { id: "a", townCode: "T2" }, { id: "b", townCode: "T2" }, { id: "c", townCode: "T2" },
    { id: "solo", townCode: "T3" }, { id: "never", townCode: "T4" }
  ];
  const visits = {
    hotel: [{ placeId: "hotel", kind: "stay", purpose: "其他" }],
    cafe: [{ placeId: "cafe", purpose: "飲食" }],
    a: [{ placeId: "a", purpose: "飲食" }], b: [{ placeId: "b", purpose: "自然" }], c: [{ placeId: "c", purpose: "自然" }],
    solo: [{ placeId: "solo", purpose: "交通" }], never: []
  };
  const depth = depthByPlace(places, (p) => visits[p.id]);
  assert.equal(depth.get("hotel"), "住宿");
  assert.equal(depth.get("cafe"), "住宿", "the whole district takes the stay depth");
  assert.equal(depth.get("a"), "旅遊");
  assert.equal(depth.get("solo"), "接地");
  assert.equal(depth.has("never"), false, "no filter-passing visit, no depth");
}

/* trip type */
assert.deepEqual(TRIP_TYPE_KEYS, ["daily", "domestic", "abroad", "overseas"]);
assert.equal(isForeignPlace({ lat: 25.03, lng: 121.56 }), false, "Taipei");
assert.equal(isForeignPlace({ lat: 23.57, lng: 119.58 }), false, "Penghu");
assert.equal(isForeignPlace({ lat: 24.43, lng: 118.32 }), false, "Kinmen");
assert.equal(isForeignPlace({ lat: 26.16, lng: 119.95 }), false, "Matsu");
assert.equal(isForeignPlace({ lat: 35.68, lng: 139.76 }), true, "Tokyo");
assert.equal(isForeignPlace({ lat: 34.47, lng: 133.99 }), true, "Naoshima");
assert.equal(isForeignPlace({ lat: 24.48, lng: 118.09 }), true, "Xiamen is not Kinmen");
assert.equal(isForeignPlace({ lat: 35.68, lng: 139.76, admin: { country: "台灣" } }), false, "country name wins");
assert.equal(isForeignPlace({ lat: 25, lng: 121.5, admin: { country: "日本" } }), true);
assert.equal(isForeignPlace({ lat: 99, lng: 999, countyCode: "63000" }), false, "a Taiwan county code is domestic");
assert.equal(isForeignPlace({}), false, "no coordinates: not foreign");

assert.equal(resolveTripType("abroad", [{ lat: 25, lng: 121.5 }]), "abroad", "stored type wins");
assert.equal(resolveTripType(undefined, [{ lat: 25, lng: 121.5 }, { lat: 35.68, lng: 139.76 }]), "overseas", "any foreign Place -> 出國");
assert.equal(resolveTripType("bogus", [{ lat: 25, lng: 121.5 }]), "domestic");
assert.equal(resolveTripType(undefined, []), "domestic");

const types = { t1: "overseas", t2: "daily" };
const typeOf = (id) => types[id];
assert.equal(tripTypePass("daily", "", typeOf), true, "no Trip counts as 日常");
assert.equal(tripTypePass("daily", "t2", typeOf), true);
assert.equal(tripTypePass("overseas", "t1", typeOf), true);
assert.equal(tripTypePass("overseas", "", typeOf), false);

assert.equal(tripPass("type:overseas", "t1", typeOf), true);
assert.equal(tripPass("type:overseas", "t2", typeOf), false);
assert.equal(tripPass("type:daily", "", typeOf), true);
assert.equal(tripPass("type:overseas", "t1"), false, "no resolver: type selection fails closed");
assert.equal(tripPass("daily", ""), true, "legacy 'daily' = no Trip still works");
assert.equal(tripPass("t1", "t1"), true);

{
  const resolve = { participantIds: () => ["u"], category: () => "", checkout: () => "", tripType: typeOf };
  const criteria = { who: "all", tripId: "type:overseas", cats: new Set(), from: "", to: "", regions: [], q: "" };
  assert.equal(visitPasses({ name: "x" }, { tripId: "t1", date: "2026-01-01" }, criteria, resolve), true);
  assert.equal(visitPasses({ name: "x" }, { tripId: "t2", date: "2026-01-01" }, criteria, resolve), false);
}

/* emoji search */
assert.equal(emojiMatches("拉麵 麵 ramen noodle", "拉麵"), true);
assert.equal(emojiMatches("拉麵 麵 ramen noodle", "RAMEN"), true, "case-insensitive");
assert.equal(emojiMatches("拉麵 麵 ramen noodle", "麵 ramen"), true, "all terms must match");
assert.equal(emojiMatches("拉麵 麵 ramen noodle", "麵 pizza"), false);
assert.equal(emojiMatches("anything", ""), true);

{
  const data = JSON.parse(readFileSync(new URL("../src/data/emoji.json", import.meta.url), "utf8"));
  assert.ok(data.list.length > 1800, "the full emoji set is bundled");
  const first = (q) => searchEmoji(data.list, q)[0]?.[0];
  assert.equal(first("拉麵"), "🍜", "Taiwan keyword supplement");
  assert.equal(first("珍奶"), "🧋");
  assert.equal(first("溫泉"), "♨️");
  assert.equal(first("鳥居"), "⛩️");
  assert.ok(searchEmoji(data.list, "plane").some(([e]) => e === "✈️"), "English keywords");
  assert.ok(searchEmoji(data.list, "炸麵條").length > 0, "no exact hit falls back to shared characters");
  assert.deepEqual(searchEmoji(data.list, "zzzqqq"), []);
}

/* star rating cycle: n -> n-½ -> 0 */
assert.equal(nextStarRating(0, 4), 4);
assert.equal(nextStarRating(4, 4), 3.5);
assert.equal(nextStarRating(3.5, 4), 0);
assert.equal(nextStarRating(2, 5), 5);
assert.equal(nextStarRating(5, 1), 1);

console.log("simple-ux assertions passed");
