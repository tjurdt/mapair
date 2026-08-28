import assert from "node:assert/strict";
import { resolveRuntimeConfig } from "../src/config.js";

/* Production defaults */
{
  const config = resolveRuntimeConfig("mapair.example.com", "");
  assert.equal(config.mode, "production");
  assert.equal(config.spaceId, "us");
}

/* LOCAL TEST baseline */
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local");
  assert.equal(config.mode, "local");
  assert.equal(config.spaceId, "test-space-baseline");
  assert.equal(config.firebase.projectId, "demo-mapair-local");
}

/* LOCAL TEST explicit baseline harness */
{
  const config = resolveRuntimeConfig("127.0.0.1", "?firebaseEnv=local&testSpace=baseline");
  assert.equal(config.spaceId, "test-space-baseline");
}

/* LOCAL TEST group harness */
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local&testSpace=group");
  assert.equal(config.mode, "local");
  assert.equal(config.spaceId, "test-space-group");
}

/* Unknown testSpace values fail closed */
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&testSpace=us"),
  /testSpace must be exactly one/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&testSpace=spaces%2Fus"),
  /testSpace must be exactly one/
);

/* Duplicate testSpace values rejected */
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&testSpace=group&testSpace=baseline"),
  /testSpace must be exactly one/
);

/* testSpace is inert / fails closed outside LOCAL TEST */
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?testSpace=group"),
  /only available in LOCAL TEST/
);

/* Existing LOCAL TEST guards remain */
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?firebaseEnv=local"),
  /allowed only on localhost/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", ""),
  /requires the exact query parameter/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&firebaseEnv=local"),
  /firebaseEnv must be exactly/
);

console.log("config assertions passed");
