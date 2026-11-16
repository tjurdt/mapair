// Derived visit depth ("造訪深度") for an administrative area.
//
// Depth is no longer typed in per Visit. It is computed from what happened in
// an area (a 行政區 — county / town / village, or a foreign city):
//
//   住宿  the area holds at least one stay (a Visit with kind "stay");
//   旅遊  otherwise, 3+ distinct Places were visited there, covering at least
//         two different purposes;
//   接地  anything else that was visited.
//
// The former 居住 / 經過 depths are gone; legacy `level` values on stored
// Visits are ignored for display.

export const DEPTH_ORDER = Object.freeze(["接地", "旅遊", "住宿"]);
export const DEPTH_COLORS = Object.freeze({ 住宿: "#b25b6b", 旅遊: "#d98b3f", 接地: "#6f9c94" });

/**
 * @param {Array<{placeId:string, kind?:string, purpose?:string}>} visits
 *        the filter-passing Visits inside one area (purpose already mapped)
 * @returns {""|"接地"|"旅遊"|"住宿"}
 */
export function classifyAreaDepth(visits = []) {
  if (!visits.length) return "";
  if (visits.some((visit) => visit?.kind === "stay")) return "住宿";
  const placeIds = new Set(visits.map((visit) => visit?.placeId).filter(Boolean));
  const purposes = new Set(visits.map((visit) => visit?.purpose).filter(Boolean));
  if (placeIds.size >= 3 && purposes.size >= 2) return "旅遊";
  return "接地";
}

/**
 * The area a Place counts toward when no admin layer is chosen: its Taiwan
 * town (鄉鎮市區) when known, otherwise the reverse-geocoded country/county/
 * city, otherwise the Place itself.
 */
export function placeAreaKey(place) {
  if (!place) return "";
  if (place.townCode) return `town:${place.townCode}`;
  const admin = place.admin || {};
  const parts = [admin.country, admin.county, admin.city].filter(Boolean);
  if (parts.length) return `admin:${parts.join("|")}`;
  return `place:${place.id || ""}`;
}

/**
 * Depth for every Place, using the depth of the area it sits in.
 *
 * @param {object[]} places
 * @param {(place:object)=>Array<{placeId:string,kind?:string,purpose?:string}>} visitsOf
 *        the Place's filter-passing visits
 * @param {(place:object)=>string} [areaOf]
 * @returns {Map<string,string>} placeId -> depth
 */
export function depthByPlace(places = [], visitsOf, areaOf = placeAreaKey) {
  const byArea = new Map();
  const areaOfPlace = new Map();
  for (const place of places) {
    const visits = visitsOf(place) || [];
    if (!visits.length) continue;
    const key = areaOf(place) || `place:${place.id}`;
    areaOfPlace.set(place.id, key);
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(...visits);
  }
  const depthOfArea = new Map([...byArea].map(([key, visits]) => [key, classifyAreaDepth(visits)]));
  return new Map([...areaOfPlace].map(([placeId, key]) => [placeId, depthOfArea.get(key)]));
}
