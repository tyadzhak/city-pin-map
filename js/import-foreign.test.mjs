// Run with: node --test js/import-foreign.test.mjs
//
// Exercises importFromFile — the sole exported entry point — via the RFC4180-
// ish CSV tokenizer, foreign-JSON shape detection, delegation to the app's
// own backup format (js/backup.js), and the sequential geocode loop (mocked
// fetch; fake timers drive the ≥1 req/sec rate gate without real waits).
//
// importFromFile is exercised end-to-end (not its unexported internals) —
// the store (js/pins.js) and the DOM shim (js/test-helpers.mjs) are the
// observation points.

import "./test-helpers.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetStorage, mockFetch, jsonResponse } from "./test-helpers.mjs";
import { importFromFile } from "./import-foreign.js";
import { listPins, replaceAll as replaceAllPins } from "./pins.js";

function makeFile(name, content) {
  return { name, text: async () => content };
}

let alertMessages;
let confirmResult;
let errorBanner;
let statusEl;
let restoreFetch = null;

beforeEach(() => {
  resetStorage();
  replaceAllPins([]);
  alertMessages = [];
  confirmResult = true;
  globalThis.confirm = () => confirmResult;
  globalThis.alert = (msg) => alertMessages.push(msg);

  // Register the two elements import-foreign.js / storage.js look up by id,
  // so showError()/setImportStatus() exercise their real (non-null) branch.
  errorBanner = document.createElement("div");
  errorBanner.id = "error-banner";
  statusEl = document.createElement("div");
  statusEl.id = "import-file-status";
});

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

// Drives a pending importFromFile() promise past the geocode rate gate using
// fake timers, without any real wall-clock wait. The gate's `gate()` chains
// a setTimeout for the remaining wait, so alternating a microtask flush with
// a 1s tick lets each queued geocode call proceed in turn.
async function runWithFakeGate(t, fn) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const promise = fn();
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  // setImmediate is real (only Date/setTimeout are mocked), so each pass
  // fully drains whatever microtask chain the previous tick unblocked
  // (gate() -> fetch -> res.json() -> next loop iteration's gate() ...)
  // before advancing the fake clock again. A single `await Promise.resolve()`
  // only flushes one microtask hop, which is too little for a multi-row
  // geocode loop and can leave the promise permanently unsettled once the
  // iteration budget below is spent.
  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  return promise;
}

// ── unsupported input / early returns ───────────────────────────────────

test("importFromFile: no-op on falsy file", async () => {
  await importFromFile(null);
  assert.equal(listPins().length, 0);
  assert.equal(alertMessages.length, 0);
});

test("importFromFile: unsupported extension shows an error", async () => {
  await importFromFile(makeFile("cities.txt", "name\nParis"));
  assert.equal(errorBanner.textContent, "Unsupported file type. Choose a .csv or .json file.");
  assert.equal(listPins().length, 0);
});

test("importFromFile: unreadable file shows an error", async () => {
  await importFromFile({ name: "cities.csv", text: async () => { throw new Error("boom"); } });
  assert.equal(errorBanner.textContent, "Could not read that file. Try again.");
});

test("importFromFile: declining the confirm dialog applies nothing", async () => {
  confirmResult = false;
  await importFromFile(makeFile("cities.csv", "name,lat,lon\nParis,48.8566,2.3522\n"));
  assert.equal(listPins().length, 0);
  assert.equal(alertMessages.length, 0);
});

// ── CSV tokenizer ────────────────────────────────────────────────────────

test("CSV: quoted field with embedded comma + CRLF line endings", async () => {
  const csv = 'name,lat,lon\r\n"New York, NY",40.7128,-74.0060\r\nParis,48.8566,2.3522\r\n';
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 2);
  assert.equal(pins[0].name, "New York, NY");
  assert.equal(pins[0].lat, 40.7128);
  assert.equal(pins[0].lon, -74.006);
  assert.equal(pins[1].name, "Paris");
});

test("CSV: bare CR line endings", async () => {
  const csv = "name,lat,lon\rLondon,51.5074,-0.1278\rBerlin,52.52,13.405\r";
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 2);
  assert.equal(pins[0].name, "London");
  assert.equal(pins[1].name, "Berlin");
});

test("CSV: UTF-8 BOM is stripped before the header is parsed", async () => {
  const csv = "﻿name,lat,lon\nTokyo,35.6762,139.6503\n";
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].name, "Tokyo");
});

