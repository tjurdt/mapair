import { averageSubmittedRating } from "./contributions.js";
import { personalOrderPositions } from "./day-order.js";

export function knownParticipantUserIds(currentUserId, visits=[], trips=[]){
  const ids = new Set(currentUserId ? [currentUserId] : []);
  for (const record of [...visits, ...trips]){
    for (const uid of record?.participantUserIds || []) if (uid) ids.add(uid);
  }
  return [...ids].sort();
}

export function projectNoSpaceRuntime({
  currentUserId,
  visits=[],
  placesById={},
  contributionsByVisitId={},
  dayOrdersByDate={}
}={}){
  const positions = personalOrderPositions(dayOrdersByDate, visits);
  const grouped = {};
  for (const visit of visits){
    const objective = placesById[visit.placeId] || {};
    const contributions = contributionsByVisitId[visit.id] || {};
    if (!grouped[visit.placeId]){
      grouped[visit.placeId] = {
        id:visit.placeId,
        name:objective.name || visit.placeName || "Unknown place",
        ...objective,
        visits:[],
        _noSpace:true
      };
    }
    grouped[visit.placeId].visits.push({
      id:visit.id,
      kind:visit.kind === "stay" ? "stay" : "visit",
      date:visit.date || "",
      endDate:visit.endDate || "",
      tripId:visit.tripId || "",
      category:visit.category || "",
      participantIds:[...(visit.participantUserIds || [])],
      who:[...(visit.participantUserIds || [])],
      ...(positions.has(visit.id) ? { order:positions.get(visit.id) } : {}),
      createdBy:visit.createdBy || "",
      _shared:visit,
      _contributions:contributions,
      _averageRating:averageSubmittedRating(Object.values(contributions))
    });
  }
  for (const place of Object.values(grouped)){
    place.visits.sort((a,b)=>a.date.localeCompare(b.date)||(a.order||1e9)-(b.order||1e9)||a.id.localeCompare(b.id));
    // Existing map/list helpers are Place-oriented. Deterministically project
    // the current User's latest submitted values for marker compatibility;
    // these runtime fields are never written to the global Place document.
    const latestRating=[...place.visits].reverse().find(visit=>visit._contributions?.[currentUserId]?.rating!=null);
    const latestLevel=[...place.visits].reverse().find(visit=>visit._contributions?.[currentUserId]?.level);
    if(latestRating) place.rating=latestRating._contributions[currentUserId].rating;
    if(latestLevel) place.level=latestLevel._contributions[currentUserId].level;
  }
  return grouped;
}
