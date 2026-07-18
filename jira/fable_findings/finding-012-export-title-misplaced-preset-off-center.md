# FBL-012: On-map title mis-placed in preset exports for off-center anchors

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `FBL-012`                                   |
| **Milestone**   | `Fable findings`                            |
| **Status**      | `Done`                                      |
| **Severity**    | `Major`                                     |
| **Confidence**  | `Confirmed`                                 |
| **Priority**    | `High`                                      |
| **Estimate**    | `M` (1–3h)                                  |
| **Depends on**  | `FBL-011` (same file: `js/export.js`)       |

## Summary

`projectOnMapTitle` records `xRatio = pt.x / rect.width` against the LIVE, pre-resize map, and `composite()` places the title chip at `xRatio * outputWidth`. But MapLibre's `resize()` keeps center and zoom fixed, so a geographic point's pixel offset from center is width-invariant: the correct output x is `outW/2 + offsetX`, whereas the ratio approach gives `outW/2 + offsetX·(outW/rectW)`. These only coincide when the offset is ~0 or the width is unchanged — a comment in the code already acknowledges this as an approximation.

## Context

**Files:** `js/export.js`

- `js/export.js:448-468` — `projectOnMapTitle` records the ratio against the live, pre-resize map.
- `js/export.js:338-346` — `composite()` places the chip at `xRatio * outputWidth`.
- `js/export.js:122-125` — comment acknowledging the ratio approach as an approximation.

## Failure scenario

On a 1280px-wide window, the title is dragged ~500px right of center over a pin, then the user exports at A4-portrait (794px wide). The pin reprojects correctly (it uses live `map.project()` post-resize), but the title lands ~190px away from where it visually sat relative to the pin on screen.

## Fix direction

Re-project the title's stored lon/lat with `mapInstance.project()` AFTER the preset resize (inside `captureFramed`), and place the chip at that pixel — dropping the ratio approximation entirely in favor of the same live-reprojection approach already used for pins.

## Acceptance criteria

- [x] Exporting any preset size with the title dragged off-center places the title in the same visual position relative to pins/geography as it appears live on the map (verified at at least one off-center offset and one preset whose width differs materially from the live map width). — *Runtime-only; code now re-projects the anchor via `mapInstance.project()` inside `captureFramed` post-resize (identical mechanism as pins), so drift is eliminated by construction. Needs a browser export to confirm visually.*
- [x] "Current view" export (no resize) is unaffected — title placement matches today's behavior exactly. — *Algebraically bit-identical: old `x = (pt.x/rect.width) * (rect.width·dpr) = pt.x·dpr`; new `x = pt.x·scale` where `scale = dpr` and the container is resized to the same dims, so `project()` returns the same `pt.x`. Runtime confirmation still recommended.*
- [x] No regression to pin projection/placement on preset exports, which already uses live `map.project()` post-resize (do not diverge the title path from this pattern; converge onto it). — *Title path now converges onto the same live-`project()`-post-resize pattern; pin rendering (a MapLibre layer) is untouched.*
- [x] `node --check` passes on all changed modules. — `node --check js/export.js` clean.
- [ ] No errors in the browser console. — *Runtime-only; not executable in this environment.*

## Files affected

```
~ js/export.js
```

## Notes

Review id: F2. Must land after FBL-011 — same file (`js/export.js`). Filed from a coordinator-verified full-app review, 2026-07-18.
