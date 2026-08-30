// One marker-colour dispatcher, shared by the Place-level and Visit-level
// paths that main.js used to implement separately (markerColor /
// markerColorForVisit) with divergent branch structure.
//
// `source` supplies the per-mode inputs for one subject (a Place or a Visit):
//
//   category()          -> string   ("" when none)
//   categoryColor(name) -> string
//   noCategoryColor     -> string
//   level()             -> string | undefined
//   levelColor(name)    -> string | undefined
//   participantColor()  -> string   (always a colour)
//   tripColor()         -> string   ("" when the subject has no coloured Trip)
//   rating()            -> number | undefined
//   ratingColor(value)  -> string
//
// A mode returns "" ("this source has no colour to offer") so the caller can
// fall through to a broader source. The composition in main.js is:
//
//   place colour  = resolveMarkerColor(mode, placeSource) || cssVisitedDefault
//   visit colour  = resolveMarkerColor(mode, visitSource) || placeColour
//
// which reproduces markerColor / markerColorForVisit exactly, including the
// early-returning modes (cat, who) that never fall through. Date modes
// (dateFirst / dateLast) are handled by the occurrence-colour path, not here;
// this returns "" for them so a stray call still yields the default.

export function resolveMarkerColor(mode, source) {
  switch (mode) {
    case "cat": {
      const category = source.category();
      return category ? source.categoryColor(category) : source.noCategoryColor;
    }
    case "level": {
      const level = source.level();
      return level ? source.levelColor(level) || "" : "";
    }
    case "who":
      return source.participantColor();
    case "trip":
      return source.tripColor() || "";
    case "rating": {
      const value = source.rating();
      return value ? source.ratingColor(value) : "";
    }
    default:
      return "";
  }
}
