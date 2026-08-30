/* ============================================================
   Friends domain (Batch 1)

   Pure, Firebase-free helpers for the per-user friend address
   book stored at users/{uid}/friends/{friendUid}. A "friend" only
   makes a person selectable in the companion pickers; it never
   implies anything about a Visit or Trip. See docs/FRIENDS.md.
   ============================================================ */

const FRIEND_STATES = Object.freeze(["linked", "pending_out"]);

export function isUsableUid(value){
  return typeof value === "string" && value.trim().length > 0;
}

/* A Firestore-path-safe document id. Firebase UIDs already qualify;
   validate anyway so a pasted value can never escape the path. */
export function isPathSafeId(value){
  if (!isUsableUid(value)) return false;
  const id = value.trim();
  if (id === "." || id === ".." || id.includes("/") || id.includes("\0")) return false;
  return new TextEncoder().encode(id).length <= 1500;
}

/* Normalise one raw friend document. Unknown/absent `state`
   collapses to "linked". Returns null for an unusable id. */
export function normalizeFriendDoc(friendUid, raw = {}){
  if (!isPathSafeId(friendUid)) return null;
  const data = (raw && typeof raw === "object") ? raw : {};
  return {
    friendUid: friendUid.trim(),
    nickname: typeof data.nickname === "string" ? data.nickname.trim() : "",
    pinned: data.pinned === true,
    state: FRIEND_STATES.includes(data.state) ? data.state : "linked"
  };
}

/* Validate a UID typed into the "add friend" box. Returns
   { ok:true, friendUid } or { ok:false, reason }. */
export function validateFriendInput(rawValue, { selfUid = "", existingUids = [] } = {}){
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return { ok:false, reason:"empty" };
  if (!isPathSafeId(value)) return { ok:false, reason:"invalid" };
  if (selfUid && value === selfUid) return { ok:false, reason:"self" };
  if ((existingUids || []).includes(value)) return { ok:false, reason:"duplicate" };
  return { ok:true, friendUid:value };
}

/* Union friend UIDs into the shared-history participant directory.
   Deduped and sorted, matching knownParticipantUserIds' contract so
   callers can wrap it without reordering anything downstream. */
export function mergeFriendIdsIntoDirectory(knownIds = [], friendIds = []){
  const set = new Set();
  for (const id of [...(knownIds || []), ...(friendIds || [])]){
    if (isUsableUid(id)) set.add(id.trim());
  }
  return [...set].sort();
}

/* Companion-picker order (docs/FRIENDS.md#picker-ordering): the
   authenticated user first, then pinned friends, then everyone
   else; each group ordered by display name. Pure — does not add or
   drop anyone. */
export function orderMembersForPicker(members = [], { selfUid = "", pinnedUids = [] } = {}){
  const pinned = new Set((pinnedUids || []).filter(isUsableUid));
  const rank = member => {
    if (member.userId === selfUid) return 0;
    if (pinned.has(member.userId)) return 1;
    return 2;
  };
  return (members || []).slice().sort((a, b) =>
    rank(a) - rank(b)
    || String(a.displayName || "").localeCompare(String(b.displayName || "")));
}