test("CSV: escaped double-quotes (\"\") inside a quoted field", async () => {
  const csv = 'name,lat,lon\n"O""Brien City",10,20\n';
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].name, 'O"Brien City');
});

test("CSV: a mid-field quote (not field-initial) is literal", async () => {
  const csv = 'name,lat,lon\nO"Brien City,10,20\n';
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].name, 'O"Brien City');
});

test("CSV: trailing newline and blank-name rows are skipped and counted", async () => {
  const csv = "name,lat,lon\nMadrid,40.4168,-3.7038\n,1,2\n";
  await importFromFile(makeFile("cities.csv", csv));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.match(alertMessages[0], /Skipped 1 row with no name\./);
});

test("CSV: empty lat/lon cells fall through to geocoding, not (0,0)", async (t) => {
  const restore = mockFetch(() =>
    jsonResponse([{ display_name: "Berlin, Germany", lat: "52.52", lon: "13.405" }])
  );
  restoreFetch = restore;
  const csv = "name,lat,lon\nBerlin,,\n";
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.csv", csv)));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].lat, 52.52);
  assert.equal(pins[0].lon, 13.405);
});

test("CSV: missing name/city column shows an error and imports nothing", async () => {
  await importFromFile(makeFile("cities.csv", "foo,bar\n1,2\n"));
  assert.equal(errorBanner.textContent, "CSV needs a 'name' or 'city' column.");
  assert.equal(listPins().length, 0);
});

test("CSV: an all-blank file reports 'no rows found'", async () => {
  await importFromFile(makeFile("cities.csv", "\n   \n"));
  assert.equal(errorBanner.textContent, "No rows found in that file.");
});

// ── JSON shape detection ─────────────────────────────────────────────────

test("JSON: invalid JSON shows an error", async () => {
  await importFromFile(makeFile("cities.json", "{not valid"));
  assert.equal(errorBanner.textContent, "That file is not valid JSON.");
});

test("JSON: array of bare city-name strings, blanks skipped", async (t) => {
  const restore = mockFetch((url) => {
    const q = new URL(url).searchParams.get("q");
    if (q === "Paris") {
      return jsonResponse([{ display_name: "Paris, France", lat: "48.8566", lon: "2.3522" }]);
    }
    return jsonResponse([{ display_name: "Berlin, Germany", lat: "52.52", lon: "13.405" }]);
  });
  restoreFetch = restore;
  const json = JSON.stringify(["Paris", "  ", "Berlin"]);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  const pins = listPins();
  assert.equal(pins.length, 2);
  assert.match(alertMessages[0], /Imported 2 pins\./);
  assert.match(alertMessages[0], /Skipped 1 row with no name\./);
});

test("JSON: array of {name,lat,lon}-shaped objects with alternate key casing", async () => {
  const json = JSON.stringify([{ City: "Tokyo", Latitude: 35.68, Longitude: 139.76 }]);
  await importFromFile(makeFile("cities.json", json));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].name, "Tokyo");
  assert.equal(pins[0].lat, 35.68);
  assert.equal(pins[0].lon, 139.76);
});

test("JSON: out-of-range coordinates are treated as 'not provided' and geocoded", async (t) => {
  const restore = mockFetch(() =>
    jsonResponse([{ display_name: "Nowhere", lat: "1", lon: "2" }])
  );
  restoreFetch = restore;
  const json = JSON.stringify([{ name: "Swapped Cols", lat: 999, lon: 2 }]);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  const pins = listPins();
  assert.equal(pins.length, 1);
  assert.equal(pins[0].lat, 1);
  assert.equal(pins[0].lon, 2);
});

test("JSON: unrecognised shape shows an error", async () => {
  await importFromFile(makeFile("cities.json", JSON.stringify([1, 2, 3])));
  assert.match(errorBanner.textContent, /Unrecognised JSON shape/);
  assert.equal(listPins().length, 0);
});

test("JSON: object without a name-like key is unrecognised", async () => {
  await importFromFile(makeFile("cities.json", JSON.stringify([{ foo: "bar" }])));
  assert.match(errorBanner.textContent, /Unrecognised JSON shape/);
});

