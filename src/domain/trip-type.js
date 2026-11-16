// Trip types, modelled on the expense app's scope kinds: 日常 / 國內 / 出國.
//
//   daily     日常  everyday life (also: Visits with no Trip at all)
//   domestic  國內  a trip inside Taiwan
//   overseas  出國  anything abroad (a former "abroad"/國外 value reads as this)
//
// The type is stored per user on users/{uid}.tripTypes ({ tripId: type }) — the
// shared Trip document's schema is unchanged. A Trip with no stored type is
// inferred: any Place outside Taiwan makes it 出國, otherwise 國內.

export const TRIP_TYPES = Object.freeze([
  Object.freeze({ key: "daily", label: "日常", icon: "🏠" }),
  Object.freeze({ key: "domestic", label: "國內", icon: "🚆" }),
  Object.freeze({ key: "overseas", label: "出國", icon: "✈️" })
]);
export const TRIP_TYPE_KEYS = Object.freeze(TRIP_TYPES.map((t) => t.key));
export const TRIP_TYPE_BY_KEY = Object.freeze(Object.fromEntries(TRIP_TYPES.map((t) => [t.key, t])));

export function isTripType(value) {
  return TRIP_TYPE_KEYS.includes(value);
}

const TAIWAN_NAMES = new Set(["台灣", "臺灣", "taiwan", "中華民國", "tw"]);
// Main island + Penghu, Kinmen, Matsu, Green Island / Orchid Island.
const TAIWAN_BOXES = [
  [21.85, 25.35, 119.95, 122.05],
  [23.15, 23.8, 119.3, 119.75],
  [24.35, 24.55, 118.2, 118.5],
  [25.9, 26.4, 119.85, 120.55],
  [21.9, 22.7, 121.4, 121.65]
];

/** Whether a Place lies outside Taiwan (country name first, then coordinates). */
export function isForeignPlace(place) {
  if (!place) return false;
  const country = String(place.admin?.country || "").trim().toLowerCase();
  if (country) return !TAIWAN_NAMES.has(country);
  if (place.countyCode || place.townCode) return false;
  const lat = Number(place.lat), lng = Number(place.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return !TAIWAN_BOXES.some(([s, n, w, e]) => lat >= s && lat <= n && lng >= w && lng <= e);
}

/** Stored type if valid, else 出國 when any of the Trip's Places is foreign, else 國內. */
export function resolveTripType(stored, tripPlaces = []) {
  if (stored === "abroad") return "overseas";
  if (isTripType(stored)) return stored;
  return tripPlaces.some(isForeignPlace) ? "overseas" : "domestic";
}

/**
 * Trip filter: whether a Visit passes a "type:<key>" selection. Visits with no
 * Trip count as 日常.
 */
export function tripTypePass(typeKey, visitTripId, typeOfTrip) {
  if (!visitTripId) return typeKey === "daily";
  return typeOfTrip(visitTripId) === typeKey;
}
