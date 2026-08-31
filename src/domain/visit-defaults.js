// Pure: which date should a new Visit's editor default to, given the current
// entry context? Precedence:
//
//   1. lastNewVisitDate — the date of the last Visit the user created this
//      entry session. A "ditto" default that follows the user as they add one
//      stop after another; the caller clears it when the Trip / date scope
//      changes so the next entry starts from a fresh default.
//   2. tripStart — a selected specific Trip's first day (its startDate, or its
//      earliest Visit's date; the caller resolves this).
//   3. singleDay — the active single-day date window.
//   4. rangeStart — a non-"month" date scope's start date.
//   5. today.
//
// `today` is injected so the function stays pure.

export function defaultNewVisitDate({
  lastNewVisitDate = "",
  tripStart = "",
  singleDay = "",
  dateScope = "month",
  rangeStart = "",
  today = ""
} = {}) {
  if (lastNewVisitDate) return lastNewVisitDate;
  if (tripStart) return tripStart;
  if (singleDay) return singleDay;
  if (dateScope !== "month" && rangeStart) return rangeStart;
  return today;
}
