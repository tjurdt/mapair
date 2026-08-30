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

/* ------------------------------------------------------------
   Short friend codes (docs/FRIENDS.md#short-codes). A 6-char code
   over an unambiguous alphabet (no 0/O/1/I/L) that maps to a UID
   via friendCodes/{code}. Not a secret — collisions are resolved
   when the code is claimed.
   ------------------------------------------------------------ */
export const FRIEND_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const FRIEND_CODE_LENGTH = 6;

export function randomFriendCode(){
  let out = "";
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++){
    out += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)];
  }
  return out;
}

/* Strip spaces/dashes, upper-case, and accept only a well-formed
   code drawn entirely from the alphabet. Returns "" otherwise. */
export function normalizeFriendCode(value){
  const s = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== FRIEND_CODE_LENGTH) return "";
  return [...s].every(c => FRIEND_CODE_ALPHABET.includes(c)) ? s : "";
}

export function looksLikeFriendCode(value){
  return normalizeFriendCode(value) !== "";
}

export function formatFriendCode(value){
  const s = normalizeFriendCode(value);
  return s ? `${s.slice(0, 3)}-${s.slice(3)}` : "";
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
