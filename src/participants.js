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
   Place-level compatibility fallback (contract §1C, §1D).

   Mirrors the historical two-person logic. `whoMode` is honoured
   only as genuinely legacy data and only within a two-person
   legacy universe (`legacyMemberIds`).
   ------------------------------------------------------------ */
export function resolvePlaceCompatParticipants(place = {}, legacyContext = {}){
  const { legacyMemberIds = [], currentUserId = "" } = legacyContext || {};
  const base = isObject(place) ? place : {};
  const creator = isUsableUid(base.createdBy)
    ? base.createdBy
    : (isUsableUid(currentUserId) ? currentUserId : "");
  const universe = uniqueUids(legacyMemberIds);
  const other = universe.find(uid => uid !== creator) || "";
  const mode = base.whoMode;

  if (mode === "both") return [creator, other].filter(Boolean);
  if (mode === "me") return [creator].filter(Boolean);
  if (mode === "partner") return [other].filter(Boolean);

  const who = usableUidArray(base.who);
  if (who) return [...who];
  return creator ? [creator] : [];
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
   toggle (active Members) and the read-only historical remainder
   (removed / unknown Members already on the record). */
export function partitionResolvedParticipants(resolvedIds = [], activeMemberIds = []){
  const active = new Set((activeMemberIds || []).filter(isUsableUid));
  const ids = uniqueUids(resolvedIds);
  return {
    activeSelected: ids.filter(id => active.has(id)),
    historical: ids.filter(id => !active.has(id))
  };
}

/* Build the effective new selection from checked active Members
   plus historical Members already attached to the record (which a
   picker cannot re-add but must not drop). Active order first. */
export function composeParticipantSelection({ checkedActiveIds = [], activeMemberOrder = [], historicalIds = [] } = {}){
  const checked = new Set(uniqueUids(checkedActiveIds));
  const ordered = uniqueUids(activeMemberOrder).filter(id => checked.has(id));
  const extraChecked = uniqueUids(checkedActiveIds).filter(id => !ordered.includes(id));
  return uniqueUids([...ordered, ...extraChecked, ...historicalIds]);
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

  const creator = isUsableUid(createdBy) && universe.includes(createdBy) ? createdBy : universe[0];
  const other = universe.find(uid => uid !== creator) || "";
  if (!creator || !other) return "";

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

export const LEGACY_WHO_MODES = HISTORICAL_WHO_MODES;