test("JSON: app-backup-shaped file delegates to importFromJson instead of the row path", async () => {
  const backup = JSON.stringify({ version: 2, pins: [], groups: [], userIcons: [] });
  await importFromFile(makeFile("backup.json", backup));
  // The row-based "Imported N pins." summary never fires on the delegated path.
  assert.equal(alertMessages.length, 0);
  assert.equal(listPins().length, 0);
});

// ── sequential geocode loop: success / failure / outage bail ────────────

test("geocode loop: 'no match' rows are counted as failed, not silently dropped", async (t) => {
  const restore = mockFetch(() => jsonResponse([]));
  restoreFetch = restore;
  const json = JSON.stringify(["Atlantis"]);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  assert.equal(listPins().length, 0);
  assert.match(alertMessages[0], /Imported 0 pins\./);
  assert.match(alertMessages[0], /Could not geocode 1: Atlantis/);
});

test("geocode loop: more than MAX_FAILED_NAMES_SHOWN failures truncate with an ellipsis", async (t) => {
  const restore = mockFetch(() => jsonResponse([])); // every query resolves with "no match"
  restoreFetch = restore;
  const names = ["A1", "A2", "A3", "A4", "A5", "A6"];
  const json = JSON.stringify(names);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  assert.equal(listPins().length, 0);
  assert.match(alertMessages[0], /Could not geocode 6: A1, A2, A3, A4, A5, …/);
});

test("geocode loop: consecutive network failures bail early and report un-attempted rows", async (t) => {
  const restore = mockFetch(() => jsonResponse([], { status: 500 }));
  restoreFetch = restore;
  const names = ["N1", "N2", "N3", "N4", "N5"];
  const json = JSON.stringify(names);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  assert.equal(listPins().length, 0);
  // 3 consecutive throws trip CONSECUTIVE_FAILURE_LIMIT; 2 rows never attempted.
  assert.match(alertMessages[0], /Could not geocode 3: N1, N2, N3/);
  assert.match(alertMessages[0], /geocoder appeared unreachable, so 2 remaining rows were not attempted/);
});

test("geocode loop: a successful round-trip after failures resets the outage streak", async (t) => {
  let call = 0;
  const restore = mockFetch(() => {
    call++;
    // Two network failures, then a real (empty) response, then two more
    // network failures — the reset means these five calls never trip the
    // 3-in-a-row bail, so all five are attempted (proving the streak reset).
    if (call === 3) return jsonResponse([]);
    return jsonResponse([], { status: 500 });
  });
  restoreFetch = restore;
  const names = ["B1", "B2", "B3", "B4", "B5"];
  const json = JSON.stringify(names);
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.json", json)));
  assert.equal(listPins().length, 0);
  assert.match(alertMessages[0], /Could not geocode 5: B1, B2, B3, B4, B5/);
  assert.doesNotMatch(alertMessages[0], /not attempted/);
});

test("geocode loop: mix of immediate rows and geocoded successes reports the combined count", async (t) => {
  const restore = mockFetch(() =>
    jsonResponse([{ display_name: "Oslo, Norway", lat: "59.91", lon: "10.75" }])
  );
  restoreFetch = restore;
  const csv = "name,lat,lon\nRome,41.9028,12.4964\nOslo,,\n";
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.csv", csv)));
  const pins = listPins();
  assert.equal(pins.length, 2);
  assert.match(alertMessages[0], /Imported 2 pins\./);
});

test("geocode loop: a single imported pin uses singular wording", async () => {
  const csv = "name,lat,lon\nRome,41.9028,12.4964\n";
  await importFromFile(makeFile("cities.csv", csv));
  assert.match(alertMessages[0], /^Imported 1 pin\./);
});

test("geocode loop: origin lat/lon is captured for both immediate and geocoded pins", async (t) => {
  const restore = mockFetch(() =>
    jsonResponse([{ display_name: "Oslo, Norway", lat: "59.91", lon: "10.75" }])
  );
  restoreFetch = restore;
  const csv = "name,lat,lon\nRome,41.9028,12.4964\nOslo,,\n";
  await runWithFakeGate(t, () => importFromFile(makeFile("cities.csv", csv)));
  const pins = listPins();
  const rome = pins.find((p) => p.name === "Rome");
  const oslo = pins.find((p) => p.name === "Oslo");
  assert.equal(rome.originalLat, 41.9028);
  assert.equal(rome.originalLon, 12.4964);
  assert.equal(oslo.originalLat, 59.91);
  assert.equal(oslo.originalLon, 10.75);
});
