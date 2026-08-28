/* ============================================================
   Space domain (Phase 3 — Personal Space + Space Switcher)

   Pure, Firebase-free policy for:
     - the deterministic Personal Space ID for a User
     - normalising a discovered (collection-group) Membership + its
       root Space document into a switcher entry
     - deciding whether a User's Personal Space must be provisioned
     - ordering Spaces for the human-facing switcher
     - the local active-Space preference (key, scoping, validation)
     - choosing the initial active Space after sign-in
     - Space session tokens that make stale async callbacks inert

   Phase 3 is LOCAL-only behind `?firebaseEnv=local&multiSpace=1`.
   Nothing here reads or writes Firestore.
   ============================================================ */

export const PERSONAL_SPACE_NAME = "我的地圖";
export const ACTIVE_SPACE_PREF_VERSION = "v1";
const SPACE_TYPES = Object.freeze(["personal", "shared"]);
const MEMBER_ROLES = Object.freeze(["owner", "member"]);

function usable(value){
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

/* ------------------------------------------------------------
   Deterministic Personal Space identity (§3).

   A path-safe, injective mapping from UID. `encodeURIComponent`
   escapes "/" and other separators; the `personal-` prefix keeps
   the ID clear of the reserved `__.*__` pattern and of the bare
   "."/".." document IDs.
   ------------------------------------------------------------ */
export function personalSpaceId(uid){
  const id = usable(uid);
  if (!id) throw new Error("personalSpaceId requires a non-empty uid");
  return `personal-${encodeURIComponent(id)}`;
}

/* ------------------------------------------------------------
   Normalise one discovered Membership + its root Space document.

   `membership` must carry its own document `id` (which must equal
   the authenticated UID). A missing or malformed root, or a
   membership that is not an explicit active owner/member, yields
   `valid: false` with structured issues — such an entry is kept
   out of the switcher and only surfaces in LOCAL diagnostics.
   ------------------------------------------------------------ */
export function normalizeDiscoveredSpace({ spaceId, membership, spaceDoc } = {}){
  const issues = [];
  const id = usable(spaceId);
  if (!id) issues.push({ code: "missing-space-id", message: "Discovered Membership has no resolvable parent Space ID." });

  const m = (membership && typeof membership === "object") ? membership : {};
  const docId = usable(m.id);
  const storedUid = usable(m.userId);
  if (!docId) issues.push({ code: "missing-membership-id", message: "Membership document ID is missing." });
  if (docId && storedUid && docId !== storedUid) issues.push({ code: "membership-id-mismatch", message: "Membership.userId does not match its document ID." });

  const role = MEMBER_ROLES.includes(m.role) ? m.role : null;
  if (!role) issues.push({ code: "invalid-role", message: "Membership.role must explicitly be owner or member.", received: usable(m.role) || null });
  const status = (m.status === "active" || m.status === "removed") ? m.status : null;
  if (status !== "active") issues.push({ code: "inactive-membership", message: "Membership.status is not active.", received: usable(m.status) || null });

  const hasRoot = !!spaceDoc && typeof spaceDoc === "object";
  const type = hasRoot && SPACE_TYPES.includes(spaceDoc.type) ? spaceDoc.type : null;
  if (!hasRoot) issues.push({ code: "missing-space-root", message: "The discovered Space has no root metadata document." });
  else if (!type) issues.push({ code: "invalid-space-type", message: "Space.type must be personal or shared.", received: usable(spaceDoc.type) || null });

  const ownerId = hasRoot ? usable(spaceDoc.ownerId) : "";
  const name = hasRoot ? usable(spaceDoc.name) : "";

  return {
    id,
    userId: docId || storedUid || "",
    role,
    status,
    type,
    ownerId: ownerId || null,
    name,
    isPersonal: type === "personal",
    hasRoot,
    valid: issues.length === 0,
    issues
  };
}

export function discoveryDiagnostics(discoveredSpaces = []){
  return (discoveredSpaces || [])
    .filter(space => space && !space.valid)
    .map(space => ({ spaceId: space.id || null, issues: space.issues || [] }));
}

/* ------------------------------------------------------------
   Personal Space provisioning decision (§3).

     reuse    — exactly one valid Personal Space owned by this User
     conflict — more than one; fail closed, never guess a canonical
     provision — none; create one at the deterministic ID
   ------------------------------------------------------------ */
export function selectValidPersonalSpaces(discoveredSpaces = [], uid = ""){
  const owner = usable(uid);
  return (discoveredSpaces || []).filter(space =>
    space && space.valid &&
    space.isPersonal && space.type === "personal" &&
    space.ownerId === owner && space.userId === owner &&
    space.role === "owner" && space.status === "active"
  );
}

export function personalSpaceResolution(discoveredSpaces = [], uid = "", deterministicId){
  const target = deterministicId || (usable(uid) ? personalSpaceId(uid) : "");
  const valid = selectValidPersonalSpaces(discoveredSpaces, uid);
  if (valid.length === 1) return { action: "reuse", spaceId: valid[0].id };
  if (valid.length > 1) return { action: "conflict", spaceIds: valid.map(space => space.id) };
  return { action: "provision", spaceId: target };
}

/* ------------------------------------------------------------
   Human switcher order (§12): the User's own Personal Space first,
   then Shared Spaces alphabetically by display name. Identical
   names stay distinct — routing always uses the Space ID, never a
   name-derived key, and raw IDs are never surfaced.
   ------------------------------------------------------------ */
export function orderSpacesForSwitcher(discoveredSpaces = [], uid = ""){
  const owner = usable(uid);
  const list = (discoveredSpaces || []).filter(space => space && space.valid);
  const isOwnPersonal = space => space.isPersonal && space.ownerId === owner;
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "") || (a.id || "").localeCompare(b.id || "");
  const personal = list.filter(isOwnPersonal).sort(byName);
  const shared = list.filter(space => !isOwnPersonal(space)).sort(byName);
  return [...personal, ...shared];
}

