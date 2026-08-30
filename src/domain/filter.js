// Pure Visit / Place filter predicates. `criteria` is the subset of the app's
// `filter` state that narrows Visits: { who, tripId, cats, from, to, regions }.
//
// `resolve` injects how to read a Visit's fields:
//   - participantIds(place, visit) -> string[]
//   - category(place, visit)       -> string   (the value compared to `cats`)
//   - checkout(visit)              -> string   ("" for an ordinary Visit)
// The list path resolves category through the Place-categories fallback; the
// map-area path uses the raw projected category only — that is the one real
// difference between the two former predicates. See docs/REFACTOR_PLAN.md.

export function regionsPass(regions, place) {
  if (!regions || !regions.length) return true;
  return regions.some((r) => place?.[r.key] === r.code);
}

export function participantPass(who, participantIds) {
  return who === "all" || (participantIds || []).includes(who);
}

export function tripPass(tripId, visitTripId) {
  if (tripId === "all") return true;
  if (tripId === "daily") return !visitTripId;
  return visitTripId === tripId;
}

export function categoryPass(cats, category) {
  return !cats || cats.size === 0 || cats.has(category);
}

// Whether a Visit touches [from, to]. An ordinary Visit and a stay with no
// valid checkout (`checkout === ""`) behave identically. The checkout day is
// still "inside" the range at its start — a preserved quirk
// (docs/archive/baseline/BEHAVIOR_CHECKLIST.md §7).
export function dateRangePass(date, checkout, from, to) {
  if (!date) return false;
  const end = checkout || date;
  if (from && end < from) return false;
  if (to && date > to) return false;
  return true;
}

export function visitPasses(place, visit, criteria, resolve) {
  return (
    regionsPass(criteria.regions, place) &&
    participantPass(criteria.who, resolve.participantIds(place, visit)) &&
    tripPass(criteria.tripId, visit.tripId) &&
    categoryPass(criteria.cats, resolve.category(place, visit)) &&
    dateRangePass(visit.date, resolve.checkout(visit), criteria.from, criteria.to)
  );
}

export function hasActiveVisitConstraint(criteria) {
  return (
    criteria.who !== "all" ||
    criteria.tripId !== "all" ||
    !!criteria.from ||
    !!criteria.to ||
    !!(criteria.cats && criteria.cats.size)
  );
}

// A Place passes when it clears the region filter and — if any Visit-level
// constraint is active — at least one of `visits` passes.
export function placePasses(place, visits, criteria, resolve) {
  if (!regionsPass(criteria.regions, place)) return false;
  if (!hasActiveVisitConstraint(criteria)) return true;
  return visits.some((visit) => visitPasses(place, visit, criteria, resolve));
}
