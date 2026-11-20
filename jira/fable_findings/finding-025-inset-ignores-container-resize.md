# FBL-025: Inset box never re-docks or resizes when the map container changes size

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-025`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

`js/map-inset.js` observed its own overlay with a `ResizeObserver`, but `applyPlacement()` writes fixed px `width`/`height` onto that overlay, so the observer never fired when the `#map` container changed size. The dock/clamp math (which reads the container's current size) was therefore never re-run on a container resize: on screen the box kept its stale x and width, and on export `getResolvedPlacement()` (computed fresh from the preset-sized container) disagreed with the inset canvas, which was still sized for the live box.

## Context

**Files:** `js/map-inset.js`, `js/export.js`

- `js/map-inset.js` `init()` — `ResizeObserver` on `overlay` (a box whose size this module itself writes in px).
- `js/map-inset.js` `applyPlacement()` / `resolvePlacement()` — placement derived from the container's `clientWidth`/`clientHeight`.
- `js/export.js` `captureFramed()` — resizes `#map` to the preset dims, then only called `insetMap.resize()` (a no-op for the canvas, since the overlay was never re-sized).
- Container-size changes that were missed: the export-size letterbox (`js/map-viewport.js`), window / side-panel resize, and `captureFramed()`'s off-screen resize.

## Failure scenario

- **On screen:** pick "A4 portrait" with the inset docked top-right. `#map` shrinks/letterboxes, the box keeps its old x and width and sticks out past the map edge, clipped.
- **On export:** at 1920 px wide `getResolvedPlacement()` reports a roughly 610 px box, but the inset canvas is still the roughly 290 px live size; `paintInset()` stretches it into the larger rect and the inset's pin labels sit at small-box coordinates, away from their pins.

## Fix direction

React to MAIN-container size changes rather than overlay size changes, and make the export re-place the box explicitly after resizing `#map`.

## Resolution

- `js/map-inset.js`: replaced the overlay `ResizeObserver` with a listener on the main map's `resize` event (MapLibre fires it for its own async container observer and synchronously for an explicit `map.resize()`). The handler is a new exported `relayoutInset()` that re-runs `applyPlacement`, `insetMap.resize()`, `fitInset(boundsInUse)` and `refreshLocator()`, honouring the existing `boxDragging` guard. The overlay observer was removed rather than kept: every overlay-size change already goes through `update()`/`refreshPlacement()`, so a second path would only duplicate work.
- `js/export.js`: `captureFramed()` calls `relayoutInset()` after resizing `#map` and before waiting on the inset map (replacing the bare `insetMap.resize()`), and again in the `finally` restore path (replacing the bare resize) so the live box returns to its on-screen geometry. The existing idle wait and the loud-timeout contract are unchanged.

## Acceptance criteria

- [x] After selecting a non-"current" export preset (or resizing the window/side panel), the live inset box is re-docked inside `#map` with width tracking `sizePct` of the new width. *(Runtime-only to fully confirm; by construction: the main map's `resize` event now drives `relayoutInset()` -> `applyPlacement()`, which reads the container's current size.)*
- [x] On export at any preset, the inset canvas CSS size equals the `getResolvedPlacement()` box and its labels line up with their pins. *(Runtime-only to fully confirm; by construction: `captureFramed()` calls `relayoutInset()` after the container resize, so `applyPlacement` + `insetMap.resize()` run before the idle wait and before `getResolvedPlacement()` is read.)*
- [x] After a capture, the live inset re-places correctly at the restored `#map` size. *(Runtime-only; the `finally` restore calls `relayoutInset()` after the inline styles are restored, and `mapInstance.resize()` also fires the same handler.)*
- [x] No box-drag regression and no competing resize paths. *(`relayoutInset()` skips placement/refit while `boxDragging`, like the old observer; the overlay observer is removed.)*
- [x] Export still fails loudly if the inset does not settle. *(`waitForIdle` timeout throw untouched.)*
- [x] `node --check` passes on all changed modules. *(`js/map-inset.js`, `js/export.js` clean.)*
- [ ] No errors in the browser console. *(Runtime-only; not verifiable statically.)*

## Files affected

```
~ js/map-inset.js
~ js/export.js
```

## Notes

Review id: FBL-025. Filed from a confirmed finding, no needs-review caveat; the fix is only fully verifiable in a browser (see the headless Playwright scenario handed to the verifier).
