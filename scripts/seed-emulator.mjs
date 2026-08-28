#!/usr/bin/env node

/**
 * FIRESTORE EMULATOR ONLY.
 *
 * This script is deliberately hard-coded to Mapair's loopback demo emulator.
 * It must never be adapted to target production without a separately reviewed
 * design with new safety boundaries. There is no cloud fallback.
 */

import { isDeepStrictEqual } from "node:util";
import {
  BASELINE_FIXTURE_URL,
  BASELINE_SPACE_ID,
  MULTI_USER_FIXTURE_URL,
  NO_SPACE_FIXTURE_URL,
  assertFixture as assert,
  readJsonFixture,
  validateBaselineFixture,
  validateDocumentList,
  validateDocumentPath,
  validateMultiUserFixture,
  validateNoSpaceFixture
} from "./fixture-support.mjs";

const EMULATOR_ORIGIN = "http://127.0.0.1:8080";
const PROJECT_ID = "demo-mapair-local";
const DATABASE_ID = "(default)";
const FIREBASE_CONFIG_URL = new URL("../firebase.json", import.meta.url);
const REQUEST_TIMEOUT_MS = 5000;

function assertStaticSafety(){
  const endpoint = new URL(EMULATOR_ORIGIN);
  assert(endpoint.protocol === "http:", "Refusing non-HTTP emulator protocol.");
  assert(endpoint.hostname === "127.0.0.1", "Refusing emulator host other than exact 127.0.0.1.");
  assert(endpoint.port === "8080", "Refusing emulator port other than exact 8080.");
  assert(endpoint.origin === "http://127.0.0.1:8080", "Refusing unexpected emulator origin.");
  assert(PROJECT_ID === "demo-mapair-local", "Refusing project ID other than demo-mapair-local.");
  assert(BASELINE_SPACE_ID === "test-space-baseline", "Refusing baseline space ID other than test-space-baseline.");
}

function parseArguments(argv){
  if (argv.length === 0) return { fixtureName:"baseline", resetOnly:false };
  if (argv.length === 1 && argv[0] === "--reset-only") return { fixtureName:"baseline", resetOnly:true };
  if (argv.length === 2 && argv[0] === "--fixture"){
    assert(["baseline", "multi-user", "no-space"].includes(argv[1]), `Unknown fixture name: ${argv[1]}`);
    return { fixtureName:argv[1], resetOnly:false };
  }
  const unknown = argv.find(argument => !["--fixture", "--reset-only", "baseline", "multi-user", "no-space"].includes(argument));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  throw new Error("Usage: node scripts/seed-emulator.mjs [--reset-only | --fixture baseline | --fixture multi-user | --fixture no-space]");
}

async function validateFirebaseReference(){
  const config = await readJsonFixture(FIREBASE_CONFIG_URL, "firebase.json");
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

function decodeValue(value, path="$"){
  if (Object.hasOwn(value, "nullValue")) return null;
  if (Object.hasOwn(value, "stringValue")) return value.stringValue;
  if (Object.hasOwn(value, "booleanValue")) return value.booleanValue;
  if (Object.hasOwn(value, "integerValue")) return Number(value.integerValue);
  if (Object.hasOwn(value, "doubleValue")) return value.doubleValue;
  if (Object.hasOwn(value, "timestampValue")) return { __type:"firestore-timestamp", iso:new Date(value.timestampValue).toISOString() };
  if (Object.hasOwn(value, "arrayValue")) return (value.arrayValue.values || []).map((item, index) => decodeValue(item, `${path}[${index}]`));
  if (Object.hasOwn(value, "mapValue")) return decodeFields(value.mapValue.fields || {}, path);
  throw new Error(`Unsupported Firestore REST value at ${path}.`);
}

function decodeFields(fields, path="$"){
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value, `${path}.${key}`)]));
}

