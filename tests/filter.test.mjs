import assert from "node:assert/strict";
import {
  categoryPass,
  dateRangePass,
  hasActiveVisitConstraint,
  participantPass,
  placePasses,
  regionsPass,
  tripPass,
  visitPasses
} from "../src/domain/filter.js";

/* regionsPass */
assert.equal(regionsPass([], { countyCode: "A" }), true, "no regions: always passes");
assert.equal(regionsPass(undefined, {}), true, "missing regions: always passes");
assert.equal(regionsPass([{ key: "countyCode", code: "A" }], { countyCode: "A" }), true);
assert.equal(regionsPass([{ key: "countyCode", code: "A" }], { countyCode: "B" }), false);
assert.equal(
  regionsPass([{ key: "countyCode", code: "A" }, { key: "townCode", code: "T1" }], { townCode: "T1" }),
  true,
  "regions are OR-ed"
);
assert.equal(regionsPass([{ key: "countyCode", code: "A" }], null), false, "no place: cannot match a region");

/* participantPass */
assert.equal(participantPass("all", []), true);
assert.equal(participantPass("u1", ["u1", "u2"]), true);
assert.equal(participantPass("u3", ["u1", "u2"]), false);
assert.equal(participantPass("u1", undefined), false, "specific participant, no ids: fails");

/* tripPass */
assert.equal(tripPass("all", "trip-x"), true);
assert.equal(tripPass("daily", ""), true, "daily matches a Visit with no Trip");
assert.equal(tripPass("daily", undefined), true);
assert.equal(tripPass("daily", "trip-x"), false, "daily excludes a Visit in a Trip");
assert.equal(tripPass("trip-x", "trip-x"), true);
assert.equal(tripPass("trip-x", "trip-y"), false);

/* categoryPass */
assert.equal(categoryPass(new Set(), "餐飲"), true, "empty set: always passes");
assert.equal(categoryPass(null, "餐飲"), true);
assert.equal(categoryPass(new Set(["餐飲", "咖啡"]), "咖啡"), true);
assert.equal(categoryPass(new Set(["餐飲"]), "咖啡"), false);
assert.equal(categoryPass(new Set(["餐飲"]), ""), false, "unset category does not match a constrained filter");

/* dateRangePass — ordinary Visit (checkout "") */
assert.equal(dateRangePass("", "", "2026-08-01", "2026-08-31"), false, "no date: never intersects");
assert.equal(dateRangePass("2026-08-10", "", "", ""), true, "no bounds: always intersects");
assert.equal(dateRangePass("2026-08-10", "", "2026-08-01", "2026-08-31"), true);
assert.equal(dateRangePass("2026-07-31", "", "2026-08-01", "2026-08-31"), false, "before from");
assert.equal(dateRangePass("2026-09-01", "", "2026-08-01", "2026-08-31"), false, "after to");

/* dateRangePass — stay (arrival 08-10, checkout 08-13) */
assert.equal(dateRangePass("2026-08-10", "2026-08-13", "2026-08-12", "2026-08-20"), true, "range starts mid-stay");
assert.equal(dateRangePass("2026-08-10", "2026-08-13", "2026-08-13", "2026-08-20"), true, "checkout day still counts at range start (quirk)");
assert.equal(dateRangePass("2026-08-10", "2026-08-13", "2026-08-14", "2026-08-20"), false, "range starts after checkout");
assert.equal(dateRangePass("2026-08-10", "2026-08-13", "2026-08-01", "2026-08-09"), false, "range ends before arrival");
assert.equal(dateRangePass("2026-08-10", "2026-08-13", "2026-08-01", "2026-08-10"), true, "range ends on arrival day");

/* hasActiveVisitConstraint */
const base = { who: "all", tripId: "all", cats: new Set(), from: "", to: "" };
assert.equal(hasActiveVisitConstraint(base), false, "default filter constrains nothing");
assert.equal(hasActiveVisitConstraint({ ...base, who: "u1" }), true);
assert.equal(hasActiveVisitConstraint({ ...base, tripId: "trip-x" }), true);
assert.equal(hasActiveVisitConstraint({ ...base, from: "2026-08-01" }), true);
assert.equal(hasActiveVisitConstraint({ ...base, to: "2026-08-31" }), true);
assert.equal(hasActiveVisitConstraint({ ...base, cats: new Set(["餐飲"]) }), true);

/* visitPasses / placePasses with injected field readers */
const resolve = {
  participantIds: (_place, visit) => visit.participantUserIds || [],
  category: (_place, visit) => visit.category || "",
  checkout: (visit) => (visit.kind === "stay" && visit.endDate > visit.date ? visit.endDate : "")
};
const place = { id: "p1", countyCode: "A" };
const visitAug02 = { date: "2026-08-02", tripId: "", category: "咖啡", participantUserIds: ["u1"] };
const visitTrip = { date: "2026-08-04", tripId: "trip-x", category: "早餐", participantUserIds: ["u1", "u2"] };

assert.equal(visitPasses(place, visitAug02, base, resolve), true, "no constraints: any Visit passes");
assert.equal(
  visitPasses(place, visitAug02, { ...base, cats: new Set(["咖啡"]) }, resolve),
  true
);
assert.equal(
  visitPasses(place, visitAug02, { ...base, cats: new Set(["早餐"]) }, resolve),
  false
);
assert.equal(
  visitPasses(place, visitAug02, { ...base, who: "u2" }, resolve),
  false,
  "participant not on the Visit"
);
assert.equal(
  visitPasses(place, visitTrip, { ...base, tripId: "daily" }, resolve),
  false,
  "daily filter excludes a Trip Visit"
);
assert.equal(
  visitPasses(place, visitAug02, { ...base, regions: [{ key: "countyCode", code: "B" }] }, resolve),
  false,
  "region mismatch fails regardless of the Visit"
);

const visits = [visitAug02, visitTrip];
assert.equal(placePasses(place, visits, base, resolve), true, "no constraint: Place passes on region alone");
assert.equal(
  placePasses(place, visits, { ...base, regions: [{ key: "countyCode", code: "B" }] }, resolve),
  false
);
assert.equal(
  placePasses(place, visits, { ...base, tripId: "trip-x" }, resolve),
  true,
  "one matching Visit is enough"
);
assert.equal(
  placePasses(place, visits, { ...base, tripId: "trip-y" }, resolve),
  false,
  "no matching Visit: Place fails"
);
assert.equal(
  placePasses(place, [], { ...base, who: "u1" }, resolve),
  false,
  "active constraint + no Visits: fails"
);

console.log("filter assertions passed");
