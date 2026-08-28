function nonEmpty(value){
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function utf8Hex(value){
  return [...new TextEncoder().encode(value)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

export function externalPlaceIdentity(place={}){
  const extId=nonEmpty(place.extId);
  if(!extId) return null;
  return { provider:nonEmpty(place.source).toLowerCase()||"external", extId };
}

// Exact external identities use a deterministic, Firestore-safe document ID.
// The full UTF-8 values are encoded (not lossy-hashed), so concurrent creators
// converge on one path without exposing '/' or other path separators.
export function externalPlaceDocumentId(place={}){
  const identity=externalPlaceIdentity(place);
  if(!identity) return null;
  const id=`ext-${utf8Hex(identity.provider)}-${utf8Hex(identity.extId)}`;
  if(new TextEncoder().encode(id).length>1500) throw new Error("External Place identity is too long for a Firestore document ID.");
  return id;
}

export function selectExactExternalPlace(records=[], requested={}){
  const identity=externalPlaceIdentity(requested);
  if(!identity) return null;
  return records.filter(record=>{
    const candidate=externalPlaceIdentity(record);
    return candidate?.provider===identity.provider&&candidate.extId===identity.extId&&record?.id;
  }).sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0]||null;
}

