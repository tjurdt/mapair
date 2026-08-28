export function normalizeRating(value){
  if (value === null || value === undefined || value === "") return null;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || Math.round(rating * 2) !== rating * 2){
    throw new Error("Rating must be 0.5 through 5 in 0.5 increments, or omitted.");
  }
  return rating;
}

export function contributionFields(input={}){
  const rating = normalizeRating(input.rating);
  return {
    rating,
    memory:typeof input.memory === "string" ? input.memory.trim() : "",
    ...(typeof input.level === "string" && input.level.trim() ? { level:input.level.trim() } : {})
  };
}

export function averageSubmittedRating(contributions=[]){
  const ratings = contributions.map(item => {
    try { return normalizeRating(item?.rating); } catch { return null; }
  }).filter(value => value !== null);
  if (!ratings.length) return null;
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
}

export function replaceOwnContribution(contributionsByUid, uid, next){
  return { ...(contributionsByUid || {}), [uid]:contributionFields(next) };
}

