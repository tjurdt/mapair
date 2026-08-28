const FORMAL_SOURCE = "formal";
const LEGACY_SOURCE = "legacy-meta";
const GENERIC_MEMBER_NAME = "Member";

function nonEmptyString(value){
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function memberId(record){
  return nonEmptyString(record?.userId) || nonEmptyString(record?.id);
}

export function legacyMemberNames(metaMembers={}, nicknames={}){
  const userIds = new Set([...Object.keys(metaMembers || {}), ...Object.keys(nicknames || {})]);
  return Object.fromEntries([...userIds].map(userId => [
    userId,
    nonEmptyString(nicknames?.[userId]) || nonEmptyString(metaMembers?.[userId]) || GENERIC_MEMBER_NAME
  ]));
}

export function normalizeFormalMembers(records=[], legacyNames={}){
  return records.map(record => {
    const userId = memberId(record);
    return {
      userId,
      role:nonEmptyString(record?.role) || "member",
      status:nonEmptyString(record?.status) || "active",
      displayName:nonEmptyString(record?.displayNameSnapshot) || nonEmptyString(legacyNames?.[userId]) || GENERIC_MEMBER_NAME,
      photoURL:nonEmptyString(record?.photoURLSnapshot),
      source:FORMAL_SOURCE
    };
  });
}

export function normalizeLegacyMembers(metaMembers={}, nicknames={}){
  const names = legacyMemberNames(metaMembers, nicknames);
  return Object.entries(names).map(([userId, displayName]) => ({
    userId,
    role:null,
    status:"active",
    displayName,
    photoURL:"",
    source:LEGACY_SOURCE
  }));
}

export function validateFormalSpaceOwnership(space, members=[]){
  const activeOwners = members.filter(member => member.role === "owner" && member.status === "active");
  const removedOwners = members.filter(member => member.role === "owner" && member.status === "removed");
  const issues = [];
  const ownerId = nonEmptyString(space?.ownerId);

  if (!space) issues.push({ code:"missing-space", message:"Formal Space metadata is missing." });
  else if (!ownerId) issues.push({ code:"missing-owner-id", message:"Formal Space ownerId is missing." });

  if (activeOwners.length === 0){
    if (removedOwners.length) issues.push({
      code:"removed-owner",
      message:"The formal owner Membership is removed.",
      userIds:removedOwners.map(member => member.userId)
    });
    else issues.push({ code:"zero-active-owner", message:"No active owner Membership exists." });
  } else if (activeOwners.length > 1){
    issues.push({
      code:"multiple-active-owners",
      message:"More than one active owner Membership exists.",
      userIds:activeOwners.map(member => member.userId)
    });
  }

  if (ownerId && activeOwners.length === 1 && activeOwners[0].userId !== ownerId){
    issues.push({
      code:"owner-id-mismatch",
      message:"Space.ownerId does not match the active owner Membership.",
      ownerId,
      activeOwnerId:activeOwners[0].userId
    });
  }

  return {
    valid:issues.length === 0,
    code:issues.length ? issues[0].code : "valid",
    issues,
    ownerId:ownerId || null,
    activeOwnerIds:activeOwners.map(member => member.userId),
    removedOwnerIds:removedOwners.map(member => member.userId)
  };
}

export function createMemberDirectory(members=[]){
  const byId = new Map(members.filter(member => member?.userId).map(member => [member.userId, member]));
  return {
    memberById:userId => byId.get(userId) || null,
    memberDisplayName:userId => byId.get(userId)?.displayName || GENERIC_MEMBER_NAME,
    activeSpaceMembers:() => members.filter(member => member.status === "active"),
    historicalSpaceMember:userId => byId.get(userId) || null
  };
}

export function resolveSpaceMembershipFoundation({
  spaceId,
  spaceDocument=null,
  formalMemberships=[],
  legacyMembers={},
  legacyNicknames={},
  currentUserId=""
}){
  const compatibleNames = legacyMemberNames(legacyMembers, legacyNicknames);
  const hasFormalSchema = !!spaceDocument || formalMemberships.length > 0;
  const members = hasFormalSchema
    ? normalizeFormalMembers(formalMemberships, compatibleNames)
    : normalizeLegacyMembers(legacyMembers, legacyNicknames);
  const directory = createMemberDirectory(members);
  const currentMembership = directory.memberById(currentUserId);
  const ownership = hasFormalSchema
    ? validateFormalSpaceOwnership(spaceDocument, members)
    : {
        valid:null,
        code:"legacy-not-validated",
        issues:[],
        ownerId:null,
        activeOwnerIds:[],
        removedOwnerIds:[]
      };

  return {
    currentSpace:hasFormalSchema
      ? { id:spaceId, ...spaceDocument, source:FORMAL_SOURCE }
      : { id:spaceId, name:"", type:"legacy", ownerId:null, source:LEGACY_SOURCE },
    currentMembership,
    spaceMembers:members,
    activeMembers:directory.activeSpaceMembers(),
    removedMembers:members.filter(member => member.status === "removed"),
    membershipSource:hasFormalSchema ? FORMAL_SOURCE : LEGACY_SOURCE,
    ownership,
    currentMembershipAccessible:hasFormalSchema
      ? currentMembership?.status === "active"
      : !!currentMembership,
    directory
  };
}

export const MEMBER_SOURCES = Object.freeze({
  formal:FORMAL_SOURCE,
  legacy:LEGACY_SOURCE
});
