import assert from "node:assert/strict";
import { resolveRuntimeConfig } from "../src/config.js";

/* Production defaults */
{
  const config = resolveRuntimeConfig("mapair.example.com", "");
  assert.equal(config.mode, "production");
}
{
  const config = resolveRuntimeConfig("mapair.example.com", "?legacySpace=1");
  assert.equal(config.mode,"production","query parameters cannot restore a legacy runtime");
}

/* LOCAL TEST */
{
  const config = resolveRuntimeConfig("localhost", "?firebaseEnv=local");
  assert.equal(config.mode, "local");
  assert.equal(config.firebase.projectId, "demo-mapair-local");
}
assert.throws(
  () => resolveRuntimeConfig("mapair.example.com", "?firebaseEnv=local"),
  /allowed only on localhost/
);

/* Existing LOCAL TEST guards remain. */
assert.throws(
  () => resolveRuntimeConfig("localhost", ""),
  /requires the exact query parameter/
);
assert.throws(
  () => resolveRuntimeConfig("localhost", "?firebaseEnv=local&firebaseEnv=local"),
  /firebaseEnv must be exactly/
);

console.log("config assertions passed");
