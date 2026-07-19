// Run with: node --test js/search.test.mjs
//
// Covers js/search.js: initSearch()'s missing-DOM guard, the short
// city-name derivation (shortName, not itself exported — exercised via the
// addPin-on-select path), the debounce + Nominatim rate-gate interaction
// (via mocked fetch + node:test fake timers, no real waits), abort-on-
// newer-keystroke, MIN_QUERY_LEN gating, Escape/Enter keyboard handling,
// empty-results and error rendering.
//
// geocode.js's rate gate + cache are module-singleton state shared across
// every test in THIS file (node --test runs one file per process, but all
// tests within a file share one module graph). Two consequences baked into
// the tests below:
//   - every test uses a distinct query string so a cache hit in one test
//     can never mask a missing fetch call in another.
//   - after the debounce fires, the gate may still need up to ~1000ms of
//     (fake) time before it lets the fetch through, depending on how much
//     (real) wall-clock time happened to elapse since the previous test's
//     gate() call. `advance()` below ticks fake time in small steps with a
//     microtask flush after each, generously covering DEBOUNCE_MS + the
//     rate-gate wait regardless of that.

import "./test-helpers.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockFetch, jsonResponse, resetStorage } from "./test-helpers.mjs";
import { initSearch, __internals } from "./search.js";
import * as pinStore from "./pins.js";

// ── DOM setup helpers ─────────────────────────────────────────────────────

function setupDom() {
  const input = document.createElement("input");
  input.id = "search-input";
  const list = document.createElement("ul");
  list.id = "search-results";
  list.hidden = true; // mirrors index.html's `hidden` attribute on <ul id="search-results">
  document.body.appendChild(input);
  document.body.appendChild(list);
  return { input, list };
}

function typeQuery(input, value) {
  input.value = value;
  input.dispatchEvent({ type: "input" });
}

/**
 * Advance node:test's mocked setTimeout in small steps, flushing
 * microtasks after each, for a total of `totalMs` virtual milliseconds.
 * Deterministic and fast (no real waiting) — see file header for why a
 * single big tick() isn't reliable here.
 */
async function advance(t, totalMs, step = 50) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += step) {
    t.mock.timers.tick(step);
    await Promise.resolve();
    await Promise.resolve();
  }
}

// Comfortably covers DEBOUNCE_MS (350) plus the geocode rate-gate's worst
// case wait (RATE_LIMIT_MS 1000).
const SETTLE_MS = 2000;

function nominatimResult({ displayName, lat, lon, address = null }) {
  return { display_name: displayName, lat: String(lat), lon: String(lon), address };
}

beforeEach(() => {
  resetStorage();
  pinStore.replaceAll([]);
});

// ── initSearch: missing-DOM guard ────────────────────────────────────────
// Must run before any other test in this file creates #search-input /
// #search-results, since the fake document's id registry is shared across
// the whole file (see js/test-helpers.mjs).

test("initSearch: warns and no-ops when #search-input/#search-results are missing", async () => {
  assert.doesNotThrow(() => initSearch());
});

// ── MIN_QUERY_LEN gating + Escape ─────────────────────────────────────────

test("handleInput: below MIN_QUERY_LEN clears/hides the dropdown without querying", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  let fetchCalls = 0;
  const restore = mockFetch(() => {
    fetchCalls++;
    return jsonResponse([]);
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "a"); // MIN_QUERY_LEN is 2
    await advance(t, SETTLE_MS);
    assert.equal(list.hidden, true);
    assert.equal(fetchCalls, 0);
  } finally {
    restore();
  }
});

test("handleKeydown: Escape hides the dropdown", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  const restore = mockFetch(() =>
    jsonResponse([nominatimResult({ displayName: "Escapeville, Country", lat: 1, lon: 1 })])
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "escq");
    await advance(t, SETTLE_MS);
    assert.equal(list.hidden, false);

    input.dispatchEvent({ type: "keydown", key: "Escape" });
    assert.equal(list.hidden, true);
  } finally {
    restore();
  }
});

