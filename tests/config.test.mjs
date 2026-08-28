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

/* Phase 3 multiSpace flag (LOCAL only) */
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local&multiSpace=1");
  assert.equal(config.mode, "local");
  assert.equal(config.multiSpace, true);
  assert.equal(config.explicitTestSpace, null);
}
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local");
  assert.equal(config.multiSpace, false, "off by default");
}
{
  const config = resolveRuntimeConfig("127.0.0.1", "?firebaseEnv=local&multiSpace=1&testSpace=group");
  assert.equal(config.multiSpace, true);
  assert.equal(config.explicitTestSpace, "group");
  assert.equal(config.explicitTestSpaceId, "test-space-group");
  assert.equal(config.spaceId, "test-space-group");
}
/* production + multiSpace=1 -> throws */
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?multiSpace=1"),
  /only available in LOCAL TEST/
);
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?firebaseEnv=local&multiSpace=1"),
  /allowed only on localhost/
);
/* localhost + multiSpace=1 without firebaseEnv=local -> throws */
assert.throws(
  () => resolveRuntimeConfig("localhost", "?multiSpace=1"),
  /only available in LOCAL TEST/
);
/* duplicate multiSpace -> throws */
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&multiSpace=1&multiSpace=1"),
  /multiSpace must be exactly/
);
/* unknown multiSpace value -> throws */
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&multiSpace=2"),
  /multiSpace must be exactly/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&multiSpace=true"),
  /multiSpace must be exactly/
);

/* No-Space Phase A flag (LOCAL only, exact, mutually exclusive) */
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local&noSpace=1");
  assert.equal(config.mode, "local");
  assert.equal(config.noSpace, true);
  assert.equal(config.multiSpace, false);
}
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?noSpace=1"),
  /only available in LOCAL TEST/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?noSpace=1"),
  /only available in LOCAL TEST/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&noSpace=2"),
  /noSpace must be exactly/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&noSpace=1&noSpace=1"),
  /noSpace must be exactly/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&multiSpace=1&noSpace=1"),
  /cannot be enabled together/
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
