# FBL-010: First-load style failure is silent; render state is marked "confirmed" before any load evidence

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-010`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S` (≤1h)                                   |
| **Depends on**  | `FBL-009` (same files: `js/map.js`, `js/app.js`) |

## Summary

`initMap` seeds `currentRenderedStyleId = initial.id` unconditionally at boot, and registers only `load`/`styledata` listeners — there is no `error` listener and no timeout guard on the initial load, unlike the racing pattern `setMapStyle` already uses for runtime swaps. If the default/persisted style host is unreachable at boot, the map fails silently: no banner, and `currentRenderedStyleId` already claims the never-rendered style "succeeded", so a later failed swap "reverts" to a style that was never actually confirmed.

## Context

**Files:** `js/map.js` (same area as FBL-009 — fix immediately after it)

- `js/map.js:442` — `currentRenderedStyleId = initial.id` is set unconditionally, before `load`/`styledata` fire.
- `js/map.js:789-867` — contrast: `setMapStyle`'s runtime swap races `styledata` (success) vs. `error` (failure) with a 5s timeout; `initMap`'s boot path has no equivalent guard.

## Failure scenario

Default style host is unreachable at boot → blank map, no banner, no way for the user to know why. A later failed style swap reverts to this boot style, which was itself never confirmed to have rendered — reverting to a broken state rather than a known-good one.

## Fix direction

Add a one-shot error/timeout guard on the initial load that surfaces `showError()` on failure, mirroring `setMapStyle`'s race. Only mark the style as rendered once `styledata`/tiles actually confirm. This may fall out naturally if FBL-009's fix routes the initial boot through the existing `setMapStyle` pipeline instead of a separate hand-rolled path.

## Acceptance criteria

- [x] Boot with an unreachable default/persisted style surfaces a visible error banner instead of failing silently. — implemented via the new boot guard: vector `error`, raster tile `error`, and a `STYLE_LOAD_TIMEOUT_MS` timeout all route to `failBoot()` → `showError()`. Message reuses `buildStyleErrorMessage()` (key/quota specifics), names the failing style (`initial.label`), and points to the style picker. Full "banner visibly appears" verification is runtime-only (requires an actually-unreachable host).
- [x] `currentRenderedStyleId` is only marked rendered after `load`/`styledata`/tile evidence confirms success — not unconditionally at boot. — the unconditional seed was removed; the assignment now lives only inside `confirmBoot()`, called from vector `styledata` or a confirmed raster tile-load `data` event (statically verifiable).
- [x] A later failed runtime swap reverts to a style that was itself confirmed to have rendered, not an unconfirmed boot guess. — `currentRenderedStyleId` stays `null` until the boot render is confirmed, so `setMapStyle`'s `previousId = currentRenderedStyleId ?? DEFAULT_MAP_STYLE_ID` falls back to the keyless default (never an unconfirmed boot id) when boot never rendered (statically verifiable).
- [x] No regression to the normal boot path (successful default style load) — no added flicker or delay. — the guard adds only passive event listeners + a timeout; no synchronous work, no extra `setStyle`. On success `confirmBoot()` fires on the first `styledata` and is a no-op beyond the existing seed. Registration order (boot `styledata` before the `applyLabelVisibility` `styledata`) preserves the original raster-check guarantee. Absence of visible flicker is runtime-only.
- [x] `node --check` passes on all changed modules. — `node --check js/map.js` passed (no output).
- [ ] No errors in the browser console. — runtime-only; not verified in this static pass.

## Files affected

```
~ js/map.js
```

## Notes

Review id: F6. Must land after FBL-009 — same file (`js/map.js`), same area of code. Filed from a coordinator-verified full-app review, 2026-07-18.