// ── Debounce collapses a burst of keystrokes to one geocode call ────────

test("a burst of keystrokes collapses to a single geocode call for the final query", async (t) => {
  const { input } = setupDom();
  initSearch();

  const seenQueries = [];
  const restore = mockFetch((url) => {
    const q = new URL(url).searchParams.get("q");
    seenQueries.push(q);
    return jsonResponse([nominatimResult({ displayName: `${q} City, Country`, lat: 1, lon: 1 })]);
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // Fire several keystrokes well within the 350ms debounce window (no
    // ticking between them), each re-scheduling/clearing the previous timer.
    typeQuery(input, "bu");
    typeQuery(input, "bur");
    typeQuery(input, "burs");
    typeQuery(input, "burst9");

    await advance(t, SETTLE_MS);

    assert.deepEqual(seenQueries, ["burst9"]);
  } finally {
    restore();
  }
});

// ── Abort-on-newer-keystroke ──────────────────────────────────────────────

test("a newer query in flight discards a slower, stale result from an older query", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  let resolveStale;
  const stalePromise = new Promise((resolve) => {
    resolveStale = resolve;
  });
  const restore = mockFetch((url) => {
    const q = new URL(url).searchParams.get("q");
    if (q === "staleq") return stalePromise;
    if (q === "freshq") {
      return jsonResponse([nominatimResult({ displayName: "Fresh City, Country", lat: 2, lon: 2 })]);
    }
    return jsonResponse([]);
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // First query: its fetch will hang on `stalePromise` until we resolve
    // it by hand, simulating a slow response that arrives late.
    typeQuery(input, "staleq");
    await advance(t, SETTLE_MS);

    // Second, newer query resolves immediately and should win.
    typeQuery(input, "freshq");
    await advance(t, SETTLE_MS);

    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].textContent, "Fresh City, Country");

    // Now let the stale first request finally resolve. Because the module-
    // level abortController has moved on to the "freshq" controller, the
    // stale result must be dropped rather than overwriting the list.
    resolveStale(jsonResponse([nominatimResult({ displayName: "Stale City, Country", lat: 1, lon: 1 })]));
    await advance(t, 200);

    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].textContent, "Fresh City, Country");
  } finally {
    restore();
  }
});

// ── Empty results + geocoder error rendering ─────────────────────────────

test("renders 'No matches.' for a zero-result response", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  const restore = mockFetch(() => jsonResponse([]));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "nowhereq");
    await advance(t, SETTLE_MS);
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].textContent, "No matches.");
    assert.equal(list.children[0].className, "search__row search__row--empty");
  } finally {
    restore();
  }
});

test("renders a geocoder HTTP error as an error row and calls showError", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  const banner = document.createElement("div");
  banner.id = "error-banner";
  banner.hidden = true;
  document.body.appendChild(banner);

  const restore = mockFetch(() => jsonResponse([], { status: 500, ok: false }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "brokenq");
    await advance(t, SETTLE_MS);
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].className, "search__row search__row--error");
    assert.match(list.children[0].textContent, /Geocoder returned an error/);
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /Geocoder returned an error/);
  } finally {
    restore();
    banner.remove();
  }
});

// ── addPin-on-select + short city-name derivation ────────────────────────

async function selectFirstResultViaEnter(t, input, list, query, results) {
  const restore = mockFetch(() => jsonResponse(results));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, query);
    await advance(t, SETTLE_MS);
    input.dispatchEvent({ type: "keydown", key: "Enter" });
  } finally {
    restore();
  }
}

test("shortName derivation: prefers address.city over the displayName", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "cityq", [
    nominatimResult({
      displayName: "Kyiv, Kyiv City, Ukraine",
      lat: 50.45,
      lon: 30.52,
      address: { city: "Kyiv", country: "Ukraine" },
    }),
  ]);

  const [pin] = pinStore.listPins();
  assert.equal(pin.name, "Kyiv");
  assert.equal(pin.lat, 50.45);
  assert.equal(pin.lon, 30.52);
  assert.equal(pin.originalLat, 50.45);
  assert.equal(pin.originalLon, 30.52);
  assert.equal(input.value, "");
  assert.equal(list.hidden, true);
});

