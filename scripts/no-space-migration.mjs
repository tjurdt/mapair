import { createHash } from "node:crypto";
import { isValidUidArray, isUsableUid, resolveVisitParticipants } from "../src/participants.js";
import { externalPlaceDocumentId } from "../src/no-space/places.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_FIELDS = new Set(["time", "startTime", "endTime", "arrivalTime", "departureTime"]);
export const NO_SPACE_APPLY_CONFIRMATION="MAPAIR_NO_SPACE_V1";
export const NO_SPACE_PRODUCTION_PROJECT="mapping-505208";
export const NO_SPACE_PRODUCTION_SOURCE="us";

function cleanString(value){ return typeof value === "string" ? value.trim() : ""; }
function wishlistLabel(value){ return /wishlist|想去|願望/i.test(cleanString(value)); }
function unique(values){ return [...new Set((values || []).filter(isUsableUid).map(value => value.trim()))]; }
function deterministicId(...parts){
  return `v1-${createHash("sha256").update(parts.map(value => String(value)).join("\u001f")).digest("hex").slice(0,40)}`;
}
function assertNoClockFields(value, path="legacy"){
  if (Array.isArray(value)) return value.forEach((item,index)=>assertNoClockFields(item,`${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key,child] of Object.entries(value)){
    if (CLOCK_FIELDS.has(key)) throw new Error(`${path}.${key} contains clock time, which Mapair v0.3 forbids.`);
    assertNoClockFields(child,`${path}.${key}`);
  }
}
function validDate(value){ return DATE_ONLY.test(value || "") ? value : ""; }
function sourceRows(rows=[]){
  return rows.map((row,index)=>({ id:cleanString(row?.id) || String(index), data:row?.data || row || {} }));
}
function occurrenceRows(place){
  if (Array.isArray(place.visits) && place.visits.length) return place.visits.map((data,index)=>({data,index,fallback:false}));
  return validDate(place.visitedOn) ? [{data:{
    date:place.visitedOn,
    kind:place.kind,
    endDate:place.endDate,
    tripId:place.tripId,
    category:Array.isArray(place.categories) ? place.categories[0] : "",
    order:place.ord
  },index:0,fallback:true}] : [];
}
function memberName(member){
  return cleanString(member?.displayNameSnapshot) || cleanString(member?.displayName) || cleanString(member?.name);
}
function profileMap(existingUsers={}){
  return existingUsers instanceof Map ? existingUsers : new Map(Object.entries(existingUsers || {}));
}
function objectivePlace(place){
  const out={
    name:cleanString(place.name),
    lat:Number(place.lat),
    lng:Number(place.lng),
    source:cleanString(place.source)||"map",
    extId:cleanString(place.extId)||null,
    admin:place.admin && typeof place.admin === "object" && !Array.isArray(place.admin) ? place.admin : {}
  };
  for (const key of ["countyCode","townCode","villCode","createdAt"]){ if (place[key] !== undefined && place[key] !== "") out[key]=place[key]; }
  return out;
}
function modernTripParticipants(trip){
  for (const key of ["participantUserIds","participantIds"]){
    if (Object.hasOwn(trip,key) && isValidUidArray(trip[key])) return { present:true, ids:unique(trip[key]), field:key };
  }
  return {present:false,ids:[],field:""};
}

export function convertLegacySpace({sourceSpace,meta={},places=[],trips=[],members=[],existingUsers={},importedAt="MIGRATION_TIME"}={}){
  if (!cleanString(sourceSpace)) throw new Error("sourceSpace is required.");
  assertNoClockFields({places,trips},"source");
  const documents=[];
  const warnings=[];
  const blockers=[];
  const legacyMembers=sourceRows(members);
  const legacyMemberIds=unique([
    ...legacyMembers.map(row=>cleanString(row.data.userId)||row.id),
    ...Object.keys(meta.members || {}),
    ...Object.keys(meta.nicknames || {})
  ]);
  const visits=[];
  const activePlaceIds=new Set();
  const targetPlaceSources=new Map();

  for (const {id:placeId,data:place} of sourceRows(places)){
    const occurrences=occurrenceRows(place);
    if (!occurrences.length) continue;
    const targetPlaceId=externalPlaceDocumentId(place)||placeId;
    if(targetPlaceSources.has(targetPlaceId)&&targetPlaceSources.get(targetPlaceId)!==placeId){
      blockers.push({code:"place-id-collision",placeId,message:`Places ${targetPlaceSources.get(targetPlaceId)} and ${placeId} resolve to the same target Place ${targetPlaceId}.`});
      continue;
    }
    targetPlaceSources.set(targetPlaceId,placeId);
    activePlaceIds.add(targetPlaceId);
    if (!Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))){
      blockers.push({code:"invalid-place",placeId,message:`Place ${placeId} has no finite coordinates.`});
      continue;
    }
    documents.push({path:`places/${targetPlaceId}`,data:objectivePlace(place),merge:true});
    const hasLegacySubjective=place.rating!==undefined || cleanString(place.review) || cleanString(place.level);
    if (hasLegacySubjective){
      documents.push({path:`places/${targetPlaceId}/legacyImports/space-${sourceSpace}`,data:{
        rating:place.rating ?? null,
        review:cleanString(place.review),
        level:cleanString(place.level),
        sourceSpace,
        sourcePlaceId:placeId,
        importedAt
      },merge:false});
    }
    for (const occurrence of occurrences){
      const visit=occurrence.data || {};
      const date=validDate(visit.date);
      if (!date){
        blockers.push({code:"invalid-visit-date",placeId,index:occurrence.index,message:`Place ${placeId} occurrence ${occurrence.index} has no valid date.`});
        continue;
      }
      const resolved=resolveVisitParticipants(visit,place,{legacyMemberIds});
      resolved.issues.forEach(issue=>warnings.push({...issue,placeId,index:occurrence.index}));
      const participantUserIds=unique(resolved.participantIds);
      if (!participantUserIds.length){
        blockers.push({code:"empty-visit-participants",placeId,index:occurrence.index,message:`Visit at ${placeId} on ${date} resolves to no participant.`});
        continue;
      }
      const legacyVisitKey=cleanString(visit.id) || `index-${occurrence.index}`;
      const id=deterministicId(sourceSpace,placeId,legacyVisitKey,occurrence.index);
      const legacyCreator=cleanString(visit.createdBy)||cleanString(place.createdBy);
      const createdBy=participantUserIds.includes(legacyCreator) ? legacyCreator : [...participantUserIds].sort()[0];
      const kind=visit.kind === "stay" ? "stay" : "visit";
      const endDate=kind === "stay" ? validDate(visit.endDate) : "";
      if (kind === "stay" && (!endDate || endDate <= date)){
        blockers.push({code:"invalid-stay",placeId,index:occurrence.index,message:`Stay at ${placeId} needs a checkout date after ${date}.`});
        continue;
      }
      const converted={
        id, sourceSpace, sourcePlaceId:placeId, sourceVisitKey:legacyVisitKey,
        placeId:targetPlaceId,date,kind,endDate,
        category:cleanString(visit.category)||(Array.isArray(place.categories)?cleanString(place.categories[0]):""),
        participantUserIds,
        tripId:cleanString(visit.tripId)||null,
        createdBy,
        legacyOrder:Number.isFinite(Number(visit.order))?Number(visit.order):null,
        sourceIndex:occurrence.index,
        createdAt:visit.createdAt ?? place.createdAt ?? importedAt,
        updatedAt:importedAt
      };
      visits.push(converted);
      const {legacyOrder,sourceIndex,...stored}=converted;
      documents.push({path:`visits/${id}`,data:stored,merge:false});
    }
  }

  const convertedTrips=[];
  for (const {id:tripId,data:trip} of sourceRows(trips)){
    const explicit=modernTripParticipants(trip);
    const visitUnion=unique(visits.filter(visit=>visit.tripId===tripId).flatMap(visit=>visit.participantUserIds));
    let participantUserIds=explicit.present?explicit.ids:visitUnion;
    if (!explicit.present && !participantUserIds.length && isUsableUid(trip.createdBy)) participantUserIds=[trip.createdBy.trim()];
    if (!participantUserIds.length){
      blockers.push({code:"empty-trip-participants",tripId,message:`Trip ${tripId} resolves to no companion.`});
      continue;
    }
    const legacyCreator=cleanString(trip.createdBy);
    const createdBy=participantUserIds.includes(legacyCreator)?legacyCreator:[...participantUserIds].sort()[0];
    const converted={
      name:cleanString(trip.name), emoji:cleanString(trip.emoji),
      startDate:validDate(trip.startDate), endDate:validDate(trip.endDate),
      color:/^#[0-9a-f]{6}$/i.test(cleanString(trip.color))?cleanString(trip.color):"#3f7d78",
      participantUserIds, createdBy,
      sourceSpace, sourceTripId:tripId,
      createdAt:trip.createdAt ?? importedAt, updatedAt:importedAt
    };
    convertedTrips.push({id:tripId,...converted});
    documents.push({path:`trips/${tripId}`,data:converted,merge:false});
  }

  const byUserDate=new Map();
  const visitSort=(a,b)=>a.date.localeCompare(b.date)
    || ((a.legacyOrder??Number.MAX_SAFE_INTEGER)-(b.legacyOrder??Number.MAX_SAFE_INTEGER))
    || a.sourcePlaceId.localeCompare(b.sourcePlaceId) || a.sourceIndex-b.sourceIndex || a.id.localeCompare(b.id);
  [...visits].sort(visitSort).forEach(visit=>visit.participantUserIds.forEach(uid=>{
    const key=`${uid}\u001f${visit.date}`;
    if(!byUserDate.has(key)) byUserDate.set(key,[]);
    byUserDate.get(key).push(visit.id);
  }));
  for(const [key,visitIds] of [...byUserDate].sort(([a],[b])=>a.localeCompare(b))){
    const [uid,date]=key.split("\u001f");
    documents.push({path:`users/${uid}/dayOrders/${date}`,data:{visitIds,updatedAt:importedAt},merge:false});
  }

  const referenced=unique([
    ...legacyMemberIds,
    ...sourceRows(places).map(row=>cleanString(row.data.createdBy)),
    ...sourceRows(trips).map(row=>cleanString(row.data.createdBy)),
    ...visits.flatMap(visit=>[...visit.participantUserIds,visit.createdBy]),
    ...convertedTrips.flatMap(trip=>[...trip.participantUserIds,trip.createdBy])
  ]).sort();
  const memberByUid=new Map(legacyMembers.map(row=>[cleanString(row.data.userId)||row.id,row.data]));
  const existing=profileMap(existingUsers);
  for(const uid of referenced){
    const nickname=cleanString(meta.nicknames?.[uid]);
    const metaMember=typeof meta.members?.[uid] === "string" ? cleanString(meta.members[uid]) : memberName(meta.members?.[uid]);
    const displayName=nickname || memberName(memberByUid.get(uid)) || metaMember || cleanString(existing.get(uid)?.displayName) || "旅人";
    documents.push({path:`users/${uid}`,data:{displayName,updatedAt:importedAt},merge:true});
  }

  const defaultCategories=Array.isArray(meta.categories)?meta.categories.filter(value=>cleanString(value)&&!wishlistLabel(value)):[];
  const defaultCategorySet=new Set(defaultCategories);
  const defaultCatColors=meta.catColors && typeof meta.catColors === "object"
    ? Object.fromEntries(Object.entries(meta.catColors).filter(([category])=>defaultCategorySet.has(category))) : {};
  documents.push({path:"appConfig/defaults",data:{
    categories:defaultCategories,
    catColors:defaultCatColors,
    levelColors:meta.levelColors && typeof meta.levelColors === "object" ? meta.levelColors : {},
    sourceSpace,updatedAt:importedAt
  },merge:true});

  const counts={
    places:activePlaceIds.size,
    visits:visits.length,
    trips:convertedTrips.length,
    users:referenced.length,
    dayOrders:byUserDate.size,
    legacyImports:documents.filter(item=>item.path.includes("/legacyImports/")).length
  };
  return {documents,warnings,blockers,counts,visits,trips:convertedTrips};
}

export function migrationDocumentIds(result){
  return result.documents.map(item=>item.path).sort();
}

export function validateMigrationOptions(options={},emulatorHost=""){
  if(!options.apply) return {mode:"dry-run"};
  if(options.project!==NO_SPACE_PRODUCTION_PROJECT||options.source_space!==NO_SPACE_PRODUCTION_SOURCE){
    throw new Error("Apply is locked to project mapping-505208 and source Space us.");
  }
  if(options.confirm!==NO_SPACE_APPLY_CONFIRMATION){
    throw new Error(`Apply requires --confirm ${NO_SPACE_APPLY_CONFIRMATION}.`);
  }
  if(emulatorHost) throw new Error("Production apply refuses to run while FIRESTORE_EMULATOR_HOST is set.");
  return {mode:"apply"};
}
