import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PIN_COLOR,
  addPin,
  removePin,
  updatePin,
  listPins,
  replaceAll,
  subscribe,
} from "./pins.js";

// pins.js is a singleton in-memory store (module-level `pins` array) — reset
// it before every test via the store's own replaceAll so tests stay
// order-independent, mirroring the storage-shim resetStorage() pattern used
// elsewhere.
beforeEach(() => {
  replaceAll([]);
});

test("DEFAULT_PIN_COLOR is exported and looks like a hex color", () => {
  assert.equal(typeof DEFAULT_PIN_COLOR, "string");
  assert.match(DEFAULT_PIN_COLOR, /^#[0-9a-fA-F]{6}$/);
});

test("addPin stamps id/createdAt and stores the given fields", () => {
  const before = Date.now();
  const pin = addPin({
    name: "Kyiv, Ukraine",
    lat: 50.45,
    lon: 30.52,
    color: "#e63946",
  });
  const after = Date.now();

  assert.equal(typeof pin.id, "string");
  assert.ok(pin.id.length > 0);
  assert.equal(pin.name, "Kyiv, Ukraine");
  assert.equal(pin.lat, 50.45);
  assert.equal(pin.lon, 30.52);
  assert.equal(pin.color, "#e63946");
  assert.equal(pin.group, null);
  assert.equal(pin.icon, null);
  assert.ok(pin.createdAt >= before && pin.createdAt <= after);
  // originalLat/originalLon are omitted entirely when not supplied.
  assert.equal("originalLat" in pin, false);
  assert.equal("originalLon" in pin, false);

  assert.deepEqual(listPins(), [pin]);
});

test("addPin defaults group and icon to null when omitted", () => {
  const pin = addPin({ name: "X", lat: 1, lon: 2, color: "#000000" });
  assert.equal(pin.group, null);
  assert.equal(pin.icon, null);
});

test("addPin passes through explicit group and icon", () => {
  const pin = addPin({
    name: "X",
    lat: 1,
    lon: 2,
    color: "#000000",
    group: "group-1",
    icon: "circle",
  });
  assert.equal(pin.group, "group-1");
  assert.equal(pin.icon, "circle");
});

test("addPin stamps originalLat/originalLon only when both are finite", () => {
  const withOrigin = addPin({
    name: "X",
    lat: 1,
    lon: 2,
    color: "#000000",
    originalLat: 1,
    originalLon: 2,
  });
  assert.equal(withOrigin.originalLat, 1);
  assert.equal(withOrigin.originalLon, 2);

  // Only one of the pair supplied — FBL-008 contract requires BOTH finite,
  // so neither should be stamped (never invent half an origin).
  const partial = addPin({
    name: "Y",
    lat: 1,
    lon: 2,
    color: "#000000",
    originalLat: 5,
    originalLon: NaN,
  });
  assert.equal("originalLat" in partial, false);
  assert.equal("originalLon" in partial, false);

  const missing = addPin({ name: "Z", lat: 1, lon: 2, color: "#000000" });
  assert.equal("originalLat" in missing, false);
  assert.equal("originalLon" in missing, false);
});

test("addPin notifies subscribers with a snapshot including the new pin", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  const pin = addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], [pin]);
  unsubscribe();
});

test("removePin removes a pin by id and notifies", () => {
  const a = addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  const b = addPin({ name: "B", lat: 2, lon: 2, color: "#222222" });

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  removePin(a.id);

  assert.deepEqual(listPins(), [b]);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], [b]);
  unsubscribe();
});

test("removePin on a non-existent id is a safe no-op (no notify)", () => {
  addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  removePin("does-not-exist");

  assert.equal(received.length, 0);
  assert.equal(listPins().length, 1);
  unsubscribe();
});

test("updatePin merges a patch, preserves id, and notifies", () => {
  const pin = addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  updatePin(pin.id, { name: "Renamed", color: "#00ff00" });

  const [updated] = listPins();
  assert.equal(updated.id, pin.id);
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.color, "#00ff00");
  assert.equal(updated.lat, 1); // untouched fields survive the merge
  assert.equal(received.length, 1);
  unsubscribe();
});

test("updatePin patch cannot override id", () => {
  const pin = addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  updatePin(pin.id, { id: "hijacked", name: "Still safe" });
  assert.equal(listPins()[0].id, pin.id);
});

test("updatePin on a non-existent id is a safe no-op (no notify)", () => {
  const pin = addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  updatePin("does-not-exist", { name: "Ghost" });

  assert.equal(received.length, 0);
  assert.deepEqual(listPins(), [pin]);
  unsubscribe();
});

test("listPins returns a snapshot copy, not the live array", () => {
  addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  const snapshot = listPins();
  snapshot.push({ id: "fake" });
  assert.equal(listPins().length, 1);
});

test("replaceAll swaps the whole store and notifies once", () => {
  addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  addPin({ name: "B", lat: 2, lon: 2, color: "#222222" });

  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  const next = [
    { id: "x", name: "X", lat: 9, lon: 9, color: "#abcdef", group: null, icon: null, createdAt: 1 },
  ];
  replaceAll(next);

  assert.deepEqual(listPins(), next);
  assert.equal(received.length, 1);
  unsubscribe();
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });
  assert.equal(received.length, 1);

  unsubscribe();
  addPin({ name: "B", lat: 2, lon: 2, color: "#222222" });
  assert.equal(received.length, 1); // no further notifications after unsubscribe
});

test("unsubscribe is safe to call twice", () => {
  const unsubscribe = subscribe(() => {});
  unsubscribe();
  assert.doesNotThrow(() => unsubscribe());
});

test("a throwing listener does not prevent other listeners from being notified", (t) => {
  const errSpy = t.mock.method(console, "error", () => {});
  const calls = [];
  subscribe(() => {
    throw new Error("boom");
  });
  subscribe(() => calls.push("second"));

  addPin({ name: "A", lat: 1, lon: 1, color: "#111111" });

  assert.deepEqual(calls, ["second"]);
  assert.equal(errSpy.mock.calls.length, 1);
});
