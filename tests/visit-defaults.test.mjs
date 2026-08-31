import assert from "node:assert/strict";
import { defaultNewVisitDate } from "../src/domain/visit-defaults.js";

const TODAY = "2026-08-31";
const base = { dateScope: "month", today: TODAY };

/* 1. nothing special -> today */
assert.equal(defaultNewVisitDate({ ...base }), TODAY);
assert.equal(defaultNewVisitDate({ ...base, dateScope: "month", rangeStart: "2026-08-01" }), TODAY, "the month scope always means today");
assert.equal(defaultNewVisitDate({ ...base, dateScope: "all" }), TODAY, "all-dates scope has no start -> today");

/* 2. a specific Trip -> its first day */
assert.equal(defaultNewVisitDate({ ...base, dateScope: "all", tripStart: "2026-08-03" }), "2026-08-03");
assert.equal(
  defaultNewVisitDate({ ...base, dateScope: "all", tripStart: "" }),
  TODAY,
  "a Trip with no startDate and no Visits falls through to today"
);

/* 3. a non-month date scope -> that scope's start */
assert.equal(defaultNewVisitDate({ ...base, dateScope: "lastmonth", rangeStart: "2026-07-01" }), "2026-07-01");
assert.equal(defaultNewVisitDate({ ...base, dateScope: "pickedMonth", rangeStart: "2026-05-01" }), "2026-05-01");
assert.equal(defaultNewVisitDate({ ...base, dateScope: "custom", rangeStart: "2026-01-15" }), "2026-01-15");
assert.equal(defaultNewVisitDate({ ...base, dateScope: "custom", rangeStart: "" }), TODAY, "custom with no start -> today");

/* single-day window sits between Trip and scope */
assert.equal(defaultNewVisitDate({ ...base, singleDay: "2026-08-20", rangeStart: "2026-08-20", dateScope: "custom" }), "2026-08-20");

/* 4. the last Visit created this session wins over everything */
assert.equal(
  defaultNewVisitDate({ ...base, lastNewVisitDate: "2026-08-08", tripStart: "2026-08-03", dateScope: "all" }),
  "2026-08-08",
  "ditto beats the Trip's first day once you have added one Visit"
);
assert.equal(
  defaultNewVisitDate({ ...base, lastNewVisitDate: "2026-06-06", dateScope: "lastmonth", rangeStart: "2026-07-01" }),
  "2026-06-06"
);

console.log("visit-defaults assertions passed");
