/* ============================================================
   Participant domain (Phase 2)

   Pure, Firebase-free helpers that resolve Visit / Place
   participants for arbitrary Space Members. No dependency on
   the two-person "me / partner / both" model.

   Read precedence for a Visit (APPROVED PHASE 2 CONTRACT §1):

     A. Visit HAS OWN `participantIds` and it is a valid UID array
        -> authoritative modern value (an explicit `[]` counts and
           MUST NOT fall through to legacy `who`).
     B. `participantIds` absent -> usable legacy Visit `who`.
     C. otherwise -> Place-level compatibility fallback
        (`place.who` / `place.whoMode`, two-person legacy only).

   Malformed `participantIds` produces a structured issue, never a
   crash, and falls back to compatibility WITHOUT being silently
   normalized.
   ============================================================ */

const HISTORICAL_WHO_MODES = Object.freeze(["me", "partner", "both"]);

function isObject(value){
  return typeof value === "object" && value !== null;
}

export function isUsableUid(value){
  return typeof value === "string" && value.trim().length > 0;
}

/* A valid UID array is an array (possibly empty) whose every entry
   is a usable UID string. Used only for `participantIds`. */
export function isValidUidArray(value){
  return Array.isArray(value) && value.every(isUsableUid);
}

/* Legacy `who` is handled leniently: return the usable entries when
   at least one exists, otherwise null. */
export function usableUidArray(value){
  if (!Array.isArray(value)) return null;
  const usable = value.filter(isUsableUid);
  return usable.length ? usable : null;
}

