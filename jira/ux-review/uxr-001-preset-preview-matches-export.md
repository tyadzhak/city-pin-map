# UXR-001: Size-preset preview shows a different crop than the exported PNG

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-001`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `High`                                      |
| **Priority**    | `High`                                      |
| **Depends on**  | None                                        |

## Summary

With a non-"Current view" export preset (for example A4 portrait) the live map is letterboxed to the preset's aspect ratio as a preview, but the exported PNG showed a noticeably larger geographic area than the preview. The export is now exactly the preview, just rendered at the preset's resolution.

## Context

**Files:** `js/export.js` (`captureFramed`), `js/map-viewport.js` (unchanged, documents the preview).

- `captureFramed` used to resize the map container to the preset's pixel size (794x1123 ...) at the SAME zoom, so the larger canvas revealed more map. Overlay proportions (frame band, title chip, labels, inset) drifted too: frame scale was 1, typography used a longest-side/1280 coefficient.

## Failure scenario

The user picks A4 portrait, frames Iberia to Saudi Arabia in the letterboxed preview, clicks Export PNG and gets a PNG that also shows Greenland, the Labrador Sea, Brazil and Iran. Measured on 4 pins at zoom 2 (preview bounds vs. export bounds, longitude): A4 portrait +-52.5 vs +-69.8; square +-74.2 vs +-94.9; 16:9 +-94.9 vs +-168.8.

## Fix direction

Chosen approach: keep the camera and the CSS layout box exactly as previewed, and get the preset's resolution from the render pixel ratio.

- `captureFramed` keeps the container at the on-screen (letterboxed) size and calls `map.setPixelRatio(outputScale)` with `outputScale = preset.width / previewCssWidth`; the same is applied to the inset map. The camera is never touched, so there is nothing to restore except the pixel ratio (`setPixelRatio(null)` in the `finally`, back to devicePixelRatio).
- Overlay proportions now equal the preview: for presets the typography `coeff` is 1 and the label size multiplier is 1; the existing CSS->output factor (`chipScale` for title/labels/inset chrome, `scale` for frame bands) equals `outputScale`. Fade percentages and title anchors were already proportional.
- "Current view" path is unchanged (legacy `computeCoeff`, device-pixel output, no pixel-ratio change).

**UXR-016 (300-dpi print option) should plug in here:** it needs no new capture path; it only supplies a different target output width (for example A4 at 300 dpi = 2480 px wide). Compute `outputScale = targetWidthPx / rect.width` instead of `preset.width / rect.width`, and size the output canvas to the target dims. Mind MapLibre's `maxCanvasSize` clamp (`_getClampedPixelRatio`, default ~4096 px per side): at A3/300 dpi the GL canvas is clamped and `drawImage` upscales slightly, so check `mapCanvas.width` against the target and either cap or tile.

## Acceptance criteria

- [x] For A4 portrait, A4 landscape, Square and 16:9 the PNG's geographic extent matches the preview. *(Playwright, 4 pins: capture-time `map.getBounds()` identical to preview bounds for all four, e.g. A4 portrait [-52.47,-47.26,52.47,68.28] both; before the fix [-69.79,-61.38,69.79,75.74].)*
- [x] Frame, title, inset and label proportions match the preview. *(All overlay coefficients are now preview-CSS px x outputScale; verified by code path, not pixel-diffed.)*
- [x] "Current view" output is unchanged. *(Bounds and 1080x844 PNG identical before and after.)*
- [x] The camera is restored after export. *(zoom, center and pixel ratio identical before and after for every preset.)*
- [x] `node --check js/export.js`; `node --test js/*.test.mjs` 426/426 pass.

## Files affected

```
~ js/export.js
+ jira/ux-review/uxr-001-preset-preview-matches-export.md
```

## Notes

A4 portrait canvas came out 794x1122 at capture time (preview box rounded to whole px) while the PNG is exactly 794x1123; the 1 px stretch is imperceptible. Overlays/inset were not pixel-diffed in the browser.
