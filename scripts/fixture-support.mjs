import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

export const BASELINE_FIXTURE_URL = new URL("../tests/fixtures/mapair-baseline.json", import.meta.url);
export const MULTI_USER_FIXTURE_URL = new URL("../tests/fixtures/mapair-multi-user.json", import.meta.url);
export const NO_SPACE_FIXTURE_URL = new URL("../tests/fixtures/mapair-no-space.json", import.meta.url);
export const BASELINE_SPACE_ID = "test-space-baseline";
export const GROUP_SPACE_ID = "test-space-group";
export const TEST_USER_IDS = ["test-user-a", "test-user-b", "test-user-c", "test-user-d"];
export const ACTIVE_GROUP_USER_IDS = ["test-user-a", "test-user-b", "test-user-c"];

const PERSONAL_SPACE_IDS = ["test-space-personal-a", "test-space-personal-b", "test-space-personal-c"];
const REQUIRED_BASELINE_TRIP_IDS = ["trip-test-multiday"];
const REQUIRED_BASELINE_PLACE_IDS = [
  "place-test-cafe",
  "place-test-dangling-trip",
  "place-test-hotel",
  "place-test-legacy-no-created-at",
  "place-test-park",
  "place-test-station",
  "place-test-wishlist"
];

export function assertFixture(condition, message){
  if (!condition) throw new Error(message);
}

