# Stage 0 Manual Smoke-Test Findings

This document records findings from the first manual Stage 0 smoke-test pass. It supplements `BEHAVIOR_CHECKLIST.md`; it does not change current application behavior or authorize fixes during the Vite/ES-module migration.

## Manual Smoke Test Summary

| Area | Result |
| --- | --- |
| Tabs / Trip navigation | Pass |
| Date filters and viewport fitting under current behavior | Pass |
| Repeated Visits and Visit-specific metadata | Pass |
| Shared Place fields | Partial — inconsistency found |
| Stay anchors | Pass |
| Existing Trip reordering | Pass |
| Marker / color / legend | Pass |
| County / town / village layers | Pass — village is slower |
| Region single / multi-select | Pass |
| Desktop / mobile responsive and collapse behavior | Pass |
| Layout control placement | UX issue found |

Sign-in failure states, destructive editing flows, legacy malformed records, safe fixtures, and automated tests have **not yet been fully verified**.

## Finding 1 — Shared Place fields occasionally inconsistent

### Observed current behavior/issues

- Repeated Visits, dates, Visit-specific category and participants, and Visit focusing behave correctly.
- When different Visits belonging to the same Place are opened, the shared Place-level rating, review, and depth occasionally appear inconsistent, although they are usually correct.

### Future intended behavior

- Rating, review, and depth are Place-level shared fields.
- These values should be identical regardless of which Visit is used to open the Place.

### Items needing investigation or design decisions

- Investigate the intermittent inconsistency and determine its cause.
- Do not fix it during the Vite migration unless the fix is separately scoped.

## Finding 2 — Reordering availability and controls

### Observed current behavior/issues

- With no filter, no up/down reorder controls are shown.
- With only a time/date filter, no up/down reorder controls are shown.
- With a Trip filter, reorder controls are available.
- Existing Trip reordering passed the first manual smoke test.
- Stay-generated morning and night anchors do not participate in ordinary Visit reordering.

### Future intended behavior

Reordering should be available when the visible list represents a complete meaningful ordering scope:

- No filter: allowed.
- Time/date-only filter: allowed.
- Trip-only filter: allowed.

Reordering should be unavailable when filters may hide intermediate Visits, including:

- Category or purpose.
- Participant.
- Administrative region.
- Text search.
- Any filter combination containing one or more of those restrictive filters.

Stay-generated morning and night anchors must never participate in ordinary Visit reordering.

In addition to up/down controls, future reordering UX should allow a Visit to:

- Move directly to position N.
- Move to the first ordinary Visit.
- Move to the last ordinary Visit.

Positioning applies only among ordinary Visits and excludes stay anchors.

### Items needing investigation or design decisions

- Define exact ordering semantics when a Trip-filtered day also contains non-Trip Visits.
- The future availability and control changes are not part of migration parity and require separate implementation scope.

## Finding 3 — Map viewport policy

### Observed current behavior/issues

- Date filters and viewport fitting passed under the application's current behavior.

### Future intended behavior

- With a Trip-only filter, fit or zoom to the landmarks belonging to that Trip.
- With a Trip plus one or more administrative-region filters, do not automatically change the current viewport.
- Clicking a specific list item should zoom to that item's location, regardless of passive filter-fit behavior.
- Do not infer or change other viewport rules yet.

### Items needing investigation or design decisions

- Other viewport policies remain intentionally unspecified.
- Implementing these rules requires separate scope from migration parity.

## Finding 4 — Village layer performance

### Observed current behavior/issues

- County, town, and village choropleth functionality worked correctly in manual testing.
- Village level is noticeably slower than county and town levels.

### Future intended behavior

- No new product behavior is specified by this finding; functional parity remains the migration requirement.

### Items needing investigation or design decisions

- Village-layer performance is a candidate for investigation and optimization after migration parity is established.

## Finding 5 — Layout control placement

### Observed current behavior/issues

- Desktop and mobile layout and collapse behavior works.
- On mobile, the layout control can overlap the map legend or list content.
- On desktop, the control is positioned too far from the main area it affects.

### Future intended behavior

- Layout controls should remain easy to reach without obscuring the legend, map content, list items, or other primary controls.
- On desktop, placement should be spatially closer to the layout areas it controls.

### Items needing investigation or design decisions

- Exact desktop and mobile placement is not decided yet.
- Placement changes require separate UX/design scope and are not migration-parity fixes.