test("shortName derivation: falls back to town when city is absent", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "townq", [
    nominatimResult({
      displayName: "Smalltown, Country",
      lat: 3,
      lon: 4,
      address: { town: "Smalltown" },
    }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "Smalltown");
});

test("shortName derivation: falls back to village when city/town are absent", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "villageq", [
    nominatimResult({ displayName: "Villageville, Country", lat: 5, lon: 6, address: { village: "Villageville" } }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "Villageville");
});

test("shortName derivation: falls back to municipality when city/town/village are absent", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "muniq", [
    nominatimResult({ displayName: "Munitown, Country", lat: 7, lon: 8, address: { municipality: "Muniland" } }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "Muniland");
});

test("shortName derivation: falls back to county as the last address-block option", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "countyq", [
    nominatimResult({ displayName: "Countyburg, Country", lat: 9, lon: 10, address: { county: "Bigcounty" } }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "Bigcounty");
});

test("shortName derivation: no address block falls back to the first displayName segment", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "noaddrq", [
    nominatimResult({ displayName: "Headword, Region, Country", lat: 11, lon: 12, address: null }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "Headword");
});

test("shortName derivation: no address AND no comma returns displayName unchanged", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "nocommaq", [
    nominatimResult({ displayName: "JustOneWord", lat: 13, lon: 14, address: null }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "JustOneWord");
});

test("shortName derivation: an empty displayName with no address block returns the (empty) displayName verbatim", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  await selectFirstResultViaEnter(t, input, list, "emptynameq", [
    nominatimResult({ displayName: "", lat: 19, lon: 20, address: null }),
  ]);
  assert.equal(pinStore.listPins().at(-1).name, "");
});

test("addPin-on-select via list click (delegated click, not just Enter)", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  const restore = mockFetch(() =>
    jsonResponse([
      nominatimResult({ displayName: "ClickCity, Country", lat: 15, lon: 16, address: { city: "ClickCity" } }),
    ])
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "clickq");
    await advance(t, SETTLE_MS);
    assert.equal(list.children.length, 1);
    // Simulate the real DOM's event delegation: click bubbles up from the
    // <li> to the <ul> listener with event.target set to the <li>. The
    // fake DOM (test-helpers.mjs) doesn't implement bubbling itself, so we
    // dispatch directly on the delegating element with an explicit target.
    list.dispatchEvent({ type: "click", target: list.children[0] });
  } finally {
    restore();
  }

  const [pin] = pinStore.listPins();
  assert.equal(pin.name, "ClickCity");
  assert.equal(pin.color, "#e63946"); // DEFAULT_PIN_COLOR
});

test("a click that doesn't land on a .search__row is ignored", async (t) => {
  const { input, list } = setupDom();
  initSearch();

  const restore = mockFetch(() =>
    jsonResponse([nominatimResult({ displayName: "Ignoreme, Country", lat: 17, lon: 18 })])
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    typeQuery(input, "ignoreq");
    await advance(t, SETTLE_MS);
    const before = pinStore.listPins().length;
    // Dispatch directly on the <ul> with no matching row target.
    list.dispatchEvent({ type: "click", target: list });
    assert.equal(pinStore.listPins().length, before);
  } finally {
    restore();
  }
});

test("Enter with an empty/hidden dropdown does nothing", async () => {
  const { input } = setupDom();
  initSearch();
  const before = pinStore.listPins().length;
  input.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.equal(pinStore.listPins().length, before);
});

// ── __internals sanity ────────────────────────────────────────────────────

test("__internals exposes the module's tuning constants", () => {
  assert.equal(__internals.DEFAULT_PIN_COLOR, "#e63946");
  assert.equal(__internals.DEBOUNCE_MS, 350);
  assert.equal(__internals.MIN_QUERY_LEN, 2);
});
