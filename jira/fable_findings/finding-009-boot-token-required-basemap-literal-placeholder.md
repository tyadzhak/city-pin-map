# FBL-009: Boot with a persisted token-required basemap uses the literal `{api_key}` placeholder

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-009`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Critical`                                  |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | None                                        |

## Summary

`initMap()` passes the persisted style's raw `style` value straight into `new maplibregl.Map(...)` without ever calling `resolveStyleUrl(entry)`. For token-required providers (MapTiler, Stadia, Thunderforest), the stored style URL still contains the literal placeholder token (e.g. `"...style.json?key={api_key}"`); only the runtime swap path (`setMapStyle` → `resolveStyleUrl`, map.js:719) substitutes the real key. A user who sets a valid key, picks a token-required style (works fine at runtime), and reloads the page boots straight into a request for a URL containing `{api_key}` literally.

## Context

**Files:** `js/map.js`, `js/app.js`

- `js/map.js:431-437` — `initMap` passes `style: initial.style` verbatim to the MapLibre constructor; no call to `resolveStyleUrl(entry)`.
- `js/map.js:156` — token styles are stored as e.g. `"...style.json?key={api_key}"`, expecting substitution before use.
- `js/app.js:63-76` — keeps the persisted style id as `initialStyleId` whenever the provider is unlocked (`isProviderUnlocked` is true for any non-empty key, `settings.js:70-73`), so this path is reached for any user who has ever set a key.
- `js/map.js:719` — contrast: the runtime swap path (`setMapStyle`) does resolve via `resolveStyleUrl` before applying a style.

## Failure scenario

User sets a valid MapTiler key, picks a MapTiler style (works at runtime), reloads the page. Boot fetches `…?key={api_key}` literally → 403 → the style never loads → the MapLibre `load` event never fires → blank map, no pins rendered, no error banner shown to the user.

## Fix direction

Route the initial style through `resolveStyleUrl(initial)` in `initMap` (mirroring what `setMapStyle` already does), and/or perform the first render via the same resilient `setMapStyle` pipeline instead of handing the raw constructor a possibly-templated style URL.

## Acceptance criteria

- [~] Reloading the app with a valid API key and a persisted token-required style boots into a correctly rendered map (no literal `{api_key}` in any request). — Addressed in code (initMap now resolves `{api_key}` before the constructor); runtime-only to confirm no literal placeholder is fetched.
- [x] `initMap`'s initial style resolution shares the substitution logic with `setMapStyle` (`resolveStyleUrl`), not a second hand-rolled path.
- [x] Boot with a keyless/default style (the common case) is unaffected — no added latency or behavior change. (`resolveStyleUrl` returns the entry's string URL verbatim when no token is required — a cheap synchronous no-op.)
- [x] No regression to the runtime style-swap pipeline (`setMapStyle`, style picker) described in the evidence above. (Change is confined to `initMap`; `setMapStyle`/picker untouched.)
- [x] `node --check` passes on all changed modules. (`js/map.js` — passed.)
- [~] No errors in the browser console. — Runtime-only; not verifiable statically.

## Files affected

```
~ js/map.js
~ js/app.js
```

## Notes

Review id: F1. First in the strict fix order (see `tmp/confirmed-findings.md`) — FBL-010 (F6) touches the same files and must land after this one. Filed from a coordinator-verified full-app review, 2026-07-18. Raw dossier: `tmp/stage1-dossiers.md`.
