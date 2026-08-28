export const NO_SPACE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const FORBIDDEN_CLOCK_FIELDS = Object.freeze([
  "time",
  "startTime",
  "endTime",
  "arrivalTime"
]);

const FORBIDDEN_CLOCK_FIELD_SET = new Set(FORBIDDEN_CLOCK_FIELDS);

function nonEmptyString(value){
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function assertDateOnly(value, field="date"){
  if (!NO_SPACE_DATE_PATTERN.test(value || "")){
    throw new Error(`${field} must use YYYY-MM-DD with no clock time.`);
  }
  return value;
}

export function findForbiddenClockFields(value, path="$", found=[]){
  if (Array.isArray(value)){
    value.forEach((item, index) => findForbiddenClockFields(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)){
    if (FORBIDDEN_CLOCK_FIELD_SET.has(key)) found.push(`${path}.${key}`);
    findForbiddenClockFields(child, `${path}.${key}`, found);
  }
  return found;
}

export function assertNoClockFields(value, label="No-Space data"){
  const fields = findForbiddenClockFields(value);
  if (fields.length) throw new Error(`${label} contains forbidden clock-time fields: ${fields.join(", ")}`);
  return value;
}

export function normalizeParticipantUserIds(value){
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === "string" && item.trim()).map(item => item.trim()))];
}

export function visitSharedFields(input={}){
  assertNoClockFields(input, "Visit");
  const date = assertDateOnly(input.date);
  const kind = input.kind === "stay" ? "stay" : "visit";
  const endDate = kind === "stay" ? assertDateOnly(input.endDate, "endDate") : "";
  if (kind === "stay" && endDate <= date) throw new Error("A stay endDate must follow its arrival date.");
  const participantUserIds = normalizeParticipantUserIds(input.participantUserIds);
  if (!participantUserIds.length) throw new Error("A Visit must have at least one participant.");
  return {
    placeId:nonEmptyString(input.placeId),
    ...(nonEmptyString(input.placeName) ? { placeName:nonEmptyString(input.placeName) } : {}),
    date,
    category:nonEmptyString(input.category),
    participantUserIds,
    tripId:nonEmptyString(input.tripId) || null,
    kind,
    endDate,
    createdBy:nonEmptyString(input.createdBy)
  };
}

export function tripSharedFields(input={}){
  assertNoClockFields(input, "Trip");
  const startDate = input.startDate ? assertDateOnly(input.startDate, "startDate") : "";
  const endDate = input.endDate ? assertDateOnly(input.endDate, "endDate") : "";
  if (startDate && endDate && endDate < startDate) throw new Error("Trip endDate cannot precede startDate.");
  const participantUserIds = normalizeParticipantUserIds(input.participantUserIds);
  if (!participantUserIds.length) throw new Error("A Trip must have at least one participant.");
  return {
    name:nonEmptyString(input.name),
    emoji:nonEmptyString(input.emoji),
    startDate,
    endDate,
    participantUserIds,
    createdBy:nonEmptyString(input.createdBy)
  };
}

// Only objective geographic identity is allowed on the global Place. Legacy
// subjective fields (level, rating, review) and embedded Visit arrays are
// intentionally not copied into the No-Space representation.
export function placeObjectiveFields(input={}){
  assertNoClockFields(input, "Place");
  const lat = Number(input.lat), lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Place coordinates must be finite numbers.");
  return {
    name:nonEmptyString(input.name),
    lat,
    lng,
    source:nonEmptyString(input.source) || "map",
    extId:nonEmptyString(input.extId) || null,
    admin:input.admin && typeof input.admin === "object" && !Array.isArray(input.admin) ? { ...input.admin } : {},
    ...(nonEmptyString(input.countyCode) ? { countyCode:nonEmptyString(input.countyCode) } : {}),
    ...(nonEmptyString(input.townCode) ? { townCode:nonEmptyString(input.townCode) } : {}),
    ...(nonEmptyString(input.villCode) ? { villCode:nonEmptyString(input.villCode) } : {})
  };
}

