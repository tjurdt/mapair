const PRODUCTION_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBICWMjy3b-1SblR7Q2j04xVozitopfHhE",
    authDomain: "mapping-505208.firebaseapp.com",
    projectId: "mapping-505208",
    storageBucket: "mapping-505208.firebasestorage.app",
    messagingSenderId: "5834589386",
    appId: "1:5834589386:web:83a2d341a008ad8bdbe033",
    measurementId: "G-Z3SMTEMHKW"
  },
  google: {
    apiKey: "AIzaSyDL41HwqYYTdgDWVjurVCOtxZfmVErDGy4",
    mapId: "ab521a22dfdf46ce4d5c8faf"
  },
  spaceId: "us"
};

const LOCAL_TEST_CONFIG = {
  firebase: {
    apiKey: "fake-local-api-key",
    authDomain: "demo-mapair-local.localhost",
    projectId: "demo-mapair-local",
    storageBucket: "demo-mapair-local.localhost",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:localtest"
  },
  google: PRODUCTION_CONFIG.google,
  spaceId: "test-space-baseline",
  emulators: {
    auth: { url: "http://127.0.0.1:9099" },
    firestore: { host: "127.0.0.1", port: 8080 }
  }
};

// Strict LOCAL-only development/test harness. It selects one of a fixed
// allowlist of Emulator fixture Spaces; it is NOT a production Space switcher
// and never accepts an arbitrary Firestore Space ID.
const LOCAL_TEST_SPACES = {
  baseline: "test-space-baseline",
  group: "test-space-group"
};

function localTestSpaceToken(search){
  const values = new URLSearchParams(search).getAll("testSpace");
  if (!values.length) return null;
  if (values.length !== 1 || !Object.hasOwn(LOCAL_TEST_SPACES, values[0])){
    throw new Error('testSpace must be exactly one of "baseline" or "group". Startup stopped.');
  }
  return values[0];
}

// Strict LOCAL-only Phase 3 feature flag. Enables Personal Space provisioning,
// Membership-based Space discovery, and the Space switcher. It never touches
// production config and fails closed anywhere but LOCAL TEST.
function resolveMultiSpace(search){
  const values = new URLSearchParams(search).getAll("multiSpace");
  if (!values.length) return false;
  if (values.length !== 1 || values[0] !== "1"){
    throw new Error('multiSpace must be exactly "1". Startup stopped.');
  }
  return true;
}

export function resolveRuntimeConfig(hostname = location.hostname, search = location.search){
  const localHost = hostname === "localhost" || hostname === "127.0.0.1";
  const values = new URLSearchParams(search).getAll("firebaseEnv");
  if (values.length){
    if (values.length !== 1 || values[0] !== "local") throw new Error('firebaseEnv must be exactly "local". Startup stopped.');
    if (!localHost) throw new Error("LOCAL TEST mode is allowed only on localhost or 127.0.0.1. Startup stopped.");
    const testSpace = localTestSpaceToken(search);
    return {
      mode: "local",
      ...LOCAL_TEST_CONFIG,
      spaceId: testSpace ? LOCAL_TEST_SPACES[testSpace] : LOCAL_TEST_CONFIG.spaceId,
      explicitTestSpace: testSpace,
      explicitTestSpaceId: testSpace ? LOCAL_TEST_SPACES[testSpace] : null,
      multiSpace: resolveMultiSpace(search)
    };
  }
  if (new URLSearchParams(search).getAll("testSpace").length){
    throw new Error("testSpace is only available in LOCAL TEST mode. Startup stopped.");
  }
  if (new URLSearchParams(search).getAll("multiSpace").length){
    throw new Error("multiSpace is only available in LOCAL TEST mode. Startup stopped.");
  }
  if (localHost) throw new Error('Localhost requires the exact query parameter ?firebaseEnv=local. Startup stopped.');
  return { mode: "production", ...PRODUCTION_CONFIG };
}
