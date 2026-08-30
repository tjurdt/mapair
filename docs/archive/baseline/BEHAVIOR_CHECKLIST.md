# Stage 0 Behavior Checklist

This migration-parity baseline reflects current code/docs. Run only with authorized non-production anonymized data; this task creates no fixtures. **Automation:** Yes = deterministic; Partial = vendor/map/browser or visual integration also required.

### Classification legend

- **INTENDED:** Current product/domain behavior that should remain stable during the migration.
- **CURRENT QUIRK:** Behavior observed in the current implementation that is preserved for migration parity only and may be fixed later in a separately scoped issue.
- **NEEDS MANUAL CONFIRMATION:** Behavior that cannot be validated confidently from code alone.

## 1. Sign-in and startup
- [ ] **INTENDED — Preconditions:** signed out, safe valid configuration. **Actions:** load, sign in, then logout; safely simulate failures. **Expected result:** connecting state → gate → full shell; initial Visited/current-month state, subscriptions, and member merge. Logout restores gate; auth uses fatal surface; map failure alerts. **Future automated testing:** Partial. **NEEDS MANUAL CONFIRMATION:** popup/error presentation.

## 2. Visited / Wishlist / Trips tabs
- [ ] **INTENDED — Preconditions:** all views populated. **Actions:** switch tabs; click Trip. **Expected result:** Visited lists Visit occurrences, Wishlist Places, Trips sort start-date descending with Visit/unique-Place counts; search hides only on Trips. Trip opens Visited, selects Trip, clears dates to All, and shows full sequence. **Automation:** Yes.

## 3. Search and adding a Place
- [ ] **INTENDED — Preconditions:** Places/Geocoding available. **Actions:** search 2+ chars; select new then existing result. **Expected result:** debounced suggestions, location/admin lookup, editor matching active tab. Visit date priority: Trip start, single day, today, or selected prior/picked-month start. Existing extId or normalized same name within 80m opens existing; Visited pre-adds Visit, Wishlist does not. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** live results/localization.
- [ ] **INTENDED — Preconditions:** map loaded. **Actions:** click with add mode off/on; choose nearby/custom. **Expected result:** off does nothing; on changes state/cursor and offers up to 8 nearby Places plus clicked-coordinate custom. Recent marker clicks are suppressed. **Automation:** Partial.

## 4. Repeated Visits
- [ ] **INTENDED — Preconditions:** Place with one Visit. **Actions:** add/reopen/delete Visits. **Expected result:** one Place owns independent occurrences; new Visit copies latest category/participants and active date/Trip context. Occurrence focuses its row. Last deletion converts to Wishlist; dated history blocks direct conversion. **Automation:** Yes.

## 5. Visit-specific category and participants
- [ ] **INTENDED — Preconditions:** two Visits/categories/members. **Actions:** assign differing values; filter. **Expected result:** category and participant display/filter per Visit; non-empty visit.who is authoritative. Current/other/together modes appear; one-member UI offers current only. **Automation:** Yes.

## 6. Shared Place-level rating/review/depth
- [ ] **INTENDED — Preconditions:** repeated Visits. **Actions:** edit via one, reopen another. **Expected result:** depth, review, and unrated or 0.5–5 rating are shared. 住宿 converts focused/latest Visit to stay, defaults next-day checkout, and uses 住宿 category only if available and empty. **Automation:** Yes.

## 7. Stay/accommodation
- [ ] **INTENDED — Preconditions:** arrival D1, checkout D3, ordinary Visits. **Actions:** inspect D1–D3 and Trip; try invalid checkout. **Expected result:** invalid checkout becomes next day. D1 ends night 1/2; D2 starts post-night 1/2 and ends night 2/2; checkout starts post-night 2/2 with no night anchor. Anchors open Visit and cannot reorder/delete. **Automation:** Yes.
- [ ] **CURRENT QUIRK — Preconditions:** known checkout. **Actions:** range starts on checkout. **Expected result:** occupied nights exclude checkout, but current intersection may include stay at checkout == from. Preserve. **Automation:** Yes.

## 8. Daily ordering/reordering
- [ ] **INTENDED — Preconditions:** 3 same-day Visits, optional anchors, 2 Wishlist Places. **Actions:** use arrows. **Expected result:** morning anchors, ordinary Visits by numeric order/missing order/Place fallback/index, night anchors. Moves rewrite consecutive ordinary orders, never anchors. Wishlist swaps Place ord with createdAt fallback. **Automation:** Yes.

## 9. Trip ordering and D1-1 labels
- [ ] **INTENDED — Preconditions:** multi-day Trip. **Actions:** select/reorder/toggle numbering; test one day. **Expected result:** headings D{day} · date; cards/markers D{day}-{position}, anchors included. Day starts at Trip start or earliest occurrence. Single day uses 1,2,3. **Automation:** Partial.

