function timestampMillis(value){
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  if (typeof value === "string"){
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function deterministicVisitCompare(a, b){
  const created = timestampMillis(a?.createdAt) - timestampMillis(b?.createdAt);
  if (created) return created;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

export function normalizeDayOrder(date, visibleVisits=[], storedVisitIds=[]){
  const eligible = visibleVisits.filter(visit => visit?.date === date && visit?.id);
  const byId = new Map(eligible.map(visit => [visit.id, visit]));
  const seen = new Set();
  const ordered = [];
  for (const id of Array.isArray(storedVisitIds) ? storedVisitIds : []){
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  eligible.filter(visit => !seen.has(visit.id)).sort(deterministicVisitCompare).forEach(visit => ordered.push(visit.id));
  return ordered;
}

export function orderVisitsForDay(date, visibleVisits=[], storedVisitIds=[]){
  const byId = new Map(visibleVisits.map(visit => [visit.id, visit]));
  return normalizeDayOrder(date, visibleVisits, storedVisitIds).map(id => byId.get(id));
}

export function reorderDayVisitIds(currentIds, movedId, targetIndex){
  const ids = [...new Set((currentIds || []).filter(Boolean))];
  const from = ids.indexOf(movedId);
  if (from < 0) return ids;
  const [moved] = ids.splice(from, 1);
  const index = Math.max(0, Math.min(ids.length, Number(targetIndex)));
  ids.splice(index, 0, moved);
  return ids;
}

export function personalOrderPositions(dayOrdersByDate={}, visibleVisits=[]){
  const dates = [...new Set(visibleVisits.map(visit => visit?.date).filter(Boolean))];
  const positions = new Map();
  for (const date of dates){
    normalizeDayOrder(date, visibleVisits, dayOrdersByDate?.[date]?.visitIds).forEach((id, index) => positions.set(id, index + 1));
  }
  return positions;
}

