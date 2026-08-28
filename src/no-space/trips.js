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

