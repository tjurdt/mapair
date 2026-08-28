function includesUser(record, uid){
  return !!uid && Array.isArray(record?.participantUserIds) && record.participantUserIds.includes(uid);
}

export function canViewVisit(uid, visit){ return includesUser(visit, uid); }
export function canEditVisitSharedFacts(uid, visit){ return includesUser(visit, uid); }
export function canDeleteVisit(uid, visit){ return !!uid && visit?.createdBy === uid; }

export function canViewTrip(uid, trip){ return includesUser(trip, uid); }
export function canEditTripSharedFacts(uid, trip){ return includesUser(trip, uid); }
export function canDeleteTrip(uid, trip){ return !!uid && trip?.createdBy === uid; }

export function canEditContribution(uid, contributionUid){
  return !!uid && uid === contributionUid;
}

export function canReadContribution(uid, visit){
  return canViewVisit(uid, visit);
}

// Exit has intentionally not been designed. Phase A participant edits must
// keep the current User on a Visit/Trip instead of treating self-removal as Exit.
export function retainCurrentParticipant(participantUserIds, uid){
  const result = [...new Set((participantUserIds || []).filter(Boolean))];
  if (uid && !result.includes(uid)) result.unshift(uid);
  return result;
}