function firestorePath(suffix){
  assert(suffix.startsWith("/"), "Internal error: Firestore suffix must be absolute.");
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

async function writeDocument(documentPath, data){
  validateDocumentPath(documentPath);
  const response = await emulatorFetch(firestorePath(`/${documentPath}`), {
    method:"PATCH",
    body:JSON.stringify({ fields:encodeFields(data, documentPath) })
  });
  if (!response.ok) await responseError(response, `Writing ${documentPath}`);
}

async function writeDocuments(documents){
  validateDocumentList(documents, "documents selected for emulator seeding");
  for (const document of documents) await writeDocument(document.path, document.data);
}

async function getDocument(documentPath){
  validateDocumentPath(documentPath);
  return emulatorFetch(firestorePath(`/${documentPath}`), { method:"GET" });
}

async function listCollection(collectionPath){
  const segments = collectionPath.split("/");
  assert(segments.length % 2 === 1 && segments.every(segment => /^[A-Za-z0-9_-]+$/.test(segment)), `Unsafe collection path: ${collectionPath}`);
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
  assert(isDeepStrictEqual(actual, expected), `${label} verification failed: expected [${expected}], got [${actual}].`);
}

async function verifyDocument(document){
  const response = await getDocument(document.path);
  if (!response.ok) await responseError(response, `Verifying ${document.path}`);
  const stored = await response.json();
  const actualData = decodeFields(stored.fields || {}, document.path);
  assert(isDeepStrictEqual(actualData, document.data), `Stored data does not match fixture at ${document.path}.`);
}

async function verifyDocuments(documents){
  await Promise.all(documents.map(verifyDocument));
}

async function verifyReset(knownDocuments){
  const responses = await Promise.all(knownDocuments.map(document => getDocument(document.path)));
  assert(responses.every(response => response.status === 404), "Reset verification failed: a known fixture document still exists.");
  const [trips, places] = await Promise.all([
    listCollection(`spaces/${BASELINE_SPACE_ID}/trips`),
    listCollection(`spaces/${BASELINE_SPACE_ID}/places`)
  ]);
  assert(trips.length === 0, "Reset verification failed: baseline Trip documents still exist.");
  assert(places.length === 0, "Reset verification failed: baseline Place documents still exist.");
}

async function verifyBaselineSeed(fixture, documents){
  await verifyDocuments(documents);
  const [trips, places] = await Promise.all([
    listCollection(`spaces/${BASELINE_SPACE_ID}/trips`),
    listCollection(`spaces/${BASELINE_SPACE_ID}/places`)
  ]);
  assertIds(trips, fixture.trips, "Baseline Trip documents");
  assertIds(places, fixture.places, "Baseline Place documents");

  const legacyResponse = await getDocument(`spaces/${BASELINE_SPACE_ID}/places/place-test-legacy-no-created-at`);
  if (!legacyResponse.ok) await responseError(legacyResponse, "Verifying baseline legacy Place");
  const legacyDocument = await legacyResponse.json();
  assert(!Object.hasOwn(legacyDocument.fields || {}, "createdAt"), "Baseline legacy Place unexpectedly contains createdAt.");
  return { meta:1, trips:trips.length, places:places.length };
}

async function loadSelection(fixtureName){
  if (fixtureName === "no-space"){
    const noSpace=await readJsonFixture(NO_SPACE_FIXTURE_URL,"No-Space fixture");
    const validation=validateNoSpaceFixture(noSpace);
    return { fixture:noSpace, baseline:null, baselineRecords:[], additiveRecords:[], allRecords:validation.documents, noSpaceCounts:validation.counts };
  }
  const baseline = await readJsonFixture(BASELINE_FIXTURE_URL, "baseline fixture");
  const baselineRecords = validateBaselineFixture(baseline);
  if (fixtureName === "baseline") return { baseline, baselineRecords, additiveRecords:[], allRecords:baselineRecords };

  const multiUser = await readJsonFixture(MULTI_USER_FIXTURE_URL, "multi-user fixture");
  const validation = validateMultiUserFixture(multiUser, baseline);
  return {
    baseline,
    baselineRecords:validation.baselineDocuments,
    additiveRecords:validation.additiveDocuments,
    allRecords:validation.allDocuments
  };
}

async function main(){
  assertStaticSafety();
  const { fixtureName, resetOnly } = parseArguments(process.argv.slice(2));
  await validateFirebaseReference();
  const { baseline, baselineRecords, additiveRecords, allRecords, noSpaceCounts } = await loadSelection(resetOnly ? "multi-user" : fixtureName);

  await verifyReachable();
  await clearDatabase();

  if (resetOnly){
    await verifyReset(allRecords);
    console.log("Firestore Emulator reset complete; no fixtures loaded.");
    console.log(`Host: ${EMULATOR_ORIGIN} | Project: ${PROJECT_ID} | Space: ${BASELINE_SPACE_ID}`);
    return;
  }

  await writeDocuments(baselineRecords);
  if (fixtureName === "multi-user") await writeDocuments(additiveRecords);

  if (fixtureName === "no-space"){
    await writeDocuments(allRecords);
    await verifyDocuments(allRecords);
    console.log(`Firestore Emulator No-Space seed complete: ${allRecords.length} verified documents.`);
    console.log(`Fixture: no-space | Users: ${noSpaceCounts.users} | Places: ${noSpaceCounts.places} | Visits: ${noSpaceCounts.visits} | Trips: ${noSpaceCounts.trips}`);
    console.log(`Host: ${EMULATOR_ORIGIN} | Project: ${PROJECT_ID} | Top-level Visit architecture only`);
    return;
  }

  const baselineCounts = await verifyBaselineSeed(baseline, baselineRecords);
  if (fixtureName === "multi-user") await verifyDocuments(additiveRecords);

  console.log(`Firestore Emulator seed complete: ${baselineCounts.meta} baseline meta, ${baselineCounts.trips} baseline trip, ${baselineCounts.places} baseline places${fixtureName === "multi-user" ? `, ${additiveRecords.length} additive multi-user documents` : ""}.`);
  console.log(`Fixture: ${fixtureName} | Verified documents: ${allRecords.length}`);
  console.log(`Host: ${EMULATOR_ORIGIN} | Project: ${PROJECT_ID} | Space: ${BASELINE_SPACE_ID}`);
}

main().catch(error => {
  console.error(`Seed aborted: ${error.message}`);
  process.exitCode = 1;
});