function isObject(value){
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sorted(values){
  return [...values].sort();
}

function assertArrayEqual(actual, expected, message){
  assertFixture(isDeepStrictEqual(actual, expected), `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
}

function timestampIso(value, path){
  assertFixture(isObject(value), `Timestamp at ${path} must be an object.`);
  const keys = Object.keys(value).sort();
  assertArrayEqual(keys, ["__type", "iso"], `Malformed timestamp tag at ${path}`);
  assertFixture(value.__type === "firestore-timestamp", `Unknown tagged value at ${path}.`);
  assertFixture(typeof value.iso === "string", `Timestamp iso must be a string at ${path}.`);
  const date = new Date(value.iso);
  assertFixture(!Number.isNaN(date.valueOf()) && date.toISOString() === value.iso, `Invalid canonical timestamp at ${path}.`);
  return value.iso;
}

export function validateFixtureValue(value, path="$"){
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number"){
    assertFixture(Number.isFinite(value), `Non-finite number at ${path}.`);
    if (Number.isInteger(value)) assertFixture(Number.isSafeInteger(value), `Unsafe integer at ${path}.`);
    return;
  }
  if (Array.isArray(value)){
    value.forEach((item, index) => validateFixtureValue(item, `${path}[${index}]`));
    return;
  }
  assertFixture(isObject(value), `Unsupported fixture value at ${path}.`);
  if (Object.hasOwn(value, "__type")){
    timestampIso(value, path);
    return;
  }
  for (const [key, item] of Object.entries(value)){
    assertFixture(key.length > 0, `Empty field name at ${path}.`);
    validateFixtureValue(item, `${path}.${key}`);
  }
}

export function validateDocumentPath(path){
  assertFixture(typeof path === "string" && path.length > 0, "Fixture document path must be a non-empty string.");
  assertFixture(path === path.trim(), `Fixture document path has surrounding whitespace: ${path}`);
  assertFixture(!path.startsWith("/") && !path.endsWith("/"), `Fixture document path cannot have a leading or trailing slash: ${path}`);
  const segments = path.split("/");
  assertFixture(segments.length % 2 === 0, `Fixture path must identify a document: ${path}`);
  for (const segment of segments){
    assertFixture(segment.length > 0, `Fixture path has an empty segment: ${path}`);
    assertFixture(segment !== "." && segment !== "..", `Fixture path has a traversal segment: ${path}`);
    assertFixture(/^[A-Za-z0-9_-]+$/.test(segment), `Fixture path has an unsafe segment: ${path}`);
  }
  return segments;
}

export function validateDocumentList(documents, label="fixture documents"){
  assertFixture(Array.isArray(documents), `${label} must be an array.`);
  const paths = new Set();
  for (const document of documents){
    assertFixture(isObject(document), `Each entry in ${label} must be an object.`);
    validateDocumentPath(document.path);
    assertFixture(!paths.has(document.path), `Duplicate fixture document path: ${document.path}`);
    assertFixture(isObject(document.data), `Missing data object for ${document.path}.`);
    validateFixtureValue(document.data, document.path);
    paths.add(document.path);
  }
  return paths;
}

export async function readJsonFixture(url, label){
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch(error){
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

export function baselineDocuments(fixture){
  return [
    { path:`spaces/${BASELINE_SPACE_ID}/meta/config`, data:fixture.meta.config },
    ...fixture.trips.map(record => ({ path:`spaces/${BASELINE_SPACE_ID}/trips/${record.id}`, data:record.data })),
    ...fixture.places.map(record => ({ path:`spaces/${BASELINE_SPACE_ID}/places/${record.id}`, data:record.data }))
  ];
}

export function validateBaselineFixture(fixture){
  assertFixture(isObject(fixture), "Baseline fixture root must be an object.");
  assertFixture(fixture.fixtureVersion === 1, "Baseline fixtureVersion must be 1.");
  assertFixture(fixture.spaceId === BASELINE_SPACE_ID, `Refusing baseline spaceId other than ${BASELINE_SPACE_ID}.`);
  assertFixture(isObject(fixture.meta?.config), "Baseline fixture meta.config is required.");
  assertFixture(Array.isArray(fixture.trips), "Baseline fixture trips must be an array.");
  assertFixture(Array.isArray(fixture.places), "Baseline fixture places must be an array.");

  for (const [label, records] of [["Trip", fixture.trips], ["Place", fixture.places]]){
    const ids = new Set();
    for (const record of records){
      assertFixture(isObject(record), `Each baseline ${label} must be an object.`);
      assertFixture(typeof record.id === "string" && /^[A-Za-z0-9_-]+$/.test(record.id), `Invalid baseline ${label} ID.`);
      assertFixture(!ids.has(record.id), `Duplicate baseline ${label} ID: ${record.id}`);
      assertFixture(isObject(record.data), `Missing data for baseline ${label} ${record.id}.`);
      validateFixtureValue(record.data, `baseline.${label.toLowerCase()}.${record.id}`);
      ids.add(record.id);
    }
  }

  assertArrayEqual(sorted(fixture.trips.map(record => record.id)), REQUIRED_BASELINE_TRIP_IDS, "Baseline Trip IDs changed");
  assertArrayEqual(sorted(fixture.places.map(record => record.id)), REQUIRED_BASELINE_PLACE_IDS, "Baseline Place IDs changed");
  assertArrayEqual(sorted(Object.keys(fixture.meta.config.members || {})), ["test-user-a", "test-user-b"], "Baseline meta/config.members changed");
  assertArrayEqual(sorted(Object.keys(fixture.meta.config.nicknames || {})), ["test-user-a", "test-user-b"], "Baseline meta/config.nicknames changed");

  const legacy = fixture.places.find(record => record.id === "place-test-legacy-no-created-at");
  assertFixture(legacy, "Required baseline legacy Place is missing.");
  assertFixture(!Object.hasOwn(legacy.data, "createdAt"), "Baseline legacy Place must intentionally omit createdAt.");
  return baselineDocuments(fixture);
}

function assertSyntheticPath(path){
  const segments = validateDocumentPath(path);
  const [collection, documentId] = segments;
  assertFixture(["users", "spaces", "friendships", "spaceInvites"].includes(collection), `Unexpected top-level fixture collection: ${collection}`);
  assertFixture(path !== "spaces/us" && !path.startsWith("spaces/us/"), "Production-shaped spaces/us path is forbidden in repository fixtures.");
  if (collection === "users") assertFixture(/^test-user-[a-d]$/.test(documentId), `Non-synthetic User path: ${path}`);
  if (collection === "spaces"){
    assertFixture(/^test-space-(baseline|group|personal-[abc])$/.test(documentId), `Non-synthetic Space path: ${path}`);
    if (segments[2] === "members") assertFixture(/^test-user-[a-d]$/.test(segments[3]), `Non-synthetic Membership path: ${path}`);
    if (segments[2] === "trips") assertFixture(/^trip-test-/.test(segments[3]), `Non-synthetic Trip path: ${path}`);
    if (segments[2] === "places") assertFixture(/^place-test-/.test(segments[3]), `Non-synthetic Place path: ${path}`);
  }
  if (collection === "friendships") assertFixture(/^friendship-test-/.test(documentId), `Non-synthetic Friendship path: ${path}`);
  if (collection === "spaceInvites") assertFixture(/^invite-test-/.test(documentId), `Non-synthetic invitation path: ${path}`);
}

function documentMap(documents){
  return new Map(documents.map(document => [document.path, document.data]));
}

function documentsUnder(documents, predicate){
  return documents.filter(document => predicate(validateDocumentPath(document.path), document.data));
}

function requiredDocument(map, path){
  const data = map.get(path);
  assertFixture(data, `Required fixture document is missing: ${path}`);
  return data;
}

function validateUsersAndSpaces(documents, map){
  const userIds = sorted(documentsUnder(documents, segments => segments[0] === "users" && segments.length === 2).map(document => validateDocumentPath(document.path)[1]));
  assertArrayEqual(userIds, TEST_USER_IDS, "Multi-user fixture User IDs changed");

  const spaceDocuments = documentsUnder(documents, segments => segments[0] === "spaces" && segments.length === 2);
  const spaceIds = sorted(spaceDocuments.map(document => validateDocumentPath(document.path)[1]));
  assertArrayEqual(spaceIds, sorted([BASELINE_SPACE_ID, GROUP_SPACE_ID, ...PERSONAL_SPACE_IDS]), "Multi-user fixture Space IDs changed");

  const memberships = documentsUnder(documents, segments => segments[0] === "spaces" && segments.length === 4 && segments[2] === "members");
  for (const membership of memberships){
    const segments = validateDocumentPath(membership.path);
    const memberId = segments[3];
    assertFixture(membership.data.userId === memberId, `Membership document ID/userId mismatch at ${membership.path}.`);
    assertFixture(TEST_USER_IDS.includes(memberId), `Membership references unknown User at ${membership.path}.`);
    assertFixture(["owner", "member"].includes(membership.data.role), `Invalid Membership role at ${membership.path}.`);
    assertFixture(["active", "removed"].includes(membership.data.status), `Invalid Membership status at ${membership.path}.`);
  }

  for (const spaceDocument of spaceDocuments){
    const spaceId = validateDocumentPath(spaceDocument.path)[1];
    const spaceMemberships = memberships.filter(document => validateDocumentPath(document.path)[1] === spaceId);
    const activeOwners = spaceMemberships.filter(document => document.data.role === "owner" && document.data.status === "active");
    assertFixture(activeOwners.length === 1, `Space ${spaceId} must have exactly one active owner Membership.`);
    assertFixture(activeOwners[0].data.userId === spaceDocument.data.ownerId, `Space ${spaceId} ownerId does not match its active owner Membership.`);
    assertFixture(TEST_USER_IDS.includes(spaceDocument.data.ownerId), `Space ${spaceId} ownerId references an unknown User.`);
    assertFixture(spaceDocument.data.createdBy === spaceDocument.data.ownerId, `Fixture Space ${spaceId} createdBy must match its ownerId.`);
    if (spaceDocument.data.type === "personal"){
      assertFixture(spaceMemberships.length === 1, `Personal Space ${spaceId} must contain exactly one Membership document.`);
      assertFixture(spaceMemberships[0].data.status === "active" && spaceMemberships[0].data.role === "owner", `Personal Space ${spaceId} must contain one active owner.`);
    } else {
      assertFixture(spaceDocument.data.type === "shared", `Space ${spaceId} has an unsupported type.`);
    }
  }

  const baselineMembers = documentsUnder(documents, segments => segments[0] === "spaces" && segments[1] === BASELINE_SPACE_ID && segments[2] === "members");
  assertArrayEqual(sorted(baselineMembers.map(document => document.data.userId)), ["test-user-a", "test-user-b"], "Baseline formal Membership UIDs changed");
  assertFixture(requiredDocument(map, `spaces/${BASELINE_SPACE_ID}/members/test-user-a`).role === "owner", "Baseline A must be owner.");
  assertFixture(requiredDocument(map, `spaces/${BASELINE_SPACE_ID}/members/test-user-b`).role === "member", "Baseline B must be member.");
  assertFixture(baselineMembers.every(document => document.data.status === "active"), "Baseline formal Memberships must be active.");

  const expectedGroup = new Map([
    ["test-user-a", ["owner", "active"]],
    ["test-user-b", ["member", "active"]],
    ["test-user-c", ["member", "active"]],
    ["test-user-d", ["member", "removed"]]
  ]);
  for (const [userId, [role, status]] of expectedGroup){
    const membership = requiredDocument(map, `spaces/${GROUP_SPACE_ID}/members/${userId}`);
    assertFixture(membership.role === role && membership.status === status, `Unexpected group Membership for ${userId}.`);
  }
  const removedD = requiredDocument(map, `spaces/${GROUP_SPACE_ID}/members/test-user-d`);
  assertFixture(removedD.displayNameSnapshot === "測試旅人丁", "Removed group Member D must retain a display snapshot.");
  assertFixture(Object.hasOwn(removedD, "removedAt"), "Removed group Member D must retain removedAt.");
}

function allGroupVisits(documents){
  const places = documentsUnder(documents, segments => segments[0] === "spaces" && segments[1] === GROUP_SPACE_ID && segments[2] === "places");
  return places.flatMap(document => {
    assertFixture(Array.isArray(document.data.visits), `Group Place ${document.path} must have a visits array.`);
    return document.data.visits;
  });
}

function validateParticipants(documents, map){
  const trip = requiredDocument(map, `spaces/${GROUP_SPACE_ID}/trips/trip-test-group`);
  assertArrayEqual(trip.participantIds, TEST_USER_IDS, "Stored group Trip participants changed");
  const effectiveDefaults = trip.participantIds.filter(userId => ACTIVE_GROUP_USER_IDS.includes(userId));
  assertArrayEqual(effectiveDefaults, ACTIVE_GROUP_USER_IDS, "Effective active group Trip defaults changed");

  const visits = allGroupVisits(documents);
  const visitsById = new Map(visits.map(visit => [visit.id, visit]));
  assertFixture(visitsById.size === visits.length, "Group Visit IDs must be unique.");
  const legacy = requiredDocument(visitsById, "visit-test-group-legacy-who");
  assertArrayEqual(legacy.who, ["test-user-a", "test-user-b"], "Legacy who-only participants changed");
  assertFixture(!Object.hasOwn(legacy, "participantIds"), "Legacy who-only Visit must omit participantIds.");

  const modern = requiredDocument(visitsById, "visit-test-group-participant-ids");
  assertArrayEqual(modern.participantIds, ACTIVE_GROUP_USER_IDS, "participantIds-only participants changed");
  assertFixture(!Object.hasOwn(modern, "who"), "participantIds-only Visit must omit who.");

  const equal = requiredDocument(visitsById, "visit-test-group-both-equal");
  assertArrayEqual(equal.who, ["test-user-b", "test-user-c"], "Equal dual-field who changed");
  assertFixture(isDeepStrictEqual(equal.who, equal.participantIds), "Equal dual-field Visit must not have a compatibility conflict.");

  const mismatch = requiredDocument(visitsById, "visit-test-group-mismatch");
  assertArrayEqual(mismatch.who, ["test-user-a", "test-user-b"], "Mismatch Visit legacy who changed");
  assertArrayEqual(mismatch.participantIds, ["test-user-a", "test-user-c"], "Mismatch Visit participantIds changed");
  assertFixture(!isDeepStrictEqual(mismatch.who, mismatch.participantIds), "Intentional who/participantIds mismatch was normalized.");

  const historical = requiredDocument(visitsById, "visit-test-group-removed-member");
  assertArrayEqual(historical.participantIds, ["test-user-a", "test-user-d"], "Removed-member historical participants changed");

  const domainParticipants = visits.map(visit => visit.participantIds?.length ? visit.participantIds : visit.who);
  for (const expected of [ACTIVE_GROUP_USER_IDS, ["test-user-a", "test-user-b"], ["test-user-b", "test-user-c"]]){
    assertFixture(domainParticipants.some(actual => isDeepStrictEqual(actual, expected)), `Required participant combination is missing: ${JSON.stringify(expected)}`);
  }
}

function validateFriendships(documents){
  const friendships = documentsUnder(documents, segments => segments[0] === "friendships");
  assertFixture(friendships.length === 3, "Multi-user fixture must contain exactly three Friendship examples.");
  const pairs = new Set();
  const statusByPair = new Map();
  for (const friendship of friendships){
    const { userIds, requestedBy, status } = friendship.data;
    assertFixture(Array.isArray(userIds) && userIds.length === 2 && userIds[0] !== userIds[1], `Friendship must contain two distinct Users at ${friendship.path}.`);
    assertFixture(userIds.every(userId => TEST_USER_IDS.includes(userId)), `Friendship references an unknown User at ${friendship.path}.`);
    assertArrayEqual(userIds, sorted(userIds), `Friendship userIds must be canonical/sorted at ${friendship.path}`);
    assertFixture(userIds.includes(requestedBy), `Friendship requestedBy must be one of its Users at ${friendship.path}.`);
    const pair = userIds.join("|");
    assertFixture(!pairs.has(pair), `Duplicate canonical Friendship pair: ${pair}`);
    pairs.add(pair);
    statusByPair.set(pair, status);
  }
  assertFixture(statusByPair.get("test-user-a|test-user-b") === "accepted", "A/B accepted Friendship is missing.");
  assertFixture(statusByPair.get("test-user-a|test-user-c") === "pending", "A/C pending Friendship is missing.");
  assertFixture(statusByPair.get("test-user-b|test-user-d") === "blocked", "B/D blocked Friendship is missing.");
}

function validateInvitations(documents, map){
  const invitations = documentsUnder(documents, segments => segments[0] === "spaceInvites");
  assertFixture(invitations.length === 5, "Multi-user fixture must contain exactly five invitation lifecycle examples.");
  const statuses = new Set();
  let pendingDirect = false;
  let pendingLink = false;
  const forbiddenKeys = ["places", "trips", "members", "sourceInviteId", "acceptedViaInviteId"];
  for (const invitation of invitations){
    const data = invitation.data;
    assertFixture(map.has(`spaces/${data.spaceId}`), `Invitation references unknown Space at ${invitation.path}.`);
    assertFixture(TEST_USER_IDS.includes(data.createdBy), `Invitation creator is unknown at ${invitation.path}.`);
    assertFixture(data.targetUid === null || TEST_USER_IDS.includes(data.targetUid), `Invitation target is unknown at ${invitation.path}.`);
    assertFixture(data.role === "member", `Invitation role must be member at ${invitation.path}.`);
    assertFixture(["pending", "accepted", "revoked", "expired"].includes(data.status), `Invalid invitation status at ${invitation.path}.`);
    assertFixture(typeof data.spaceNameSnapshot === "string" && data.spaceNameSnapshot.length > 0, `Invitation Space snapshot is required at ${invitation.path}.`);
    assertFixture(typeof data.inviterDisplayNameSnapshot === "string" && data.inviterDisplayNameSnapshot.length > 0, `Invitation inviter snapshot is required at ${invitation.path}.`);
    assertFixture(timestampIso(data.createdAt, `${invitation.path}.createdAt`) < timestampIso(data.expiresAt, `${invitation.path}.expiresAt`), `Invitation expiration must follow creation at ${invitation.path}.`);
    assertFixture(forbiddenKeys.every(key => !Object.hasOwn(data, key)), `Invitation contains Space content or an undecided linkage field at ${invitation.path}.`);
    if (data.status === "accepted"){
      assertFixture(TEST_USER_IDS.includes(data.acceptedBy), `Accepted invitation acceptedBy is unknown at ${invitation.path}.`);
      assertFixture(Object.hasOwn(data, "acceptedAt"), `Accepted invitation must have acceptedAt at ${invitation.path}.`);
    }
    statuses.add(data.status);
    if (data.status === "pending" && data.targetUid !== null) pendingDirect = true;
    if (data.status === "pending" && data.targetUid === null) pendingLink = true;
  }
  assertFixture(pendingDirect, "Pending direct invitation example is missing.");
  assertFixture(pendingLink, "Pending share-link invitation example is missing.");
  for (const status of ["expired", "revoked", "accepted"]) assertFixture(statuses.has(status), `${status} invitation example is missing.`);
}

export function validateMultiUserFixture(fixture, baseline){
  assertFixture(isObject(fixture), "Multi-user fixture root must be an object.");
  assertFixture(fixture.fixtureVersion === 1, "Multi-user fixtureVersion must be 1.");
  assertFixture(fixture.fixtureName === "multi-user", "Multi-user fixtureName must be multi-user.");
  assertFixture(fixture.extends === "mapair-baseline", "Multi-user fixture must extend mapair-baseline.");
  validateDocumentList(fixture.documents, "multi-user fixture documents");
  fixture.documents.forEach(document => assertSyntheticPath(document.path));

  const baselineRecords = validateBaselineFixture(baseline);
  const allDocuments = [...baselineRecords, ...fixture.documents];
  validateDocumentList(allDocuments, "combined baseline and multi-user fixture documents");
  const map = documentMap(fixture.documents);
  validateUsersAndSpaces(fixture.documents, map);
  validateParticipants(fixture.documents, map);
  validateFriendships(fixture.documents);
  validateInvitations(fixture.documents, map);

  return {
    baselineDocuments:baselineRecords,
    additiveDocuments:fixture.documents,
    allDocuments,
    counts:{
      users:TEST_USER_IDS.length,
      spaces:5,
      memberships:9,
      trips:1,
      places:2,
      friendships:3,
      invitations:5
    }
  };
}

function noSpaceDocumentsUnder(documents, collection, depth){
  return documents.filter(document => {
    const segments=validateDocumentPath(document.path);
    return segments[0]===collection && segments.length===depth;
  });
}

export function validateNoSpaceFixture(fixture){
  assertFixture(isObject(fixture), "No-Space fixture root must be an object.");
  assertFixture(fixture.fixtureVersion===1, "No-Space fixtureVersion must be 1.");
  assertFixture(fixture.fixtureName==="no-space", "No-Space fixtureName must be no-space.");
  validateDocumentList(fixture.documents,"No-Space fixture documents");
  const allowedTop=new Set(["users","places","visits","trips"]);
  const forbiddenClockKeys=new Set(["time","startTime","endTime","arrivalTime"]);
  const walk=(value,path)=>{
    if(Array.isArray(value)){value.forEach((item,index)=>walk(item,`${path}[${index}]`));return;}
    if(!isObject(value)) return;
    for(const [key,child] of Object.entries(value)){
      assertFixture(!forbiddenClockKeys.has(key),`No-Space fixture contains forbidden clock field ${path}.${key}.`);
      walk(child,`${path}.${key}`);
    }
  };
  for(const document of fixture.documents){
    const segments=validateDocumentPath(document.path);
    assertFixture(allowedTop.has(segments[0]),`Unexpected No-Space top-level collection: ${segments[0]}.`);
    assertFixture(segments[0]!=="spaces",`No-Space fixture must not contain Space paths: ${document.path}.`);
    const validNested=(segments[0]==="visits"&&segments.length===4&&segments[2]==="contributions")||
      (segments[0]==="users"&&segments.length===4&&segments[2]==="dayOrders");
    assertFixture(segments.length===2||validNested,`Unexpected No-Space fixture path: ${document.path}.`);
    walk(document.data,document.path);
  }
  const users=noSpaceDocumentsUnder(fixture.documents,"users",2);
  const places=noSpaceDocumentsUnder(fixture.documents,"places",2);
  const visits=noSpaceDocumentsUnder(fixture.documents,"visits",2);
  const trips=noSpaceDocumentsUnder(fixture.documents,"trips",2);
  const contributions=fixture.documents.filter(document=>validateDocumentPath(document.path)[2]==="contributions");
  const dayOrders=fixture.documents.filter(document=>validateDocumentPath(document.path)[2]==="dayOrders");
  assertArrayEqual(sorted(users.map(document=>validateDocumentPath(document.path)[1])),["test-user-a","test-user-b","test-user-c"],"No-Space fixture Users changed");
  assertFixture(places.length>=3,"No-Space fixture requires at least three Places.");
  assertFixture(visits.length>=7,"No-Space fixture requires at least seven Visits.");
  assertFixture(trips.length>=1,"No-Space fixture requires a Trip.");
  assertFixture(visits.every(document=>Array.isArray(document.data.participantUserIds)&&document.data.participantUserIds.length),"Every No-Space Visit needs participants.");
  assertFixture(visits.every(document=>typeof document.data.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(document.data.date)),"Every No-Space Visit needs a date-only value.");
  assertFixture(places.every(document=>!["rating","review","level","visits","status"].some(key=>Object.hasOwn(document.data,key))),"No-Space Places must contain objective geography only.");
  const repeatedCounts=new Map();
  visits.forEach(document=>repeatedCounts.set(document.data.placeId,(repeatedCounts.get(document.data.placeId)||0)+1));
  assertFixture([...repeatedCounts.values()].some(count=>count>=2),"No-Space fixture requires repeated Visits to one Place.");
  assertFixture(visits.some(document=>document.data.participantUserIds.length===1&&document.data.participantUserIds[0]==="test-user-a"),"Solo A Visit is missing.");
  assertFixture(visits.some(document=>isDeepStrictEqual(document.data.participantUserIds,["test-user-a","test-user-b"])),"Shared A+B Visit is missing.");
  assertFixture(visits.some(document=>isDeepStrictEqual(document.data.participantUserIds,["test-user-a","test-user-b","test-user-c"])),"Shared A+B+C Visit is missing.");
  const trip=trips[0];
  assertArrayEqual(trip.data.participantUserIds,["test-user-a","test-user-b","test-user-c"],"No-Space Trip defaults changed");
  assertFixture(visits.some(document=>document.data.tripId===validateDocumentPath(trip.path)[1]&&isDeepStrictEqual(document.data.participantUserIds,["test-user-a","test-user-b"])),"Trip Visit overriding defaults to A+B is missing.");
  const contributionRatings=contributions.map(document=>document.data.rating).filter(value=>typeof value==="number");
  assertArrayEqual(contributionRatings,[4.5,3.5],"Submitted No-Space ratings changed");
  assertFixture(contributions.some(document=>document.data.rating===null),"Missing-rating contribution is required.");
  assertFixture(contributionRatings.reduce((sum,value)=>sum+value,0)/contributionRatings.length===4,"No-Space fixture rating average must be 4.");
  const orderMap=new Map(dayOrders.map(document=>[validateDocumentPath(document.path)[1],document.data.visitIds]));
  const sharedId="visit-test-no-space-shared-abc";
  assertFixture(orderMap.get("test-user-a")?.indexOf(sharedId)!==orderMap.get("test-user-b")?.indexOf(sharedId),"A and B must store different positions for the same Visit.");
  return { documents:fixture.documents, counts:{users:users.length,places:places.length,visits:visits.length,trips:trips.length,contributions:contributions.length,dayOrders:dayOrders.length} };
}

export async function loadAndValidateFixtures(){
  const [baseline, multiUser, noSpace] = await Promise.all([
    readJsonFixture(BASELINE_FIXTURE_URL, "baseline fixture"),
    readJsonFixture(MULTI_USER_FIXTURE_URL, "multi-user fixture"),
    readJsonFixture(NO_SPACE_FIXTURE_URL, "No-Space fixture")
  ]);
  const validation = validateMultiUserFixture(multiUser, baseline);
  const noSpaceValidation=validateNoSpaceFixture(noSpace);
  return { baseline, multiUser, noSpace, ...validation, noSpaceDocuments:noSpaceValidation.documents, noSpaceCounts:noSpaceValidation.counts };
}
