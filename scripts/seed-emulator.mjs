#!/usr/bin/env node

/**
 * FIRESTORE EMULATOR ONLY.
 *
 * This script is deliberately hard-coded to Mapair's loopback demo emulator.
 * It must never be adapted to target production without a separately reviewed
 * design with new safety boundaries. There is no cloud fallback.
 */

import { readFile } from "node:fs/promises";

const EMULATOR_ORIGIN = "http://127.0.0.1:8080";
const PROJECT_ID = "demo-mapair-local";
const DATABASE_ID = "(default)";
const FIXTURE_SPACE_ID = "test-space-baseline";
const FIXTURE_URL = new URL("../tests/fixtures/mapair-baseline.json", import.meta.url);
const FIREBASE_CONFIG_URL = new URL("../firebase.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 5000;

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function assertStaticSafety(){
  const endpoint = new URL(EMULATOR_ORIGIN);
  assert(endpoint.protocol === "http:", "Refusing non-HTTP emulator protocol.");
  assert(endpoint.hostname === "127.0.0.1", "Refusing emulator host other than exact 127.0.0.1.");
  assert(endpoint.port === "8080", "Refusing emulator port other than exact 8080.");
  assert(endpoint.origin === "http://127.0.0.1:8080", "Refusing unexpected emulator origin.");
  assert(PROJECT_ID === "demo-mapair-local", "Refusing project ID other than demo-mapair-local.");
  assert(FIXTURE_SPACE_ID === "test-space-baseline", "Refusing space ID other than test-space-baseline.");
}

function parseArguments(argv){
  if (argv.length === 0) return { resetOnly:false };
  if (argv.length === 1 && argv[0] === "--reset-only") return { resetOnly:true };
  throw new Error("Usage: node scripts/seed-emulator.mjs [--reset-only]");
}

async function readJson(url, label){
  let value;
  try {
    value = JSON.parse(await readFile(url, "utf8"));
  } catch(error){
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
  return value;
}

function validateFixture(fixture){
  assert(fixture && typeof fixture === "object" && !Array.isArray(fixture), "Fixture root must be an object.");
  assert(fixture.spaceId === FIXTURE_SPACE_ID, `Refusing fixture spaceId other than ${FIXTURE_SPACE_ID}.`);
  assert(fixture.meta?.config && typeof fixture.meta.config === "object", "Fixture meta.config is required.");
  assert(Array.isArray(fixture.trips), "Fixture trips must be an array.");
  assert(Array.isArray(fixture.places), "Fixture places must be an array.");

  for (const [label, records] of [["trip", fixture.trips], ["place", fixture.places]]){
    const ids = new Set();
    for (const record of records){
      assert(record && typeof record === "object", `Each ${label} fixture must be an object.`);
      assert(typeof record.id === "string" && record.id.length > 0 && !record.id.includes("/"), `Invalid ${label} document ID.`);
      assert(!ids.has(record.id), `Duplicate ${label} document ID: ${record.id}`);
      assert(record.data && typeof record.data === "object" && !Array.isArray(record.data), `Missing data for ${label} ${record.id}.`);
      ids.add(record.id);
    }
  }

  const legacy = fixture.places.find(record => record.id === "place-test-legacy-no-created-at");
  assert(legacy, "Required legacy fixture is missing.");
  assert(!Object.hasOwn(legacy.data, "createdAt"), "Legacy fixture must intentionally omit createdAt.");
}

async function validateFirebaseReference(){
  const config = await readJson(FIREBASE_CONFIG_URL, "firebase.json");
  assert(config.emulators?.firestore?.port === 8080, "firebase.json Firestore emulator port must be 8080.");
}

function encodeTimestamp(value, path){
  const keys = Object.keys(value).sort();
  assert(keys.length === 2 && keys[0] === "__type" && keys[1] === "iso", `Malformed timestamp tag at ${path}.`);
  assert(typeof value.iso === "string", `Timestamp iso must be a string at ${path}.`);
  const date = new Date(value.iso);
  assert(!Number.isNaN(date.valueOf()) && date.toISOString() === value.iso, `Invalid canonical timestamp at ${path}.`);
  return { timestampValue:value.iso };
}

function encodeValue(value, path="$"){
  if (value === null) return { nullValue:null };
  if (typeof value === "string") return { stringValue:value };
  if (typeof value === "boolean") return { booleanValue:value };
  if (typeof value === "number"){
    assert(Number.isFinite(value), `Non-finite number at ${path}.`);
    if (Number.isInteger(value)){
      assert(Number.isSafeInteger(value), `Unsafe integer at ${path}.`);
      return { integerValue:String(value) };
    }
    return { doubleValue:value };
  }
  if (Array.isArray(value)) return { arrayValue:{ values:value.map((item, index) => encodeValue(item, `${path}[${index}]`)) } };
  if (value && typeof value === "object"){
    if (Object.hasOwn(value, "__type")){
      assert(value.__type === "firestore-timestamp", `Unknown tagged value at ${path}.`);
      return encodeTimestamp(value, path);
    }
    return { mapValue:{ fields:encodeFields(value, path) } };
  }
  throw new Error(`Unsupported fixture value at ${path}.`);
}

function encodeFields(object, path="$"){
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encodeValue(value, `${path}.${key}`)]));
}

function firestorePath(suffix){
  return `/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents${suffix}`;
}