function uniqueUids(list){
  const seen = new Set();
  const out = [];
  for (const id of list || []){
    if (!isUsableUid(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function describeValue(value){
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/* ------------------------------------------------------------
   Place-level compatibility fallback (contract §1C, §1D, §5).

   Precedence:
     A. a usable (non-empty) Place `who` array wins — the full
        arbitrary UID array, never collapsed by a stale `whoMode`.
     B. only when there is no usable `who`, interpret a genuine
        legacy `whoMode`, and only for a two-person legacy universe
        whose anchor (the Place's own `createdBy`, never the
        reader's identity) is one of the two.
     C. an explicit `who` array (including `[]`) with no meaningful
        legacy `whoMode` is an explicit selection — honour it, do
        not re-add the creator on reload.
     D. no participant data at all -> the Place's own creator, or
        nothing.
   ------------------------------------------------------------ */
export function resolvePlaceCompatParticipants(place = {}, legacyContext = {}){
  const { legacyMemberIds = [] } = legacyContext || {};
  const base = isObject(place) ? place : {};

  // A. usable `who` array — authoritative, arbitrary N members.
  const who = usableUidArray(base.who);
  if (who) return [...who];

  const anchor = isUsableUid(base.createdBy) ? base.createdBy : "";
  const universe = uniqueUids(legacyMemberIds);
  const mode = base.whoMode;

  // B. legacy `whoMode` — genuine two-person legacy universe only.
  if (universe.length === 2 && HISTORICAL_WHO_MODES.includes(mode)){
    if (mode === "both") return [...universe];
    if (anchor && universe.includes(anchor)){
      const other = universe.find(uid => uid !== anchor) || "";
      if (mode === "me") return [anchor];
      if (mode === "partner" && other) return [other];
    }
  }

  // C. explicit empty selection — no usable `who`, no meaningful whoMode.
  if (Array.isArray(base.who)) return [];

  // D. no participant data at all.
  return anchor ? [anchor] : [];
}

/* ------------------------------------------------------------
   Visit participant resolution (contract §1).
   Returns { participantIds, source, issues, rawHasParticipantIds,
   rawHasWho }.
   ------------------------------------------------------------ */
export function resolveVisitParticipants(visit = {}, place = {}, legacyContext = {}){
  const v = isObject(visit) ? visit : {};
  const issues = [];
  const rawHasParticipantIds = Object.hasOwn(v, "participantIds");
  const rawHasWho = Object.hasOwn(v, "who");

  if (rawHasParticipantIds){
    if (isValidUidArray(v.participantIds)){
      const ids = uniqueUids(v.participantIds);
      return {
        participantIds: ids,
        source: ids.length ? "visit-participant-ids" : "empty",
        issues,
        rawHasParticipantIds,
        rawHasWho
      };
    }
    issues.push({
      code: "malformed-participant-ids",
      message: "Visit.participantIds is present but is not a valid UID array.",
      received: describeValue(v.participantIds)
    });
    // fall through to compatibility, without normalizing the raw field
  }

  const who = usableUidArray(v.who);
  if (who){
    return {
      participantIds: uniqueUids(who),
      source: "visit-who",
      issues,
      rawHasParticipantIds,
      rawHasWho
    };
  }
  if (rawHasWho){
    issues.push({
      code: "unusable-visit-who",
      message: "Visit.who is present but contains no usable UID.",
      received: describeValue(v.who)
    });
  }

  const placeParticipants = resolvePlaceCompatParticipants(place, legacyContext);
  return {
    participantIds: placeParticipants,
    source: placeParticipants.length ? "place-compat" : "empty",
    issues,
    rawHasParticipantIds,
    rawHasWho
  };
}

/* ------------------------------------------------------------
   Mismatch detection (contract §2).

   Only meaningful when the Visit carries BOTH a valid
   `participantIds` array and a usable `who` array. Returns null
   when the comparison does not apply, otherwise
   { mismatch, participantIds, who }.
   ------------------------------------------------------------ */
export function detectParticipantMismatch(visit = {}){
  const v = isObject(visit) ? visit : {};
  if (!Object.hasOwn(v, "participantIds") || !Object.hasOwn(v, "who")) return null;
  if (!isValidUidArray(v.participantIds)) return null;
  const who = usableUidArray(v.who);
  if (!who) return null;

  const a = [...new Set(v.participantIds)].sort();
  const b = [...new Set(who)].sort();
  const mismatch = a.length !== b.length || a.some((value, index) => value !== b[index]);
  return {
    mismatch,
    participantIds: [...v.participantIds],
    who: [...who]
  };
}

/* ------------------------------------------------------------
   New-selection sanitisation (design: never silently re-add a
   removed Member; only active Members are eligible for new data).
   Order follows `ids`.
   ------------------------------------------------------------ */
export function sanitizeParticipantsForNewSelection(ids = [], activeMemberIds = []){
  const active = new Set((activeMemberIds || []).filter(isUsableUid));
  return uniqueUids(ids).filter(id => active.has(id));
}

/* Split a resolved participant list into the parts a picker can
   toggle (active Members) and the historical remainder (removed /
   unknown Members already on the record). Historical participants
   are preserved until explicitly removed, but are never offered as
   an unchecked candidate that can be re-added. */
export function partitionResolvedParticipants(resolvedIds = [], activeMemberIds = []){
  const active = new Set((activeMemberIds || []).filter(isUsableUid));
  const ids = uniqueUids(resolvedIds);
  return {
    activeSelected: ids.filter(id => active.has(id)),
    historical: ids.filter(id => !active.has(id))
  };
}

/* Order a working selection: active Members first (in the given
   Member order), then any retained historical participants in their
   existing order. This does NOT add or drop anyone — a historical
   participant only leaves the selection when the user removes it. */
export function orderParticipantSelection(selectedIds = [], activeMemberOrder = []){
  const ids = uniqueUids(selectedIds);
  const sel = new Set(ids);
  const active = uniqueUids(activeMemberOrder).filter(id => sel.has(id));
  const activeSet = new Set(active);
  const historical = ids.filter(id => !activeSet.has(id));
  return [...active, ...historical];
}

/* ------------------------------------------------------------
   Write payloads (contract §3).

   Explicit participant edits and new Visits write `participantIds`
   and `who` as identical arrays.
   ------------------------------------------------------------ */
export function participantWritePayload(selectedIds = []){
  const unique = uniqueUids(selectedIds);
  return { participantIds: [...unique], who: [...unique] };
}

/* Decide the participant fields to persist for a single Visit
   during a whole-array rewrite (contract §3, §8).

   - `edited`  : the user made an explicit participant selection.
   - otherwise : preserve the raw representation exactly. A Visit
     that carried neither field keeps today's behaviour of
     materialising `who` from the resolved participants, and never
     gains `participantIds`.
   ------------------------------------------------------------ */
export function nextVisitParticipantFields({ raw = {}, edited = false, selectedIds = [], resolvedIds = [] } = {}){
  if (edited){
    return participantWritePayload(selectedIds);
  }
  const source = isObject(raw) ? raw : {};
  const hasParticipantIds = Object.hasOwn(source, "participantIds");
  const hasWho = Object.hasOwn(source, "who");
  const out = {};
  if (hasParticipantIds){
    out.participantIds = Array.isArray(source.participantIds) ? [...source.participantIds] : source.participantIds;
  }
  if (hasWho){
    out.who = Array.isArray(source.who) ? [...source.who] : source.who;
  }
  if (!hasParticipantIds && !hasWho){
    out.who = [...uniqueUids(resolvedIds)];
  }
  return out;
}

/* ------------------------------------------------------------
   Legacy `whoMode` serialization (contract §4).

   Emit a historical `me` / `partner` / `both` value ONLY when the
   legacy compatibility universe is exactly two people AND the
   participant set exactly matches one historical meaning.
   Everything else serializes as "" (no invented vocabulary).
   ------------------------------------------------------------ */
export function deriveLegacyWhoMode(participantIds = [], legacyContext = {}){
  const { legacyMemberIds = [], createdBy = "" } = legacyContext || {};
  const universe = uniqueUids(legacyMemberIds);
  if (universe.length !== 2) return "";

  // `createdBy` must be an explicit, usable UID inside the two-person
  // universe. No fallback to universe[0] — an ambiguous anchor yields "".
  if (!isUsableUid(createdBy) || !universe.includes(createdBy)) return "";
  const creator = createdBy;
  const other = universe.find(uid => uid !== creator) || "";
  if (!other) return "";

  const ids = uniqueUids(participantIds);
  if (!ids.every(uid => uid === creator || uid === other)) return "";

  const set = new Set(ids);
  const hasCreator = set.has(creator);
  const hasOther = set.has(other);
  if (hasCreator && hasOther && set.size === 2) return "both";
  if (hasOther && !hasCreator && set.size === 1) return "partner";
  if (hasCreator && !hasOther && set.size === 1) return "me";
  return "";
}

/* ------------------------------------------------------------
   Display helpers.
   ------------------------------------------------------------ */
export function formatParticipantSummary(ids = [], nameOf = value => value, options = {}){
  const { max = 3, empty = "" } = options || {};
  const list = uniqueUids(ids);
  if (!list.length) return empty;
  const names = list.map(id => {
    const resolved = nameOf(id);
    return (typeof resolved === "string" && resolved.trim()) ? resolved.trim() : "Member";
  });
  if (names.length <= max) return names.join("、");
  return `${names.slice(0, max).join("、")}…共 ${names.length} 人`;
}

/* Classify a participant set for marker / legend colouring without
   assigning special meaning to exactly two people. */
export function classifyParticipants(ids = []){
  const list = uniqueUids(ids);
  if (!list.length) return { kind: "none", ids: list };
  if (list.length === 1) return { kind: "solo", ids: list };
  return { kind: "group", ids: list };
}

/* Deterministic UID -> palette index (contract §7).

   A stable FNV-1a-style string hash mapped into the palette. The
   same UID always lands on the same index regardless of how many
   other Members exist or their order; no external dependency. */
function hashUid(uid){
  const s = String(uid);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function participantColorIndex(uid, paletteSize){
  const size = Number.isInteger(paletteSize) && paletteSize > 0 ? paletteSize : 1;
  if (!isUsableUid(uid)) return 0;
  return hashUid(uid.trim()) % size;
}

export const LEGACY_WHO_MODES = HISTORICAL_WHO_MODES;