## 10. Filters
- [ ] **INTENDED — Preconditions:** dates across periods. **Actions:** current/last/picked month, today, custom, all. **Expected result:** full months and YYYY/MM chip; today equal bounds; picker/panel; All clears; Visited uses Visit/range intersection. **Automation:** Yes.
- [ ] **Preconditions:** representative matches. **Actions:** combine Trip/Daily, participant, categories, dates, regions; clear; repeat Wishlist. **Expected result:** visited passes every dimension; category/region OR internally; Daily=no tripId. Clear resets all. **CURRENT QUIRK:** Wishlist uses Place participant/category/region and ignores dates; normally Daily matches, specific Trip does not. **Automation:** Yes.

## 11. Filter-driven viewport
- [ ] **INTENDED — Preconditions:** visible map. **Actions:** filter many/one/zero; test tabs, Trips, collapsed map. **Expected result:** many fit with padding/max zoom 15; one centers zoom 14; zero unchanged. Trips/collapsed do not fit; fit follows active status tab. **Automation:** Partial.

## 12. Normal/sequence markers
- [ ] **Preconditions:** pins enabled. **Actions:** inspect/click normal then numbered. **Expected result:** **CURRENT QUIRK:** normal is one passing Place across both statuses despite tab-specific list/fit. **INTENDED:** Numbered is one per occurrence including anchors, offsets co-located labels, focuses Visit. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** overlap/click targets.

## 13. Marker color modes
- [ ] **INTENDED — Preconditions:** all metadata represented. **Actions:** test status/category/depth/who/Trip/rating/first/last. **Expected result:** configured/domain colors with status fallback; occurrence modes use Visit, shared modes Place. Rating light 1→dark 5. Dates red→purple over effective bounds, first/last occurrence, same-day light→deep. Legend matches. **Automation:** Partial.

## 14. County/town/village choropleths
- [ ] **INTENDED — Preconditions:** geo assets/codes. **Actions:** switch levels/off and depth/count/first/last/opacity/filters. **Expected result:** one Data layer; missing codes classified/cached; bad geometry ignored. Only filtered Visited contributes; missing depth=旅遊; count bins 1,2,3–4,5–9,10+; dates use matching occurrences/bounds. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** alignment/borders/village speed.

## 15. Region single/multi-selection
- [ ] **INTENDED — Preconditions:** layer active. **Actions:** click/toggle, enable 複選, remove chip, change layer. **Expected result:** switches to Visited; chips/emphasis/dimming update. Single replaces/toggles sole; multi independently ORs. Removal updates list/markers/layer/count/fit. Layer control clears selections. **Automation:** Partial.

## 16. Legends
- [ ] **INTENDED — Preconditions:** all modes. **Actions:** change modes/visibility; collapse. **Expected result:** visible if pins or layer needs it; correct combined sections/gradients; sequence explains daily or D1-1 and retained color. Collapse keeps header. **Automation:** Partial.

## 17. Settings
- [ ] **Preconditions:** categories/Trips. **Actions:** change pins, modes, opacity/metric, nickname/colors; rename/delete category. **Expected result:** display settings rerender but reset on reload. Nickname/depth/category colors persist in meta; Trip color on Trip. **CURRENT QUIRK:** Category rename/delete changes Place categories but not visits[].category. **Automation:** Partial.

## 18. Desktop layout
- [ ] **INTENDED — Preconditions:** width >760px (>700px modal). **Actions:** navigate/scroll/modals; collapse areas. **Expected result:** flexible left map, 380px scrolling sidebar; centered rounded modal; map/filter/list independently collapse and map resizes on reopen. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** visual parity/combinations.

## 19. Mobile layout/collapsible areas
- [ ] **INTENDED — Preconditions:** width ≤760px and <700px modal. **Actions:** exercise UI and every collapse combination. **Expected result:** one column, 34vh map above sidebar; bottom-sheet modal; mobile controls/greedy map. Hidden map row zero; list-hidden expands map; remaining UI reachable. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** real devices/touch/keyboard/scrolling.

## 20. Legacy compatibility
- [ ] **INTENDED — Preconditions:** future safe visitedOn-only and mixed legacy fixtures. **Actions:** list/filter/map/order/edit. **Expected result:** visitedOn normalizes one Visit with Place Trip/category/who fallback; synthetic ID replaced on save. Missing kind defaults visit unless valid endDate implies stay; category/participants fall back; numeric-string order is numeric. **Automation:** Yes.
- [ ] **Preconditions:** differing Visits; safe missing-createdAt/dangling-Trip fixtures. **Actions:** save/reorder/delete; safely delete referenced Trip. **Expected result:** **INTENDED:** latest by date/order mirrors visitedOn/tripId/categories/who/whoMode. **INTENDED:** Trip deletion does not ask for confirmation. **CURRENT QUIRK:** Trip deletion does not clean references, leaving dangling Visit tripId values. Documents lacking createdAt may be excluded by the ordered subscription. **Automation:** Partial. **NEEDS MANUAL CONFIRMATION:** live orderBy(createdAt) exclusion and malformed/dangling UI presentation.

## Areas needing manual confirmation
- Google auth/vendor localization/results, nearby search, and browser permissions.
- Marker overlap, viewport motion, boundary alignment/classification, village performance, and choropleth appearance.
- Desktop/mobile visual parity and real-device touch/keyboard/modal/collapse behavior.
- Malformed legacy shapes and live missing-createdAt query behavior.



