export function isVisitReorderAvailable({
  who = "all",
  categoryCount = 0,
  regionCount = 0,
  textSearch = "",
  tripId = "all",
  hasSpecificTrip = false
} = {}) {
  if (who !== "all" || categoryCount > 0 || regionCount > 0 || String(textSearch).trim()) return false;
  return tripId === "all" || hasSpecificTrip;
}

export function ordinaryOccurrences(occurrences) {
  return occurrences.filter(o => !o?.fixed && !o?.stayAnchor && o?.v?.kind !== "stay");
}

export function reorderWithinSlots(items, isMovable, fromIndex, toIndex) {
  const slots = [];
  const movable = [];
  items.forEach((item, index) => {
    if (!isMovable(item)) return;
    slots.push(index);
    movable.push(item);
  });
  if (fromIndex < 0 || fromIndex >= movable.length || toIndex < 0 || toIndex >= movable.length || fromIndex === toIndex) {
    return [...items];
  }
  const [moved] = movable.splice(fromIndex, 1);
  movable.splice(toIndex, 0, moved);
  const result = [...items];
  slots.forEach((slot, index) => { result[slot] = movable[index]; });
  return result;
}

export function resolveVisitMoveTarget(action, currentIndex, count) {
  if (!Number.isInteger(currentIndex) || count < 1) return -1;
  if (action === "up") return Math.max(0, currentIndex - 1);
  if (action === "down") return Math.min(count - 1, currentIndex + 1);
  if (action === "first") return 0;
  if (action === "last") return count - 1;
  const position = Number(action);
  return Number.isInteger(position) ? Math.max(0, Math.min(count - 1, position - 1)) : currentIndex;
}

export function shouldAutoFitViewport({ tripId = "all", regionCount = 0 } = {}) {
  return !(tripId !== "all" && tripId !== "daily" && regionCount > 0);
}

export function placeSharedFields(place = {}) {
  const rating = Number(place.rating);
  return {
    level: place.level || "旅遊",
    rating: Number.isFinite(rating) && rating > 0 ? rating : 0,
    review: place.review || ""
  };
}
