export const PROXIMITY_RADIUS_DEFAULT = 1;
export const PROXIMITY_RADIUS_MIN = 0.1;
export const PROXIMITY_RADIUS_MAX = 20;

const EARTH_RADIUS_KM = 6371.0088;

export function normalizeProximityRadius(value, fallback = PROXIMITY_RADIUS_DEFAULT) {
  const parsed = parseProximityRadius(value);
  const fallbackValue = parseProximityRadius(fallback);
  const safeFallback = fallbackValue == null ? PROXIMITY_RADIUS_DEFAULT : fallbackValue;
  if (!Number.isFinite(parsed)) return Math.max(PROXIMITY_RADIUS_MIN, Math.min(PROXIMITY_RADIUS_MAX, safeFallback));
  return Math.max(PROXIMITY_RADIUS_MIN, Math.min(PROXIMITY_RADIUS_MAX, parsed));
}

export function parseProximityRadius(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatProximityRadius(value, fallback = PROXIMITY_RADIUS_DEFAULT) {
  return String(normalizeProximityRadius(value, fallback));
}

export function readProximityPreferences(storage) {
  let radius = PROXIMITY_RADIUS_DEFAULT;
  let maskToTaiwan = true;
  try {
    radius = normalizeProximityRadius(storage?.getItem("mapair.proximity.radius"), radius);
    const storedMask = storage?.getItem("mapair.proximity.maskTaiwan");
    if (storedMask === "false") maskToTaiwan = false;
    else if (storedMask === "true") maskToTaiwan = true;
  } catch (error) {}
  return { radius, maskToTaiwan };
}

export function writeProximityPreferences(storage, { radius, maskToTaiwan }) {
  try {
    storage?.setItem("mapair.proximity.radius", formatProximityRadius(radius));
    storage?.setItem("mapair.proximity.maskTaiwan", String(maskToTaiwan !== false));
  } catch (error) {}
}

export function normalizedRegionSelections(regions = []) {
  const unique = new Map();
  for (const region of regions) {
    const key = String(region?.key || ""), code = String(region?.code || "");
    if (!key || !code) continue;
    unique.set(`${key}:${code}`, { key, code });
  }
  return [...unique.values()].sort((a, b) => a.key.localeCompare(b.key) || a.code.localeCompare(b.code));
}

export function resolveProximityMaskMode(regions = [], maskToTaiwan = true) {
  const selected = normalizedRegionSelections(regions);
  if (selected.length) {
    const selectionIdentity = selected.map(region => `${region.key}:${region.code}`).join("|");
    return { type:"regions", count:selected.length, identity:`regions:${selectionIdentity}` };
  }
  return maskToTaiwan
    ? { type:"taiwan", count:0, identity:"taiwan" }
    : { type:"none", count:0, identity:"none" };
}

export function selectRegionMaskCandidates(candidates = [], regions = []) {
  const selected = new Set(normalizedRegionSelections(regions).map(region => `${region.key}:${region.code}`));
  return candidates.filter(candidate => selected.has(`${candidate?.key || ""}:${candidate?.code || ""}`));
}

function coordinateKey(lat, lng) {
  return `${Number(lat).toFixed(8)},${Number(lng).toFixed(8)}`;
}

// A seed Place must have real Visit history — modern embedded `visits`, a legacy
// `visitedOn` date, or (compat) an explicit `status:"visited"`. Dormant legacy
// wishlist-only records never become proximity seeds.
function seedHasVisitHistory(place) {
  return !!place && (
    place.status === "visited" ||
    (Array.isArray(place.visits) && place.visits.length > 0) ||
    !!place.visitedOn
  );
}

export function selectEligibleProximitySeeds(placeSource, qualifies = () => true) {
  const values = Array.isArray(placeSource) ? placeSource : Object.values(placeSource || {});
  const candidates = values
    .filter(place => seedHasVisitHistory(place) && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)) && qualifies(place))
    .map(place => ({ id:String(place.id ?? ""), lat:Number(place.lat), lng:Number(place.lng) }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.lat - b.lat || a.lng - b.lng);
  const usedCoordinates = new Set();
  return candidates.filter(seed => {
    const key = coordinateKey(seed.lat, seed.lng);
    if (usedCoordinates.has(key)) return false;
    usedCoordinates.add(key);
    return true;
  });
}

