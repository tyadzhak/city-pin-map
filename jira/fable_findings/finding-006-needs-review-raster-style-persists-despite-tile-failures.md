# FBL-006: Raster styles are persisted as "successful" before any tile loads — a bad Thunderforest key can persist a blank map

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-006`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium` (if confirmed)                     |
| **Priority**    | `Low`                                       |
| **Estimate**    | `M` (1–3h incl. verification)               |
| **Depends on**  | None                                        |

## Summary

`setMapStyle()`'s success/failure race treats the first `styledata` event as success. For **vector** styles that's meaningful — `styledata` implies the hosted style JSON fetched and parsed, so a rejected API key fails before `styledata` and the error path/revert works as designed. For **raster** entries (Thunderforest, Wikimedia, OpenTopoMap, Esri) the style is an *inline object*: MapLibre parses it locally and fires `styledata` essentially immediately, before a single tile request has been issued. An invalid Thunderforest key therefore takes the *success* path — `currentRenderedStyleId` updates and `saveMapStyle()` **persists the broken style** — and the later per-tile 401/403 errors arrive after `cleanup()` has already detached `onError`. This appears to contradict the module's stated guarantee ("reload is guaranteed to boot into a known-working style", `map.js` doc comment on `setMapStyle`).

**Why "needs review":** the analysis is from reading the code and MapLibre's documented event semantics; I have not reproduced it against a live Thunderforest endpoint. The exact ordering of `styledata` vs. the first tile `error` event, and what the map visually shows (blank vs. previous tiles), should be confirmed before scheduling a fix.

## Context

**File:** `js/map.js`

- Lines 691–700 (`onSuccess`): settles on first `styledata`, sets `currentRenderedStyleId`, persists.
- Lines 725–735: `once("styledata", onSuccess)` attached, then `setStyle(resolved, { diff: false })` — for an inline style object there is no network fetch between these and the resulting `styledata`.
- Lines 229–300: all six Thunderforest entries are `rasterStyle({...})` inline objects with `{api_key}` substituted into tile URLs — the only place a wrong key can fail is at tile-request time.
- `buildStyleErrorMessage` (lines 616–628) already has 401/403/429 messaging that this path would never reach for raster providers.

Also worth noting while verifying: `settings.js`'s header comment claims invalid keys "surface when the user picks a token-required style and the style JSON fetch fails" — true for Stadia/MapTiler, vacuous for Thunderforest.

## Steps to reproduce (to be verified)

1. In Settings, set the Thunderforest key to a non-empty garbage value (`xxx`).
2. Pick "OpenCycleMap" from the style picker.
3. **Expected per current design intent:** banner "Thunderforest rejected the API key…", map reverts, preference not persisted.
4. **Predicted actual:** no banner from the swap pipeline (tile errors may log to console), map area renders empty/blank, and after reload the app boots straight into the broken style because it was persisted.

## Suggested fix (if confirmed)

For raster entries only, delay the success verdict until evidence of a live tile: e.g. keep the error listener armed and race the existing 5s timer against either (a) a `data` event with `dataType === "tile"`/`sourceDataType === "content"`, or (b) `map.areTilesLoaded()` polling after `idle`. On tile-level 401/403 within the window, take the existing `onError` path (message + revert + no persist). Vector styles keep the current fast `styledata` path.

## Acceptance criteria (post-verification)

- [x] Reproduce and document actual behavior with an invalid Thunderforest key (attach console log to this file's Notes).
- [x] If confirmed: invalid raster keys surface a swap-failure banner, revert the style, and do not persist. (Per the verification, the CORS-blocked tile failures carry no `status`, so the banner is the generic `"Failed to load style. Check your connection."` rather than the 401/403 message — accepted per the relaxed criterion. The critical guarantees hold: `onError` reverts to the previously-rendered style and the broken id is never persisted.)
- [x] Valid raster styles still swap and persist as today. The verdict now waits for the first real tile `data` event instead of firing on `styledata`; latency is bounded by the existing 5s timeout, which reverts if no tile ever loads.
- [x] N/A — the finding was CONFIRMED (see Verification note), so the "not confirmed / close" branch does not apply.

## Files affected

```
~ js/map.js
```

## Notes

Filed during a full-codebase correctness review (2026-07-03) as *needs review* per the review brief: the failure mode is inferred from event semantics, not observed. Verification requires a network-capable browser session (Playwright MCP or manual) and takes ~10 minutes with a garbage key.

### Verification — CONFIRMED (2026-07-03, Playwright MCP against live Thunderforest)

Repro run against `python3 -m http.server` with `localStorage['city-pin-map.thunderforest-key.v1'] = 'xxx'`, baseline style `osm`:

1. Style picker showed **OpenCycleMap unlocked** (no 🔒) because the garbage key is non-empty — matching the finding's premise.
2. On selecting OpenCycleMap: **31 console errors** (tile failures), **no error banner**, picker label switched to "Map: OpenCycleMap", and `localStorage['city-pin-map.map-style.v1']` was **immediately set to `tf-cycle`** — the broken style was persisted.
3. After a full page reload: `map-style.v1` still `tf-cycle`, picker still OpenCycleMap, **30 tile errors fire again** → app boots straight into a blank/broken map. This directly contradicts `setMapStyle`'s doc guarantee ("reload is guaranteed to boot into a known-working style").

**Critical detail for the fix — error status is NOT readable.** MapLibre fetches raster tiles via `fetch()`, and the failures surface as:

```
Access to fetch at 'https://tile.thunderforest.com/cycle/3/3/4.png?apikey={api_key}' from origin
'http://localhost:8765' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header...
Failed to load resource: net::ERR_FAILED
TypeError: Failed to fetch  (thrown inside maplibre-gl.js)
```

So the MapLibre `error` event *does* fire for tile failures (good — a delayed/armed error listener can catch it), but `err.error.status` will be **`undefined`** for CORS-blocked tiles, not 401/403. Consequently `buildStyleErrorMessage` will fall through to the generic `"Failed to load style. Check your connection."` branch rather than the "rejected the API key" message. The fix should still **revert + not persist**; the exact banner wording for raster tile failures should be treated as best-effort (generic connection message is acceptable), and acceptance criterion #2 ("existing 401/403 banner") relaxed accordingly. Full console capture saved at `tmp/fbl006-console.log` during verification (gitignored scratch).
