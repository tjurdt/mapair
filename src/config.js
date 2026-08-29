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
  }
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
  emulators: {
    auth: { url: "http://127.0.0.1:9099" },
    firestore: { host: "127.0.0.1", port: 8080 }
  }
};

export function resolveRuntimeConfig(hostname = location.hostname, search = location.search){
  const localHost = hostname === "localhost" || hostname === "127.0.0.1";
  const values = new URLSearchParams(search).getAll("firebaseEnv");
  if (values.length){
    if (values.length !== 1 || values[0] !== "local") throw new Error('firebaseEnv must be exactly "local". Startup stopped.');
    if (!localHost) throw new Error("LOCAL TEST mode is allowed only on localhost or 127.0.0.1. Startup stopped.");
    return {
      mode: "local",
      ...LOCAL_TEST_CONFIG
    };
  }
  if (localHost) throw new Error('Localhost requires the exact query parameter ?firebaseEnv=local. Startup stopped.');
  return { mode: "production", ...PRODUCTION_CONFIG };
}
