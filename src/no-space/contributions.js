export function normalizeRating(value){
  if (value === null || value === undefined || value === "") return null;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || Math.round(rating * 2) !== rating * 2){
    throw new Error("Rating must be 0.5 through 5 in 0.5 increments, or omitted.");
  }
  return rating;
}

// A contribution is a person's private rating + memory for one Visit. Visit
// depth ("造訪深度") is a shared Visit fact, not a contribution.
export function contributionFields(input={}){
  const rating = normalizeRating(input.rating);
  return {
    rating,
    memory:typeof input.memory === "string" ? input.memory.trim() : ""
  };
}

export function averageSubmittedRating(contributions=[]){
  const ratings = contributions.map(item => {
    try { return normalizeRating(item?.rating); } catch { return null; }
  }).filter(value => value !== null);
  if (!ratings.length) return null;
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
}

export function participantContributions(contributionsByUid={}, participantUserIds=[]){
  const allowed=new Set(Array.isArray(participantUserIds)?participantUserIds:[]);
  return Object.fromEntries(Object.entries(contributionsByUid||{}).filter(([uid])=>allowed.has(uid)));
}

export function replaceOwnContribution(contributionsByUid, uid, next){
  return { ...(contributionsByUid || {}), [uid]:contributionFields(next) };
}
