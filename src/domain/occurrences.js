// Pure primitives for "occurrences" — one dated appearance of a Visit in a
// list or sequence. An occurrence has the shape
//
//   { p, v, visitIndex, seqDate, stayAnchor, fixed }
//
// where `p` is the projected Place, `v` the normalized Visit, `visitIndex` its
// position in `placeVisits(p)`, `seqDate` the date this appearance sits on
// (equal to `v.date` for an ordinary Visit; a per-night date for a stay),
// `stayAnchor` is "" | "morning" | "night", and `fixed` marks a stay anchor the
// user cannot reorder or delete inline.
//
// `src/main.js` owns the enumeration (which Places / Visits pass the active
// filter); this module owns how an occurrence is built, ordered, keyed, and how
// a stay spreads across the nights it occupies. See docs/REFACTOR_PLAN.md.

export function occurrence(p, v, visitIndex, seqDate, stayAnchor = "", fixed = false) {
  return { p, v, visitIndex, seqDate, stayAnchor, fixed };
}

export function occurrenceDate(o) {
  return o?.seqDate || o?.v?.date || "";
}

export function occurrenceKey(o) {
  return `${o?.p?.id || ""}:${o?.visitIndex ?? ""}:${occurrenceDate(o)}:${o?.stayAnchor || ""}`;
}

export function stayAnchorRank(o) {
  return o?.stayAnchor === "morning" ? 0 : o?.stayAnchor === "night" ? 2 : 1;
}

// Ordering within a day / sequence: by date, then morning → ordinary → night,
// then the Visit's personal `order` (missing or non-numeric sorts last), then a
// Place-level tiebreak, then `visitIndex`. `placeOrder(place)` supplies the
// Place-level fallback (main.js passes its createdAt-based `effOrd`); it
// defaults to a no-op so the comparator is usable without it.
export function compareOccurrences(a, b, placeOrder = () => 0) {
  const ad = occurrenceDate(a);
  const bd = occurrenceDate(b);
  if (ad !== bd) return ad.localeCompare(bd);

  const ar = stayAnchorRank(a);
  const br = stayAnchorRank(b);
  if (ar !== br) return ar - br;

  const ao = Number.isFinite(Number(a.v.order)) ? Number(a.v.order) : 1e9;
  const bo = Number.isFinite(Number(b.v.order)) ? Number(b.v.order) : 1e9;
  if (ao !== bo) return ao - bo;

  const eo = placeOrder(a.p) - placeOrder(b.p);
  if (eo) return eo;

  return a.visitIndex - b.visitIndex;
}

// Sort a copy of `list`; never mutates the input.
export function sortOccurrences(list, placeOrder) {
  return [...list].sort((a, b) => compareOccurrences(a, b, placeOrder));
}

// Which stay anchors a fully-bounded stay places on `date`:
//   - "morning": the guest is still there that morning (checkout day included)
//   - "night":   the guest sleeps there that night   (checkout day excluded)
// A middle night returns both, morning first. `checkoutDate` must be a real
// checkout later than `arrivalDate`; callers handle the no-checkout case.
export function stayAnchorsOnDate(arrivalDate, checkoutDate, date) {
  if (!arrivalDate || !checkoutDate || !date) return [];
  const anchors = [];
  if (date > arrivalDate && date <= checkoutDate) anchors.push("morning");
  if (date >= arrivalDate && date < checkoutDate) anchors.push("night");
  return anchors;
}
