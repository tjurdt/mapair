# Mapair Product

## Purpose

Mapair is a shared geographic memory and travel-history application. It lets a small shared space record places its members have visited, places they want to visit, repeated visits, accommodation stays, and trips. The primary experience combines a map with a filterable chronological list.

This document describes behavior observable in the current code. Statements marked **Inferred** describe intent suggested by that behavior rather than an explicit product specification.

## User-facing concepts

### Places

A Place is a named geographic location with coordinates. It can be marked as visited or as a wishlist item. Location-level information includes visit depth, rating, shared review, source information, and administrative-region metadata.

Places can be added through Google Places autocomplete, by selecting a nearby Google place after clicking the map, or by using a clicked map coordinate as a custom location. Existing places are detected by Google Place ID or by normalized name within 80 meters.

### Visits

A visited Place can contain multiple Visit records. Each Visit has its own date, category or purpose, Trip association, and participants. The visited list is therefore a history of Visit occurrences rather than a unique list of Places.

When a known Place is selected while viewing visited items, the editor opens with a new Visit based partly on the previous Visit. Rating, review, and visit depth remain shared at Place level.

### Stays

A Visit can represent accommodation. A stay records arrival and checkout dates and reports a number of nights. In a daily or Trip sequence, accommodation appears as the final stop of each occupied night and as the first stop on the following morning through checkout day.

### Trips

A Trip is a named and optionally emoji-labeled date range with a color. Visits belong to a Trip through `tripId`; Visits without one are treated as daily life. Selecting a Trip filters the visited history and enables day-and-stop sequence labels such as `D1-1`.

### People

The shared space records authenticated members and optional nicknames. A wishlist Place records who is expected to go. Each Visit records who participated, with UI concepts for the current user, the other member, or both together.

### Map and regions

The map can show Places as markers colored by status, category, visit depth, participants, Trip, rating, or first/last Visit date. For a Trip or single selected day, markers can show sequence numbers.

Taiwan county, town, and village boundaries can be displayed as choropleths. Regions are colored by deepest visit level, Place count, first Visit, or last Visit, and clicking a region adds a geographic filter.

### Filtering and views

The main views are visited history, wishlist, and Trips. Filters include date scope, Trip, participant, category, and selected administrative regions. Filtering updates the list, markers, choropleth, legend, result count, and map viewport.

The layout allows the map, filters, and list to be independently collapsed. On narrow screens, the map is placed above the sidebar and editors appear as bottom sheets.

## Inferred intentions

- **Inferred:** Mapair is currently intended for a private two-person shared space. The UI and participant helpers consistently model the current user plus one partner.
- **Inferred:** Direct GitHub Pages deployment and browser-loaded dependencies are deliberate simplicity choices for a small personal application.
- **Inferred:** The product is transitioning from one Visit per Place to repeated Visit history, while retaining compatibility with older stored records.

No future product features are defined by this document.
