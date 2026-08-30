import assert from "node:assert/strict";
import {
  compareOccurrences,
  occurrence,
  occurrenceDate,
  occurrenceKey,
  sortOccurrences,
  stayAnchorRank,
  stayAnchorsOnDate
} from "../src/domain/occurrences.js";

/* occurrence() shape */
const o = occurrence({ id: "p1" }, { id: "v1", date: "2026-08-02" }, 3, "2026-08-02", "night", true);
assert.deepEqual(o, {
  p: { id: "p1" },
  v: { id: "v1", date: "2026-08-02" },
  visitIndex: 3,
  seqDate: "2026-08-02",
  stayAnchor: "night",
  fixed: true
});
const bare = occurrence({ id: "p2" }, { id: "v2" }, 0, "2026-08-01");
assert.equal(bare.stayAnchor, "", "stayAnchor defaults to empty");
assert.equal(bare.fixed, false, "fixed defaults to false");

/* occurrenceDate: seqDate wins, then v.date, then "" */
assert.equal(occurrenceDate({ seqDate: "2026-08-05", v: { date: "2026-08-01" } }), "2026-08-05");
assert.equal(occurrenceDate({ seqDate: "", v: { date: "2026-08-01" } }), "2026-08-01");
assert.equal(occurrenceDate({ v: {} }), "");
assert.equal(occurrenceDate(undefined), "");

/* occurrenceKey */
assert.equal(
  occurrenceKey({ p: { id: "pA" }, visitIndex: 2, seqDate: "2026-08-03", stayAnchor: "morning" }),
  "pA:2:2026-08-03:morning"
);
assert.equal(occurrenceKey({ p: { id: "pA" }, visitIndex: 0, v: { date: "2026-08-01" } }), "pA:0:2026-08-01:");
assert.equal(occurrenceKey({}), ":::", "missing pieces collapse to empty segments");

/* stayAnchorRank: morning before ordinary before night */
assert.equal(stayAnchorRank({ stayAnchor: "morning" }), 0);
assert.equal(stayAnchorRank({ stayAnchor: "" }), 1);
assert.equal(stayAnchorRank({ stayAnchor: "night" }), 2);
assert.equal(stayAnchorRank({}), 1);

/* compareOccurrences */
const mk = (date, extra = {}) => ({ p: { id: "p" }, visitIndex: 0, v: { date }, seqDate: date, stayAnchor: "", ...extra });

assert.ok(compareOccurrences(mk("2026-08-01"), mk("2026-08-02")) < 0, "earlier date sorts first");

const sameDay = "2026-08-02";
assert.ok(
  compareOccurrences(
    { ...mk(sameDay), stayAnchor: "morning" },
    { ...mk(sameDay), stayAnchor: "night" }
  ) < 0,
  "same day: morning before night"
);

assert.ok(
  compareOccurrences(
    { ...mk(sameDay), v: { date: sameDay, order: 1 } },
    { ...mk(sameDay), v: { date: sameDay, order: 2 } }
  ) < 0,
  "lower personal order sorts first"
);
assert.ok(
  compareOccurrences(
    { ...mk(sameDay), v: { date: sameDay, order: 5 } },
    { ...mk(sameDay), v: { date: sameDay } }
  ) < 0,
  "a Visit with an order sorts before one without (missing order = last)"
);
assert.ok(
  compareOccurrences(
    { ...mk(sameDay), v: { date: sameDay, order: "3" } },
    { ...mk(sameDay), v: { date: sameDay, order: "10" } }
  ) < 0,
  "numeric-string order is compared numerically, not lexically"
);

/* placeOrder tiebreak then visitIndex */
const placeOrder = (place) => place.ord;
assert.ok(
  compareOccurrences(
    { p: { id: "a", ord: 1 }, visitIndex: 0, v: { date: sameDay }, seqDate: sameDay, stayAnchor: "" },
    { p: { id: "b", ord: 2 }, visitIndex: 0, v: { date: sameDay }, seqDate: sameDay, stayAnchor: "" },
    placeOrder
  ) < 0,
  "Place-level fallback breaks a tie"
);
assert.ok(
  compareOccurrences(
    { p: { id: "a", ord: 1 }, visitIndex: 0, v: { date: sameDay }, seqDate: sameDay, stayAnchor: "" },
    { p: { id: "a", ord: 1 }, visitIndex: 1, v: { date: sameDay }, seqDate: sameDay, stayAnchor: "" },
    placeOrder
  ) < 0,
  "visitIndex is the final tiebreak"
);

/* sortOccurrences copies, never mutates */
const input = [mk("2026-08-03"), mk("2026-08-01"), mk("2026-08-02")];
const sorted = sortOccurrences(input);
assert.deepEqual(sorted.map(occurrenceDate), ["2026-08-01", "2026-08-02", "2026-08-03"]);
assert.deepEqual(input.map(occurrenceDate), ["2026-08-03", "2026-08-01", "2026-08-02"], "input untouched");

/* stayAnchorsOnDate: arrival D1 → checkout D3 (two nights) */
assert.deepEqual(stayAnchorsOnDate("2026-08-01", "2026-08-03", "2026-07-31"), [], "before arrival: nothing");
assert.deepEqual(stayAnchorsOnDate("2026-08-01", "2026-08-03", "2026-08-01"), ["night"], "arrival day: sleeps, no morning");
assert.deepEqual(
  stayAnchorsOnDate("2026-08-01", "2026-08-03", "2026-08-02"),
  ["morning", "night"],
  "middle day: still there in the morning and sleeps that night"
);
assert.deepEqual(stayAnchorsOnDate("2026-08-01", "2026-08-03", "2026-08-03"), ["morning"], "checkout day: morning only");
assert.deepEqual(stayAnchorsOnDate("2026-08-01", "2026-08-03", "2026-08-04"), [], "after checkout: nothing");
assert.deepEqual(stayAnchorsOnDate("2026-08-01", "", "2026-08-01"), [], "no checkout: caller handles it");

console.log("occurrences assertions passed");
