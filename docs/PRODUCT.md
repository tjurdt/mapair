# Mapair Product

> In the v0.3 release candidate, the primary object is Visit and the production product title is “我的足跡”; Space is hidden completely. Shared experience facts, personal records, and personal day order are separated as documented in [NO_SPACE_CORE.md](NO_SPACE_CORE.md). The legacy product details below remain relevant to rollback and migration compatibility.

## Purpose

Mapair is a shared geographic memory and travel-history application. It lets a shared space record places its members have visited, repeated visits, accommodation stays, and trips. The primary experience combines a map with a filterable chronological list.

The product model is **Space → Place → Visits[]**. A Place exists only because it has real Visit history; a Trip is an optional grouping over Visits.

This document describes behavior observable in the current code. Statements marked **Inferred** describe intent suggested by that behavior rather than an explicit product specification.

## User-facing concepts

### Places

A Place is a named geographic location with coordinates that has been visited at least once. Location-level information includes visit depth, rating, shared review, source information, and administrative-region metadata.

Places can be added through Google Places autocomplete, by selecting a nearby Google place after clicking the map, or by using a clicked map coordinate as a custom location. Selecting or searching a Place always opens the editor on Visit history: an existing Place (detected by Google Place ID or by normalized name within 80 meters) gains a new Visit; a brand-new Place is created together with its first Visit. There is no "want to go" / status choice at creation time.

Deleting a Place's last remaining Visit deletes the whole Place document — an active Place is never left with zero Visits. The Place-level "刪除地點" action deletes the whole Place directly.

#### Wishlist (removed)

Earlier versions had a "想去 / wishlist" mode: a Place could be saved with no Visit and a `status:"wishlist"` marker. That feature has been removed from the product — there is no wishlist tab, no status toggle in the editor, and no wishlist participant/category pickers. Legacy `status:"wishlist"` documents that predate the removal may still exist in Firestore; they are **dormant** and are not surfaced anywhere in the normal product (list, markers, filters, statistics, administrative/proximity coverage). No production data migration is performed by this change; a separately approved migration may clean those documents up later. If a member explicitly searches for and selects such a Place and records a Visit, the existing document is reused and becomes normal Visit-bearing data.

A future "Saved Places / Favorites" concept is **not** implemented and is not the same as the removed wishlist.

### Visits

A visited Place can contain multiple Visit records. Each Visit has its own date, category or purpose, Trip association, and participants. The visited list is therefore a history of Visit occurrences rather than a unique list of Places.

When a known Place is selected, the editor opens with a new Visit based partly on the previous Visit (date from the Phase 2 new-Visit default, participants seeded from the previous Visit intersected with current active members, Trip/category from the current default). Rating, review, and visit depth remain shared at Place level.

Deleting a Visit occurrence (from the Visit list or the Visit editor) removes just that occurrence. If other Visits remain, the Place remains. If it was the last Visit, the whole Place is deleted in its originating Space and any open editor for it is closed without a further save.

### Stays

A Visit can represent accommodation. A stay records arrival and checkout dates and reports a number of nights. In a daily or Trip sequence, accommodation appears as the final stop of each occupied night and as the first stop on the following morning through checkout day.

### Trips

A Trip is a named and optionally emoji-labeled date range with a color. Visits belong to a Trip through `tripId`; Visits without one are treated as daily life. Selecting a Trip filters the visited history and enables day-and-stop sequence labels such as `D1-1`.

### People

The shared space records authenticated members and optional nicknames. Each Visit records which members participated (arbitrary N members, plus one-way-removable historical participants). Space membership determines who may edit.

In the legacy Space runtime, “我的足跡 / My Footprints” was reserved as a future cross-Space aggregate and is not the Personal Space. No-Space Phase A now uses that product title for the participant-scoped top-level Visit view, behind its separate LOCAL-only gate.

### Map and regions

The map can show Places as markers colored by category, visit depth, participants, Trip, rating, or first/last Visit date. (The old "是否去過 / status" colour mode was removed with the wishlist feature.) For a Trip or single selected day, markers can show sequence numbers.

Taiwan county, town, and village boundaries can be displayed as choropleths. Regions are colored by deepest visit level, Place count, first Visit, or last Visit, and clicking a region adds a geographic filter.

### Filtering and views

The main views are visited history (去過) and Trips (行程). Filters include date scope, Trip, participant, category, and selected administrative regions. Filtering updates the list, markers, choropleth, legend, result count, and map viewport.

When a Space has no Visit history at all, the visited view shows "這張地圖還沒有造訪紀錄。用上方搜尋或地圖上的「＋」開始記錄。" — regardless of the default month date range and regardless of any dormant legacy wishlist documents. When Visit history exists but none matches the current filter, it shows "沒有符合的造訪紀錄。".

The layout allows the map, filters, and list to be independently collapsed. On narrow screens, the map is placed above the sidebar and editors appear as bottom sheets.

## Inferred intentions

- **Inferred:** Direct GitHub Pages deployment and browser-loaded dependencies are deliberate simplicity choices for a small personal application.
- **Inferred:** The product has moved from one Visit per Place to repeated Visit history and from a two-person model to arbitrary N-member Spaces, while retaining read compatibility with older stored records (legacy `visitedOn`, `whoMode`, `status`, and dormant `status:"wishlist"` documents).

No future product features are defined by this document.
