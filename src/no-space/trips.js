import { retainCurrentParticipant } from "./policies.js";

export function visitParticipantsFromTrip(trip, currentUserId){
  return retainCurrentParticipant(trip?.participantUserIds || [], currentUserId);
}

export function applyTripDefaultsToNewVisit(visitDraft, trip, currentUserId){
  return {
    ...visitDraft,
    tripId:trip?.id || null,
    participantUserIds:visitParticipantsFromTrip(trip, currentUserId)
  };
}

export function updateTripDefaults(trip, participantUserIds, currentUserId){
  return { ...trip, participantUserIds:retainCurrentParticipant(participantUserIds, currentUserId) };
}

export function tripReferenceState(tripId, tripsById={}){
  if(!tripId) return { kind:"daily", trip:null };
  const trip=tripsById?.[tripId]||null;
  return trip?{kind:"active",trip}:{kind:"missing",trip:null};
}
