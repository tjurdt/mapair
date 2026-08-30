#!/usr/bin/env node
// Destructive: permanently deletes every No-Space runtime document
// (top-level `visits`, `places`, `trips`, and — with --include-day-orders —
// `users/{uid}/dayOrders`) after writing a verified local backup.
//
// It never touches `spaces/{spaceId}` (the migration source), `appConfig`,
// `migrations`, or `users/{uid}` profile documents.
//
// Dry run (default, no writes):
//   node scripts/wipe-no-space-v1.mjs --project mapping-505208
//
// Apply against production:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json \
//   node scripts/wipe-no-space-v1.mjs --project mapping-505208 \
//     --apply --confirm WIPE_NO_SPACE_V1
//
// Apply against a local emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//   node scripts/wipe-no-space-v1.mjs --project demo-mapair-local \
//     --apply --confirm WIPE_NO_SPACE_V1
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY_CONFIRMATION = "WIPE_NO_SPACE_V1";
const PRODUCTION_PROJECT = "mapping-505208";
const WIPE_COLLECTIONS = ["visits", "places", "trips"];

function parseArgs(argv) {
  const options = { apply: false, confirm: "", project: "", uid: "", includeDayOrders: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") { options.apply = true; continue; }
    if (arg === "--include-day-orders") { options.includeDayOrders = true; continue; }
    if (["--project", "--confirm", "--uid"].includes(arg)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.project) {
    throw new Error("Usage: node scripts/wipe-no-space-v1.mjs --project PROJECT [--apply --confirm WIPE_NO_SPACE_V1] [--include-day-orders --uid UID]");
  }
  if (options.includeDayOrders && !options.uid) throw new Error("--include-day-orders requires --uid UID.");
  return options;
}

function validateOptions(options, emulatorHost) {
  if (!options.apply) return;
  if (options.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`Apply requires --confirm ${APPLY_CONFIRMATION}.`);
  }
  if (!emulatorHost && options.project !== PRODUCTION_PROJECT) {
    throw new Error(`Apply against a non-emulator project is locked to ${PRODUCTION_PROJECT}. Set FIRESTORE_EMULATOR_HOST for local wipes.`);
  }
}

function jsonValue(_key, value) {
  if (value && typeof value.toDate === "function") return { __type: "firestore-timestamp", iso: value.toDate().toISOString() };
  if (value && typeof value === "object" && typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { __type: "firestore-geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  return value;
}

// Depth-first dump of every document at or below a collection, including
// arbitrarily nested subcollections.
async function dumpCollection(collectionRef, sink) {
  const snapshot = await collectionRef.get();
  for (const doc of snapshot.docs) {
    sink.push({ path: doc.ref.path, data: doc.data() });
    for (const sub of await doc.ref.listCollections()) {
      await dumpCollection(sub, sink);
    }
  }
}

async function collectTargets(db, options) {
  const documents = [];
  for (const name of WIPE_COLLECTIONS) {
    await dumpCollection(db.collection(name), documents);
  }
  if (options.includeDayOrders) {
    await dumpCollection(db.collection(`users/${options.uid}/dayOrders`), documents);
  }
  return documents.sort((a, b) => a.path.localeCompare(b.path));
}

async function createVerifiedBackup(project, documents) {
  const directory = resolve("migration-backups");
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(directory, `wipe-no-space-v1-${project}-${stamp}.json`);
  const payload = {
    version: 1,
    project,
    createdAt: new Date().toISOString(),
    documentCount: documents.length,
    documents: documents.map(item => ({ path: item.path, exists: true, data: item.data }))
  };
  const bytes = JSON.stringify(payload, jsonValue, 2) + "\n";
  await writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
  const readBack = await readFile(path, "utf8");
  const verified = JSON.parse(readBack);
  if (verified.documents.length !== documents.length) throw new Error("Backup verification failed: document count differs.");
  const expected = documents.map(item => item.path).join("\n");
  const actual = verified.documents.map(item => item.path).join("\n");
  if (expected !== actual || createHash("sha256").update(readBack).digest("hex") !== createHash("sha256").update(bytes).digest("hex")) {
    throw new Error("Backup verification failed: content differs after write.");
  }
  return path;
}

async function deleteTargets(db, options) {
  for (const name of WIPE_COLLECTIONS) {
    await db.recursiveDelete(db.collection(name));
  }
  if (options.includeDayOrders) {
    await db.recursiveDelete(db.collection(`users/${options.uid}/dayOrders`));
  }
}

function summarize(documents) {
  const counts = {};
  for (const item of documents) {
    const top = item.path.split("/").slice(0, item.path.startsWith("users/") ? 3 : 1).join("/");
    counts[top] = (counts[top] || 0) + 1;
  }
  return counts;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
  validateOptions(options, emulatorHost);

  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: options.project });
  const db = getFirestore(app);

  const documents = await collectTargets(db, options);
  console.log(JSON.stringify({
    mode: options.apply ? "APPLY" : "DRY RUN",
    project: options.project,
    target: emulatorHost ? `emulator ${emulatorHost}` : "live Firestore",
    includeDayOrders: options.includeDayOrders,
    uid: options.uid || null,
    documentCount: documents.length,
    byCollection: summarize(documents)
  }, null, 2));

  if (!options.apply) {
    console.log("DRY RUN complete. Nothing was deleted. Re-run with --apply --confirm " + APPLY_CONFIRMATION + " to delete.");
    process.exit(0);
  }
  if (!documents.length) {
    console.log("No matching documents. Nothing to delete.");
    process.exit(0);
  }

  const backupPath = await createVerifiedBackup(options.project, documents);
  console.log(`Verified local backup: ${backupPath}`);

  await deleteTargets(db, options);
  console.log(`Wipe applied: ${documents.length} document(s) deleted. spaces/*, appConfig, migrations, and users/{uid} profiles were not changed.`);
} catch (error) {
  console.error(`Wipe stopped: ${error.message}`);
  process.exitCode = 1;
}