export function haversineKm(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(Number(a[1])), lat2 = radians(Number(b[1]));
  const dLat = lat2 - lat1, dLng = radians(Number(b[0]) - Number(a[0]));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function selectNearbyPlaces(seed, placeSource, radiusKm, qualifies = () => true) {
  if (!seed || !Number.isFinite(Number(seed.lat)) || !Number.isFinite(Number(seed.lng))) return [];
  const radius = Number(radiusKm);
  if (!Number.isFinite(radius) || radius < 0) return [];
  const values = Array.isArray(placeSource) ? placeSource : Object.values(placeSource || {});
  return values.filter(place => (
    Number.isFinite(Number(place?.lat)) &&
    Number.isFinite(Number(place?.lng)) &&
    qualifies(place) &&
    haversineKm([Number(seed.lng),Number(seed.lat)],[Number(place.lng),Number(place.lat)]) <= radius
  ));
}

export function nearestSeedOwner(coordinate, seeds, radiusKm = Infinity) {
  const radius = Number(radiusKm);
  let winner = null, bestDistance = Infinity;
  for (const seed of [...(seeds || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const distance = haversineKm(coordinate, [seed.lng, seed.lat]);
    if (distance < bestDistance - 1e-9) {
      winner = seed;
      bestDistance = distance;
    }
  }
  return winner && bestDistance <= radius ? { seed:winner, distanceKm:bestDistance } : null;
}

export function bboxesOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function createMaskIndex(turfApi, features = []) {
  return features.flatMap(feature => {
    if (!feature?.geometry) return [];
    try { return [{ feature, bbox:turfApi.bbox(feature) }]; } catch (error) { return []; }
  });
}

function seedBounds(seeds, radiusKm) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const seed of seeds) {
    const latitudeMargin = radiusKm / 110.574;
    const longitudeMargin = radiusKm / Math.max(1, 111.320 * Math.cos(seed.lat * Math.PI / 180));
    west = Math.min(west, seed.lng - longitudeMargin);
    east = Math.max(east, seed.lng + longitudeMargin);
    south = Math.min(south, seed.lat - latitudeMargin);
    north = Math.max(north, seed.lat + latitudeMargin);
  }
  return [west, south, east, north];
}

function intersectPolygons(turfApi, first, second, properties) {
  try {
    return turfApi.intersect(turfApi.featureCollection([first, second]), { properties }) || null;
  } catch (error) {
    return null;
  }
}

function clipToMask(turfApi, feature, maskIndex) {
  const featureBox = turfApi.bbox(feature);
  const clipped = [];
  for (const item of maskIndex) {
    if (!bboxesOverlap(featureBox, item.bbox)) continue;
    const intersection = intersectPolygons(turfApi, feature, item.feature, feature.properties);
    if (intersection) clipped.push(intersection);
  }
  return clipped;
}

export function buildProximityFeatureCollection({ turfApi, seeds, radiusKm, maskIndex = null }) {
  if (!turfApi) throw new Error("Turf is required for proximity geometry.");
  const radius = normalizeProximityRadius(radiusKm);
  const safeSeeds = selectEligibleProximitySeeds((seeds || []).map(seed => ({ ...seed, status:"visited" })));
  if (!safeSeeds.length) return turfApi.featureCollection([]);

  const circles = new Map(safeSeeds.map(seed => [
    seed.id,
    turfApi.circle([seed.lng, seed.lat], radius, { steps:48, units:"kilometers", properties:{ seedId:seed.id } })
  ]));
  let ownedAreas;
  if (safeSeeds.length === 1) {
    ownedAreas = [circles.get(safeSeeds[0].id)];
  } else {
    const points = turfApi.featureCollection(safeSeeds.map(seed => turfApi.point(
      [seed.lng, seed.lat], { seedId:seed.id }
    )));
    const cells = turfApi.voronoi(points, { bbox:seedBounds(safeSeeds, radius) });
    ownedAreas = (cells?.features || []).flatMap(cell => {
      if (!cell?.geometry) return [];
      const fallbackOwner = nearestSeedOwner(turfApi.centroid(cell).geometry.coordinates, safeSeeds)?.seed;
      const seedId = String(cell.properties?.seedId ?? fallbackOwner?.id ?? "");
      const circle = circles.get(seedId);
      if (!circle) return [];
      const intersection = intersectPolygons(turfApi, cell, circle, { seedId });
      return intersection ? [intersection] : [];
    });
  }

  const features = maskIndex
    ? ownedAreas.flatMap(feature => clipToMask(turfApi, feature, maskIndex))
    : ownedAreas;
  return turfApi.featureCollection(features);
}

export function runProximityGeometryAssertions() {
  const assert = (condition, message) => { if (!condition) throw new Error(`Proximity assertion failed: ${message}`); };
  assert(normalizeProximityRadius("0") === 0.1, "radius minimum");
  assert(normalizeProximityRadius("99") === 20, "radius maximum");
  assert(normalizeProximityRadius("1.25") === 1.25, "radius does not round");
  assert(normalizeProximityRadius(null) === 1, "missing radius default");
  assert(formatProximityRadius(1) === "1" && formatProximityRadius(1.25) === "1.25", "natural radius formatting");

  const places = [
    { id:"wish", status:"wishlist", lat:25, lng:121 },
    { id:"filtered", status:"visited", lat:25.1, lng:121.1 },
    { id:"b", status:"visited", lat:25.2, lng:121.2 },
    { id:"a", status:"visited", lat:25.2, lng:121.2 }
  ];
  const eligible = selectEligibleProximitySeeds(places, place => place.id !== "filtered");
  assert(eligible.length === 1 && eligible[0].id === "a", "eligible Place selection and deterministic duplicate coordinates");

  const single = [{ id:"only", lat:0, lng:0 }];
  assert(nearestSeedOwner([0.005, 0], single, 1)?.seed.id === "only", "single-point inside radius");
  assert(nearestSeedOwner([0.02, 0], single, 1) === null, "single-point outside radius");
  const fakeTurf = {
    featureCollection:features => ({ type:"FeatureCollection", features }),
    circle:(coordinates, radius, options) => ({
      type:"Feature",
      properties:options.properties,
      geometry:{ type:"Polygon", coordinates:[[coordinates, coordinates, coordinates, coordinates]] }
    })
  };
  const singleGeometry = buildProximityFeatureCollection({ turfApi:fakeTurf, seeds:single, radiusKm:1 });
  assert(singleGeometry.features.length === 1 && singleGeometry.features[0].properties.seedId === "only", "single-point circle geometry");

  const pair = [{ id:"west", lat:0, lng:-0.005 }, { id:"east", lat:0, lng:0.005 }];
  assert(nearestSeedOwner([-0.001, 0], pair, 2)?.seed.id === "west", "two-point west ownership");
  assert(nearestSeedOwner([0.001, 0], pair, 2)?.seed.id === "east", "two-point east ownership");
  assert(nearestSeedOwner([0, 0], pair, 2)?.seed.id === "east", "two-point tie is deterministic");

  const memory = new Map([["mapair.proximity.radius", "2.4"], ["mapair.proximity.maskTaiwan", "false"]]);
  const storage = { getItem:key => memory.get(key) ?? null, setItem:(key, value) => memory.set(key, value) };
  const preferences = readProximityPreferences(storage);
  assert(preferences.radius === 2.4 && preferences.maskToTaiwan === false, "mask preference state");
  writeProximityPreferences(storage, { radius:1, maskToTaiwan:true });
  assert(memory.get("mapair.proximity.maskTaiwan") === "true", "mask preference persistence");
  writeProximityPreferences(storage, { radius:1.25, maskToTaiwan:true });
  assert(memory.get("mapair.proximity.radius") === "1.25", "natural radius persistence");

  const selectedRegions = [{ key:"countyCode", code:"A" }, { key:"townCode", code:"B" }];
  const selectedMode = resolveProximityMaskMode(selectedRegions, false);
  assert(selectedMode.type === "regions" && selectedMode.count === 2, "selected-region mask takes precedence");
  assert(resolveProximityMaskMode([], true).type === "taiwan", "Taiwan mask without selected regions");
  assert(resolveProximityMaskMode([], false).type === "none", "no mask without selected regions or Taiwan preference");
  const unionCandidates = selectRegionMaskCandidates([
    { key:"countyCode", code:"A", id:"first" },
    { key:"townCode", code:"B", id:"second" },
    { key:"townCode", code:"C", id:"outside" }
  ], selectedRegions);
  assert(unionCandidates.map(candidate => candidate.id).join(",") === "first,second", "multiple selected regions use OR/union semantics");
}
