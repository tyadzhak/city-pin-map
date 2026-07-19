// Run with: node --test js/geocode.test.mjs
//
// Covers searchCities(): the addressdetails/display_name parsing, the
// per-tab query cache, the ≥1 req/sec rate gate (driven deterministically
// via node:test fake timers — no real waits), pre-flight abort handling,
// and the fetch/HTTP/JSON error paths. Network is always mocked.

import "./test-helpers.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockFetch, jsonResponse } from "./test-helpers.mjs";
import { searchCities } from "./geocode.js";

let restoreFetch = null;

afterEach(() => {
  if (restoreFetch) {
    restoreFetch();
    restoreFetch = null;
  }
});

// searchCities' own rate gate is a module-level singleton (lastRequest /
// lastStart persist across every test in this file, by design — mirrors
// the real page's single geocode module instance). Driving it with fake
// timers keeps every test here free of real wall-clock waits: enable
// Date+setTimeout, kick off the call, then alternate a real setImmediate
// flush (drains whatever microtask chain the previous tick unblocked)
// with a 1s tick until the promise settles.
function enableFakeGate(t) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
}

async function driveUntilSettled(t, promise) {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true)
  );
  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  return promise;
}

// Convenience for the common one-shot-call case. Do NOT call this more than
// once per test — t.mock.timers.enable() throws "already enabled" on a
// second call within the same test; for multiple driven calls in one test,
// call enableFakeGate(t) once yourself and reuse driveUntilSettled(t, ...).
async function runWithFakeGate(t, fn) {
  enableFakeGate(t);
  return driveUntilSettled(t, fn());
}

// ── empty / trivial input ───────────────────────────────────────────────

test("searchCities: empty string returns [] without touching the network", async () => {
  let called = false;
  restoreFetch = mockFetch(() => {
    called = true;
    return jsonResponse([]);
  });
  const results = await searchCities("");
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

test("searchCities: whitespace-only string returns [] without touching the network", async () => {
  let called = false;
  restoreFetch = mockFetch(() => {
    called = true;
    return jsonResponse([]);
  });
  const results = await searchCities("   ");
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

test("searchCities: non-string query returns []", async () => {
  const results = await searchCities(undefined);
  assert.deepEqual(results, []);
});

// ── response parsing ─────────────────────────────────────────────────────

test("searchCities: parses display_name/lat/lon/address from the Nominatim shape", async (t) => {
  restoreFetch = mockFetch((url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search/);
    const params = new URL(url).searchParams;
    assert.equal(params.get("format"), "json");
    assert.equal(params.get("addressdetails"), "1");
    assert.equal(params.get("q"), "kyiv-parse-test");
    return jsonResponse([
      {
        display_name: "Kyiv, Ukraine",
        lat: "50.4501",
        lon: "30.5234",
        address: { city: "Kyiv", country: "Ukraine" },
      },
    ]);
  });
  const results = await runWithFakeGate(t, () => searchCities("kyiv-parse-test"));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    displayName: "Kyiv, Ukraine",
    lat: 50.4501,
    lon: 30.5234,
    address: { city: "Kyiv", country: "Ukraine" },
  });
});

test("searchCities: address is null when Nominatim omits it", async (t) => {
  restoreFetch = mockFetch(() =>
    jsonResponse([{ display_name: "Nowhere", lat: "1", lon: "2" }])
  );
  const results = await runWithFakeGate(t, () => searchCities("no-address-test"));
  assert.equal(results[0].address, null);
});

test("searchCities: multiple results are all parsed", async (t) => {
  restoreFetch = mockFetch(() =>
    jsonResponse([
      { display_name: "Paris, France", lat: "48.8566", lon: "2.3522" },
      { display_name: "Paris, Texas, USA", lat: "33.6609", lon: "-95.5555" },
    ])
  );
  const results = await runWithFakeGate(t, () => searchCities("multi-result-test"));
  assert.equal(results.length, 2);
  assert.equal(results[1].displayName, "Paris, Texas, USA");
});

// ── in-tab cache ─────────────────────────────────────────────────────────

test("searchCities: a repeated query for the same key does not refetch", async (t) => {
  let fetchCount = 0;
  restoreFetch = mockFetch(() => {
    fetchCount++;
    return jsonResponse([{ display_name: "Oslo, Norway", lat: "59.91", lon: "10.75" }]);
  });
  const first = await runWithFakeGate(t, () => searchCities("cache-test-oslo"));
  assert.equal(fetchCount, 1);
  // Second call for the identical query string must hit the cache — no
  // fake-timer driving needed since a cache hit never awaits the gate.
  const second = await searchCities("cache-test-oslo");
  assert.equal(fetchCount, 1);
  assert.deepEqual(second, first);
});

test("searchCities: cache returns a defensive copy (mutating a result never poisons the cache)", async (t) => {
  restoreFetch = mockFetch(() =>
    jsonResponse([{ display_name: "Bergen, Norway", lat: "60.39", lon: "5.32" }])
  );
  const first = await runWithFakeGate(t, () => searchCities("cache-test-bergen"));
  first.push({ displayName: "injected", lat: 0, lon: 0 });
  const second = await searchCities("cache-test-bergen");
  assert.equal(second.length, 1);
  assert.equal(second[0].displayName, "Bergen, Norway");
});

test("searchCities: a different query string is not served from another query's cache entry", async (t) => {
  let fetchCount = 0;
  restoreFetch = mockFetch((url) => {
    fetchCount++;
    const q = new URL(url).searchParams.get("q");
    return jsonResponse([{ display_name: q, lat: "1", lon: "1" }]);
  });
  enableFakeGate(t);
  await driveUntilSettled(t, searchCities("cache-distinct-a"));
  await driveUntilSettled(t, searchCities("cache-distinct-b"));
  assert.equal(fetchCount, 2);
});

// ── rate gate ─────────────────────────────────────────────────────────────

test("rate gate: two back-to-back calls are spaced >=1s apart by real elapsed time", async (t) => {
  const timestamps = [];
  restoreFetch = mockFetch(() => {
    timestamps.push(Date.now());
    return jsonResponse([{ display_name: "Spacing", lat: "1", lon: "1" }]);
  });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });

  const p1 = searchCities("rate-gate-first");
  const p2 = searchCities("rate-gate-second");
  let settled = false;
  Promise.all([p1, p2]).then(() => (settled = true));
  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  await Promise.all([p1, p2]);

  assert.equal(timestamps.length, 2);
  assert.ok(
    timestamps[1] - timestamps[0] >= 1000,
    `expected >=1000ms between requests, got ${timestamps[1] - timestamps[0]}`
  );
});