export function spaceTypeLabel(space){
  if (!space) return "";
  return space.isPersonal ? "私人" : "共享";
}

/* Display name for a Space with a safe non-ID fallback. */
export function spaceDisplayName(space){
  if (!space) return "地圖";
  return space.name || (space.isPersonal ? PERSONAL_SPACE_NAME : "共享地圖");
}

/* ------------------------------------------------------------
   Active-Space local preference (§10). Scoped by Firebase
   project/environment AND authenticated UID so accounts never
   share one global active Space.
   ------------------------------------------------------------ */
export function activeSpacePreferenceKey(projectId, uid){
  return `mapair.activeSpace.${ACTIVE_SPACE_PREF_VERSION}:${usable(projectId) || "unknown"}:${usable(uid) || "anon"}`;
}

export function readActiveSpacePreference(storage, projectId, uid){
  try {
    const value = storage && storage.getItem(activeSpacePreferenceKey(projectId, uid));
    return usable(value) || null;
  } catch (error){
    return null;
  }
}

export function writeActiveSpacePreference(storage, projectId, uid, spaceId){
  const value = usable(spaceId);
  if (!value) return;
  try { storage && storage.setItem(activeSpacePreferenceKey(projectId, uid), value); } catch (error){ /* storage unavailable */ }
}

export function clearActiveSpacePreference(storage, projectId, uid){
  try { storage && storage.removeItem(activeSpacePreferenceKey(projectId, uid)); } catch (error){ /* storage unavailable */ }
}

export function validateActiveSpacePreference(preferenceId, accessibleSpaceIds = []){
  const id = usable(preferenceId);
  if (!id) return null;
  return (accessibleSpaceIds || []).includes(id) ? id : null;
}

/* ------------------------------------------------------------
   Initial active-Space choice after sign-in (§9):

     A. explicit LOCAL testSpace override, if supplied AND accessible
        (an explicitly requested but inaccessible testSpace is a
        LOCAL TEST failure — never silently pick another Space)
     B. saved preference, if still accessible
     C. Personal Space
     D. otherwise: fail closed
   ------------------------------------------------------------ */
export function chooseInitialActiveSpace({
  explicitRequested = false,
  explicitTestSpaceId = null,
  savedPreferenceId = null,
  personalSpaceId: personalId = null,
  accessibleSpaceIds = []
} = {}){
  const accessible = new Set((accessibleSpaceIds || []).filter(Boolean));

  if (explicitRequested){
    const explicit = usable(explicitTestSpaceId);
    if (explicit && accessible.has(explicit)) return { spaceId: explicit, source: "explicit" };
    return { spaceId: null, source: "explicit", error: "explicit-inaccessible" };
  }

  const preference = usable(savedPreferenceId);
  if (preference && accessible.has(preference)) return { spaceId: preference, source: "preference" };

  const personal = usable(personalId);
  if (personal && accessible.has(personal)) return { spaceId: personal, source: "personal" };

  return { spaceId: null, source: "none", error: personal ? "personal-inaccessible" : "no-personal" };
}

/* ------------------------------------------------------------
   Space session tokens (§16). Every current-Space subscription and
   every Space-bound async callback captures the session that was
   current when it started; a callback whose captured session is no
   longer current must not apply its result.
   ------------------------------------------------------------ */
export function createSpaceSession(spaceId = null){
  return { spaceId: usable(spaceId) || null, version: 1 };
}

export function nextSpaceSession(previous, spaceId){
  const base = (previous && Number.isFinite(previous.version)) ? previous.version : 0;
  return { spaceId: usable(spaceId) || null, version: base + 1 };
}

export function isCurrentSpaceSession(captured, current){
  if (!captured || !current) return false;
  return captured.spaceId === current.spaceId && captured.version === current.version;
}
