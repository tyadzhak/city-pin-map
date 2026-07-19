import "./test-helpers.mjs";
import { resetStorage } from "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  hydrate,
  getKey,
  setKey,
  getAllKeys,
  isProviderUnlocked,
  subscribe,
} from "./settings.js";

// settings.js is a singleton in-memory store backed by storage.js's
// loadAllApiKeys/saveApiKey. Reset both the localStorage shim AND the
// in-memory state (via hydrate(), which re-reads the now-empty storage)
// before every test so tests stay order-independent.
beforeEach(() => {
  resetStorage();
  hydrate();
});

test("hydrate seeds state from localStorage (empty storage -> empty keys)", () => {
  assert.deepEqual(getAllKeys(), { stadia: "", maptiler: "", thunderforest: "" });
});

test("hydrate reads persisted keys via storage.js's per-provider localStorage keys", () => {
  localStorage.setItem("city-pin-map.stadia-key.v1", "stadia-secret");
  localStorage.setItem("city-pin-map.maptiler-key.v1", "maptiler-secret");
  hydrate();
  assert.equal(getKey("stadia"), "stadia-secret");
  assert.equal(getKey("maptiler"), "maptiler-secret");
  assert.equal(getKey("thunderforest"), "");
});

test("hydrate notifies subscribers", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));
  hydrate();
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { stadia: "", maptiler: "", thunderforest: "" });
  unsubscribe();
});

test("getKey returns empty string for an unknown provider", () => {
  assert.equal(getKey("openfreemap"), "");
  assert.equal(getKey("not-a-real-provider"), "");
});

test("setKey stores a value, persists it, and notifies", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  setKey("stadia", "my-key");

  assert.equal(getKey("stadia"), "my-key");
  assert.equal(localStorage.getItem("city-pin-map.stadia-key.v1"), "my-key");
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { stadia: "my-key", maptiler: "", thunderforest: "" });
  unsubscribe();
});

test("setKey on an unknown provider is a safe no-op (no notify, nothing stored)", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  setKey("not-a-real-provider", "whatever");

  assert.equal(received.length, 0);
  assert.deepEqual(getAllKeys(), { stadia: "", maptiler: "", thunderforest: "" });
  unsubscribe();
});

test("setKey with an identical value is a no-op (no notify)", () => {
  setKey("stadia", "same-value");
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  setKey("stadia", "same-value");

  assert.equal(received.length, 0);
  unsubscribe();
});

test("setKey coerces null/undefined to empty string and removes the stored key", () => {
  setKey("stadia", "temp");
  assert.equal(localStorage.getItem("city-pin-map.stadia-key.v1"), "temp");

  setKey("stadia", null);

  assert.equal(getKey("stadia"), "");
  assert.equal(localStorage.getItem("city-pin-map.stadia-key.v1"), null);
});

test("getAllKeys returns a snapshot copy, not the live state object", () => {
  const snapshot = getAllKeys();
  snapshot.stadia = "mutated";
  assert.equal(getKey("stadia"), "");
});

test("isProviderUnlocked: keyless providers (not in VALID_PROVIDERS) are always unlocked", () => {
  assert.equal(isProviderUnlocked("openfreemap"), true);
  assert.equal(isProviderUnlocked("wikimedia"), true);
});

test("isProviderUnlocked: token providers are locked until a non-empty key is set", () => {
  assert.equal(isProviderUnlocked("stadia"), false);
  setKey("stadia", "a-key");
  assert.equal(isProviderUnlocked("stadia"), true);
  setKey("stadia", "");
  assert.equal(isProviderUnlocked("stadia"), false);
});

test("subscribe returns an unsubscribe function that stops further notifications", () => {
  const received = [];
  const unsubscribe = subscribe((snapshot) => received.push(snapshot));

  setKey("stadia", "a");
  assert.equal(received.length, 1);

  unsubscribe();
  setKey("maptiler", "b");
  assert.equal(received.length, 1);
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

  setKey("thunderforest", "x");

  assert.deepEqual(calls, ["second"]);
  assert.equal(errSpy.mock.calls.length, 1);
});
