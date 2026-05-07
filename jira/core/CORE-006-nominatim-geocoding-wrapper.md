# CORE-006: Nominatim geocoding wrapper

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-006`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-001`                                  |

## Summary

Implement `js/geocode.js` — a debounced, rate-limited wrapper around the Nominatim search API that returns city candidates for a query string. This is the data layer beneath the search UI built in CORE-007.

## Context

`CLAUDE.md` → "Hard rules" requires respecting Nominatim's policy: max 1 request per second, send a meaningful `User-Agent` or `Referer`, debounce search input. `PROJECT.md` → "Risks and mitigations" calls out rate-limiting and asks for cached recent queries plus clear errors.

Splitting the wrapper from the UI lets the UI task focus on input handling and rendering candidates without re-implementing rate-limit logic.

## Acceptance criteria

- [x] `js/geocode.js` exports a `searchCities(query)` async function that returns an array of result objects: `{ displayName, lat, lon }` (lat/lon are numbers).
- [x] Calling `searchCities` more than once per second from the same code path enforces a minimum 1-second gap by queueing — no two outbound requests are ever <1000 ms apart.
- [x] Calling `searchCities` with the same query twice in a row returns the cached result without a second network request (within a single session).
- [x] An empty or whitespace-only query resolves to `[]` immediately, with no network request.
- [x] An aborted-or-superseded query (a newer call before the previous resolved) does not produce stale UI updates — the wrapper supports cancellation, e.g. via `AbortSignal`.
- [x] On network failure or non-2xx response, the function rejects with an `Error` carrying a human-readable message; it does not silently swallow.
- [x] Outbound requests include a `User-Agent` substitute appropriate for browser fetch (the `Referer` header set by the browser is sufficient per Nominatim policy — verify a meaningful one is present, or document why this is acceptable).
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console under normal operation.

## Files affected

```
~ js/geocode.js
```

## Out of scope

- No UI in this task — that's CORE-007.
- No persistent (cross-session) cache — in-memory cache for the session is enough.
- No reverse geocoding (lat/lon → name) — Core only needs forward geocoding.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Pay especially close attention to CLAUDE.md → "Hard rules" (Nominatim 1-req/sec policy, debounce, User-Agent/Referer) and PROJECT.md → "Risks and mitigations" (cache + clear errors).

Task: Implement js/geocode.js with a debounced, rate-limited, cancellable wrapper around https://nominatim.openstreetmap.org/search.

Requirements:
- Export `searchCities(query, { signal? } = {})` that returns `Promise<Array<{ displayName, lat, lon }>>`.
- Endpoint: `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=<encoded query>`. Add `&accept-language=en` for stable display names.
- Rate-limit gate: a module-scoped promise chain that ensures at least 1000 ms between outbound fetches, regardless of caller frequency. Use a serial queue, e.g. `lastRequest = lastRequest.then(...).then(() => fetch(...))`, padded with a `setTimeout` if needed.
- In-session cache: a `Map<query, results>` that bypasses the network on exact matches.
- Cancellation: accept an optional `AbortSignal`; pass it through to `fetch`. When aborted, throw a `DOMException('aborted', 'AbortError')` so callers can detect and ignore.
- Empty/whitespace input shortcut: if `query.trim() === ''`, return `[]` synchronously (well, via `Promise.resolve`), no fetch, no rate-limit consumption.
- On error (network failure, non-2xx, parse failure), throw an `Error` with a user-friendly message. Use the `showError` helper introduced in CORE-004 if you want to surface it directly, but prefer to let CORE-007 (the UI layer) handle presentation.
- Map response objects to `{ displayName: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon) }`.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks, no paid APIs).
- Browsers do not allow setting User-Agent from JavaScript; rely on the default Referer header. Add a top-of-file comment noting this and confirming compliance with Nominatim policy. If the policy seems ambiguous, document the assumption made.
- Do not introduce a new CDN library for HTTP — `fetch` is enough.
- Debouncing is the UI's responsibility (CORE-007); this module enforces the *rate limit*. Don't conflate the two.

Deliverables:
- js/geocode.js exporting `searchCities`.

Verification:
- From the browser console, call `searchCities('Tokyo')` — it returns several results with `displayName`, `lat`, `lon`.
- Call `searchCities('Tokyo')` again — second call resolves instantly from cache (verify via Network tab: no second request).
- Fire `searchCities('Lisbon'); searchCities('Madrid'); searchCities('Paris')` in quick succession — Network tab shows requests separated by ≥1000 ms.
- Pass an `AbortController().signal`, abort it, confirm the promise rejects with an AbortError.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Browsers strip custom `User-Agent` headers from `fetch` calls — that's a security feature, not a bug. Nominatim's policy explicitly accepts a meaningful `Referer` for browser apps, which the browser sets automatically when the page is hosted on a domain. For local file:// loads the Referer is empty, which is fine for personal-scale dev usage — note this in a code comment.
