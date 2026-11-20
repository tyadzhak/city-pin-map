# FBL-032: On-map title's on-screen position disagrees with its saved/exported anchor after a drag past the edge

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-032`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Minor`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S` (<1h)                                   |
| **Depends on**  | None                                        |

## Summary

On drag release and on keyboard nudge, `js/map-title.js` stores the new anchor clamped to `[0,1]` (`nx`/`ny`) but moves the overlay to the UNCLAMPED pixel position. A title dropped partly past the map edge therefore stays half off-screen while the persisted and exported anchor is the edge, so the live view and the PNG disagree until the next resize/reproject snaps it back.

## Context

**Files:** `js/map-title.js`

- `onPointerUp` — computed `newCenterX/newCenterY` from the cursor, stored `clamp01(newCenterX / w)` into `position`, then called `applyTransform(newCenterX, newCenterY)` with the raw values.
- `onKeyDown` — same pattern: `position` clamped, `applyTransform(newX, newY)` with the raw `nx*w + dx`. At an edge, each arrow press pushed the overlay 1-10 px past the clamped anchor.
- `reproject()` already derives pixels from the stored anchor (`position.nx * w`, `position.ny * h`) and is the module's single anchor-to-px path (also used by `update()`, `recenterX()` and the map `resize` handler). The mid-drag `onPointerMove` path is intentionally pixel-driven and unchanged.

## Failure scenario

The user drags the title so its center ends past the right edge and releases. The saved anchor is `nx = 1` and the PNG draws the title centered on the edge, but on screen the overlay stays where it was dropped, partly clipped off the map, until a window resize or letterbox change re-pins it. The same happens by 1-10 px per arrow press when nudging at an edge.

## Fix direction

After updating `position`, place the overlay from the clamped anchor by calling `reproject()` instead of `applyTransform(rawX, rawY)`, in both the drag-release and keyboard-nudge paths. This keeps one source of truth for anchor to pixels.

## Acceptance criteria

- [x] After dragging the title past an edge and releasing, the overlay snaps to the clamped anchor (center on the edge) and matches the saved/exported position. *(Runtime-only to fully confirm; by construction `onPointerUp` now calls `reproject()`, which reads the just-clamped `position.nx/ny`. `dragging` is already false at that point so `reproject()` is not short-circuited.)*
- [x] Keyboard nudging at an edge no longer pushes the overlay past the clamped anchor. *(Runtime-only to fully confirm; `onKeyDown` now calls `reproject()` after clamping.)*
- [x] No regression for in-bounds drags and nudges. *(For in-bounds positions the clamped anchor equals the raw pixel / container size, so `reproject()` yields the same transform as before; container size comes from `clientWidth/clientHeight` vs the pointer path's `getBoundingClientRect()`, identical for the untransformed `#map`.)*
- [x] Other paths with the same pattern checked. *(`update()` and `recenterX()` already go through `reproject()`; `onPointerMove` is the deliberate pixel-driven mid-drag path and is superseded on release. No other `applyTransform` callers.)*
- [x] `node --check js/map-title.js` passes and `node --test js/*.test.mjs` passes.
- [ ] No errors in the browser console. *(Runtime-only; requires loading the app in a browser.)*

## Files affected

```
~ js/map-title.js
+ jira/fable_findings/finding-032-title-drag-unclamped-display.md
```

## Notes

Keep the change minimal: no new helper, no change to what is persisted.
