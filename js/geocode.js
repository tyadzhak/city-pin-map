// Nominatim geocoding wrapper.
//
// CLAUDE.md → "Hard rules": ≤ 1 request per second to nominatim.openstreetmap.org,
// and a meaningful User-Agent or Referer must be sent.
//
// Browsers DO NOT allow setting the User-Agent header from page JavaScript
// — it's on the fetch spec's forbidden-header list. Nominatim's policy
// explicitly accepts the Referer header as the alternative identifier for
// browser apps, and the browser sets Referer automatically whenever the
// page is served over http(s). This satisfies the policy for any normal
// hosting (`python -m http.server`, GitHub Pages, etc.). When the page is
// opened as `file://` the Referer is empty — that's fine for personal-scale
// local development, which is the explicit use case in PROJECT.md.
//
// Debouncing is the UI's responsibility (CORE-007). This module enforces
// the rate limit only — every outbound request is at least RATE_LIMIT_MS
// after the previous one, regardless of how aggressively callers fire.

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const RATE_LIMIT_MS = 1000;

// Per-tab cache: query string → result array. Skips the network on exact
// repeat queries within a session. No expiration — the page lifetime is
// the cache lifetime, which keeps the implementation tiny and avoids any
// quota concerns.
const cache = new Map();

// Serial promise chain that enforces RATE_LIMIT_MS between outbound fetches.
// Every searchCities() awaits gate() before issuing fetch(); the chain
// guarantees requests run one at a time, ≥ RATE_LIMIT_MS apart.
//
// `lastRequest` is the tail of the chain; new callers attach their wait
// to it and replace it with their own promise.
let lastRequest = Promise.resolve();
// Timestamp of the most recent fetch start, used by gate() to compute the
// remaining wait. 0 means "no fetch yet" so the first call goes immediately.
let lastStart = 0;

/**
 * Awaits the rate-limit gate. Resolves when the caller is allowed to issue
 * exactly one fetch. Serializes callers via the lastRequest chain and
 * spaces them by RATE_LIMIT_MS using lastStart — when calls are naturally
 * spread out, no artificial wait is added; the very first call (lastStart
 * === 0) goes through with zero delay.
 */
function gate() {
  const next = lastRequest.then(async () => {
    const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastStart));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
  });
  lastRequest = next;
  return next;
}

/**
 * Search for cities matching `query` via Nominatim.
 *
 * @param {string} query - User-entered text. Empty/whitespace returns [].
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{ displayName: string, lat: number, lon: number, address: object | null }>>}
 */
export async function searchCities(query, { signal } = {}) {
  if (typeof query !== "string" || query.trim() === "") {
    return [];
  }

  const cached = cache.get(query);
  if (cached) return cached.slice();

  await gate();

  // The caller may have aborted while we were queued. fetch(signal) handles
  // mid-flight aborts; this handles pre-flight aborts that happened during
  // the rate-limit wait.
  if (signal?.aborted) {
    throw new DOMException("aborted", "AbortError");
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");
  url.searchParams.set("accept-language", "en");
  // addressdetails=1 makes Nominatim return a structured `address` object
  // (city/town/village/country/etc.) alongside the flat display_name.
  // search.js → shortName() uses this to default new pin names to a
  // city-only short form. Single extra response field — no extra request.
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);

  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new Error(
      "Could not reach the geocoder. Check your connection and try again."
    );
  }

  if (!res.ok) {
    throw new Error(
      `Geocoder returned an error (HTTP ${res.status}). Please try again.`
    );
  }

  let raw;
  try {
    raw = await res.json();
  } catch {
    throw new Error("Geocoder returned an unexpected response.");
  }
  if (!Array.isArray(raw)) {
    throw new Error("Geocoder returned an unexpected response.");
  }

  const results = raw.map((r) => ({
    displayName: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    // Raw address object as Nominatim returned it. Keys vary by place type
    // (city / town / village / hamlet / country / …). Callers should treat
    // every key as optional. `null` when Nominatim didn't include `address`.
    address: r.address ?? null,
  }));

  cache.set(query, results);
  // Return a defensive copy so a caller mutating the array (e.g. .sort())
  // doesn't poison subsequent cache hits.
  return results.slice();
}
