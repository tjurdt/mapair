import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect } from "@playwright/test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Reset the Firestore emulator to the No-Space fixture. Called from each
// spec's beforeEach so specs never depend on another spec's mutations.
export function reseed() {
  execFileSync(process.execPath, ["scripts/seed-emulator.mjs", "--fixture", "no-space"], {
    cwd: repoRoot,
    stdio: "pipe",
  });
}

// Hosts blocked during E2E so the run is hermetic and deterministic. The
// Firebase SDK on www.gstatic.com and the emulators on 127.0.0.1 are
// deliberately NOT in this list; Google Maps is replaced by a stub (below), so
// its real endpoints are blocked too.
function isBlockedHost(host) {
  return (
    host === "maps.googleapis.com" ||
    host.startsWith("maps.") ||
    host === "fonts.googleapis.com" ||
    host === "fonts.gstatic.com"
  );
}

// A minimal `google.maps` so `initMap()` succeeds and the marker / map-surface
// code (renderMarkers, effectiveMarkerColor, sequence markers, viewport
// fitting) actually runs under test. Without this the client's `if (!AdvMarker)
// return` short-circuits and the whole colour path is invisible to E2E.
async function installGoogleMapsStub(page) {
  await page.addInitScript(() => {
    const noopHandle = { remove() {} };
    window.__mapairTestMarkers = [];

    class FakeMap {
      constructor(el, opts) {
        this.el = el;
        this.opts = opts;
      }
      addListener() { return noopHandle; }
      setCenter() {}
      setZoom() {}
      getZoom() { return 12; }
      fitBounds() {}
      panTo() {}
      setOptions() {}
    }
    class FakeAdvancedMarker {
      constructor(opts = {}) {
        Object.assign(this, opts);
        window.__mapairTestMarkers.push(this);
      }
      addListener() { return noopHandle; }
      set map(v) { this._map = v; }
      get map() { return this._map; }
    }
    class FakePin {
      constructor(opts = {}) {
        this.opts = opts;
        this.element = document.createElement("div");
        this.style = this.element.style;
      }
    }
    class FakeGeocoder {
      geocode(_request, callback) {
        if (callback) callback([], "ZERO_RESULTS");
        return Promise.resolve({ results: [] });
      }
    }
    class FakeData {
      constructor() {}
      setStyle() {}
      addGeoJson() {}
      setMap() {}
      forEach() {}
      addListener() { return noopHandle; }
    }

    const libraries = {
      maps: {
        Map: FakeMap,
        LatLngBounds: class {
          extend() { return this; }
        },
        event: {
          trigger() {},
          addListener() { return noopHandle; },
          addListenerOnce() {},
          clearListeners() {},
        },
        Data: FakeData,
      },
      marker: { AdvancedMarkerElement: FakeAdvancedMarker, PinElement: FakePin },
      places: {
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: async () => ({ suggestions: [] }) },
        AutocompleteSessionToken: class {},
        Place: class {
          static async searchNearby() { return { places: [] }; }
        },
      },
      geocoding: { Geocoder: FakeGeocoder },
    };

    window.google = window.google || {};
    window.google.maps = {
      ...libraries.maps,
      importLibrary: async (name) => libraries[name] || {},
    };
  });
}

const IDENTITY_BUTTON = { a: "測試使用者甲", b: "測試使用者乙" };

// Load the app in LOCAL TEST mode, sign in as a fixed test identity, and wait
// for the No-Space projection to render the list for the first time. Uncaught
// page errors during the flow are recorded on `page` for expectNoPageErrors().
export async function signIn(page, identity = "a") {
  const pageErrors = [];
  page.__mapairPageErrors = pageErrors;
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.route("**/*", (route) => {
    let host = "";
    try {
      host = new URL(route.request().url()).host;
    } catch {
      return route.continue();
    }
    return isBlockedHost(host) ? route.abort() : route.continue();
  });
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

  await installGoogleMapsStub(page);
  await page.goto("/?firebaseEnv=local");
  await page.getByRole("button", { name: IDENTITY_BUTTON[identity] }).click();

  await page.waitForSelector("#list");
  await page.waitForFunction(() => {
    const el = document.querySelector("#list");
    if (!el) return false;
    if (el.querySelector(".card")) return true;
    const empty = el.querySelector(".empty");
    return !!empty && !empty.textContent.includes("載入中");
  });

  expectNoPageErrors(page);
}

export function expectNoPageErrors(page) {
  const errors = page.__mapairPageErrors || [];
  expect(errors.map((error) => error.message).join("\n")).toBe("");
}

// Constrain the visited list to an explicit date window, independent of what
// "this month" happens to be when the suite runs. Selecting the custom scope
// also reveals #filterPanel, which holds the date inputs and category chips.
export async function setDateRange(page, from, to) {
  await page.selectOption("#fl_scope", "custom");
  await page.fill("#fl_from", from);
  await page.fill("#fl_to", to);
}

// Every fixture Visit for test-user-a falls in this window.
export const FIXTURE_MONTH = { from: "2026-08-01", to: "2026-08-31" };