async function emulatorFetch(path, options={}){
  assert(path.startsWith("/"), "Internal error: emulator path must be absolute.");
  const url = new URL(path, EMULATOR_ORIGIN);
  assert(url.origin === EMULATOR_ORIGIN, "Refusing request outside the exact Firestore Emulator origin.");

  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect:"error",
      signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers:{ "content-type":"application/json", ...(options.headers || {}) }
    });
  } catch(error){
    throw new Error(`Firestore Emulator is unavailable at ${EMULATOR_ORIGIN}: ${error.message}`);
  }
  return response;
}

async function responseError(response, action){
  const body = await response.text();
  throw new Error(`${action} failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
}

async function verifyReachable(){
  const probe = await emulatorFetch(firestorePath("/mapair_seed_probe/reachability"), { method:"GET" });
  if (probe.status !== 200 && probe.status !== 404) await responseError(probe, "Emulator reachability check");
  const body = await probe.json().catch(() => null);
  const expectedName = `projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/mapair_seed_probe/reachability`;
  const isFirestoreDocument = probe.status === 200 && body?.name === expectedName;
  const isFirestoreNotFound = probe.status === 404 && body?.error?.code === 404 && body?.error?.status === "NOT_FOUND";
  assert(isFirestoreDocument || isFirestoreNotFound, "Reachability check did not receive a Firestore REST response.");
}

async function clearDatabase(){
  const response = await emulatorFetch(`/emulator/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`, { method:"DELETE" });
  if (!response.ok) await responseError(response, "Emulator database reset");
}

async function verifyReset(){
  const [meta, trips, places] = await Promise.all([
    emulatorFetch(firestorePath(`/spaces/${FIXTURE_SPACE_ID}/meta/config`), { method:"GET" }),
    listCollection(`spaces/${FIXTURE_SPACE_ID}/trips`),
    listCollection(`spaces/${FIXTURE_SPACE_ID}/places`)
  ]);
  assert(meta.status === 404, "Reset verification failed: meta/config still exists.");
  assert(trips.length === 0, "Reset verification failed: Trip documents still exist.");
  assert(places.length === 0, "Reset verification failed: Place documents still exist.");
}

async function writeDocument(documentPath, data){
  const response = await emulatorFetch(firestorePath(`/${documentPath}`), {
    method:"PATCH",
    body:JSON.stringify({ fields:encodeFields(data) })
  });
  if (!response.ok) await responseError(response, `Writing ${documentPath}`);
}

async function listCollection(collectionPath){
  const response = await emulatorFetch(`${firestorePath(`/${collectionPath}`)}?pageSize=1000`, { method:"GET" });
  if (!response.ok) await responseError(response, `Listing ${collectionPath}`);
  const body = await response.json();
  return body.documents || [];
}

function documentIds(documents){
  return documents.map(document => document.name.split("/").at(-1)).sort();
}

function assertIds(actualDocuments, expectedRecords, label){
  const actual = documentIds(actualDocuments);
  const expected = expectedRecords.map(record => record.id).sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} verification failed: expected [${expected}], got [${actual}].`);
}

async function verifySeed(fixture){
  const metaResponse = await emulatorFetch(firestorePath(`/spaces/${FIXTURE_SPACE_ID}/meta/config`), { method:"GET" });
  if (!metaResponse.ok) await responseError(metaResponse, "Verifying meta/config");

  const [trips, places] = await Promise.all([
    listCollection(`spaces/${FIXTURE_SPACE_ID}/trips`),
    listCollection(`spaces/${FIXTURE_SPACE_ID}/places`)
  ]);
  assertIds(trips, fixture.trips, "Trip documents");
  assertIds(places, fixture.places, "Place documents");

  const legacyResponse = await emulatorFetch(firestorePath(`/spaces/${FIXTURE_SPACE_ID}/places/place-test-legacy-no-created-at`), { method:"GET" });
  if (!legacyResponse.ok) await responseError(legacyResponse, "Verifying legacy Place");
  const legacyDocument = await legacyResponse.json();
  assert(!Object.hasOwn(legacyDocument.fields || {}, "createdAt"), "Legacy Place unexpectedly contains createdAt.");

  return { meta:1, trips:trips.length, places:places.length };
}

async function seedFixture(fixture){
  await writeDocument(`spaces/${FIXTURE_SPACE_ID}/meta/config`, fixture.meta.config);
  for (const trip of fixture.trips) await writeDocument(`spaces/${FIXTURE_SPACE_ID}/trips/${trip.id}`, trip.data);
  for (const place of fixture.places) await writeDocument(`spaces/${FIXTURE_SPACE_ID}/places/${place.id}`, place.data);
}

async function main(){
  assertStaticSafety();
  const { resetOnly } = parseArguments(process.argv.slice(2));
  await validateFirebaseReference();
  const fixture = await readJson(FIXTURE_URL, "baseline fixture");
  validateFixture(fixture);

  await verifyReachable();
  await clearDatabase();

  if (resetOnly){
    await verifyReset();
    console.log("Firestore Emulator reset complete; no fixtures loaded.");
    console.log(`Host: ${EMULATOR_ORIGIN} | Project: ${PROJECT_ID} | Space: ${FIXTURE_SPACE_ID}`);
    return;
  }

  await seedFixture(fixture);
  const counts = await verifySeed(fixture);
  console.log(`Firestore Emulator seed complete: ${counts.meta} meta, ${counts.trips} trip, ${counts.places} places.`);
  console.log(`Host: ${EMULATOR_ORIGIN} | Project: ${PROJECT_ID} | Space: ${FIXTURE_SPACE_ID}`);
}

main().catch(error => {
  console.error(`Seed aborted: ${error.message}`);
  process.exitCode = 1;
});