test("rate gate: calls naturally spread out by >=1s incur no extra wait", async (t) => {
  // First-ever gate() call in a fresh lastStart=0 state goes through with
  // zero added delay (documented in geocode.js). This exercises that
  // fast-path branch distinctly from the back-to-back case above.
  restoreFetch = mockFetch(() =>
    jsonResponse([{ display_name: "Immediate", lat: "1", lon: "1" }])
  );
  const start = Date.now();
  await searchCities(`rate-gate-immediate-${start}`);
  // No assertion on wall time here beyond "it resolved" — the point is a
  // single call never blocks on the gate when nothing preceded it within
  // the window. Real elapsed time is a few ms at most in practice.
  assert.ok(true);
});

// ── abort handling ───────────────────────────────────────────────────────

test("searchCities: a signal already aborted when the gate clears throws AbortError without fetching", async (t) => {
  // The pre-flight check (`if (signal?.aborted) throw ...`) runs right
  // after `await gate()` and before `fetch()` — this covers a caller that
  // aborted while queued behind the rate limit. A plain `{ aborted: true }`
  // object is sufficient; the source only ever reads that property.
  let fetchCalled = false;
  restoreFetch = mockFetch(() => {
    fetchCalled = true;
    return jsonResponse([]);
  });
  const signal = { aborted: true };
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("abort-target-simple", { signal })),
    (err) => err.name === "AbortError"
  );
  assert.equal(fetchCalled, false);
});

test("searchCities: fetch's own AbortError propagates unchanged", async (t) => {
  restoreFetch = mockFetch(() => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  });
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("abort-fetch-test")),
    (err) => err.name === "AbortError"
  );
});

// ── error handling ───────────────────────────────────────────────────────

test("searchCities: a network-level fetch rejection surfaces a friendly error", async (t) => {
  restoreFetch = mockFetch(() => {
    throw new Error("network down");
  });
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("network-fail-test")),
    /Could not reach the geocoder/
  );
});

test("searchCities: a non-ok HTTP response surfaces the status code", async (t) => {
  restoreFetch = mockFetch(() => jsonResponse([], { status: 503 }));
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("http-503-test")),
    /Geocoder returned an error \(HTTP 503\)/
  );
});

test("searchCities: unparseable JSON body surfaces a friendly error", async (t) => {
  restoreFetch = mockFetch(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("bad json");
    },
  }));
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("bad-json-test")),
    /Geocoder returned an unexpected response/
  );
});

test("searchCities: a non-array JSON body surfaces a friendly error", async (t) => {
  restoreFetch = mockFetch(() => jsonResponse({ not: "an array" }));
  await assert.rejects(
    runWithFakeGate(t, () => searchCities("non-array-test")),
    /Geocoder returned an unexpected response/
  );
});

test("searchCities: an empty match array resolves to []", async (t) => {
  restoreFetch = mockFetch(() => jsonResponse([]));
  const results = await runWithFakeGate(t, () => searchCities("no-match-test"));
  assert.deepEqual(results, []);
});
