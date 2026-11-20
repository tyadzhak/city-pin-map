# UXR-016: A4/A3 exports are low resolution (96 dpi)

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `UXR-016`                                   |
| **Milestone**   | `UX review`                                 |
| **Status**      | `Done`                                      |
| **Severity**    | `Medium`                                    |
| **Priority**    | `Medium`                                    |
| **Depends on**  | `UXR-001`                                   |

## Summary

A4/A3 presets exported at 794x1123 / 1191x1684 (96 dpi) and print soft. A new Quality select under Export size adds "Print (300 dpi)" for the A-series presets, producing about 3.125x the pixels with an identical composition.

## Context

**Files:** `js/export.js`, `js/export-quality.js` (new), `js/storage.js`, `js/app.js`, `js/map.js`, `index.html`, `css/styles.css`, tests.

- UXR-001 made presets keep the previewed camera/container and gain resolution via `map.setPixelRatio(preset.width / previewCssWidth)`. Print only changes the target output width, so the composition is the same by construction.
- MapLibre 4.7.1 clamps the drawing buffer with `maxCanvasSize` (default 4096) and additionally re-clamps to the real GL drawing-buffer limit (`painter.overLimit()`).

## Failure scenario

User exports A4 for printing and gets a visibly soft 794x1123 image; only the 10x15 photo presets were 300 dpi.

## Fix direction

- `js/export-quality.js` (pure): `resolveExportSize(presetId, preset, quality)` returns the 300 dpi width (A4 2480/3508, A3 3508/4961) with height proportional to the preset aspect; non-eligible presets (current, square, 16:9, photo) pass through unchanged.
- `js/storage.js`: `city-pin-map.export-quality.v1` bare-string pref (`screen`|`print`), defensive `normalizeExportQuality`/`load`/`save`; not in backups.
- Design tab: `#export-quality` select + `#export-quality-hint` ("Output: 2480 x 3508 px"). Disabled with an explanatory hint for non-A-series presets (photo: "Already 300 dpi").
- `js/map.js`: main map constructed with `maxCanvasSize: [8192, 8192]`.
- `js/export.js`: if the map canvas still comes out narrower than requested (GPU limit), the output shrinks to the rendered size and an info toast states the actual size, rather than upscaling.

## Acceptance criteria

- [x] Print quality yields ~3.125x pixels, identical composition. *(Playwright: A4 portrait Print PNG is 2480x3508; screenshot compared to Screen 794x1123, same framing/pins/labels.)*
- [x] Screen unchanged. *(Screen PNG 794x1123.)*
- [x] Oversize handled gracefully. *(maxCanvasSize raised; headless GL MAX_RENDERBUFFER_SIZE 8192; fallback shrink + toast for smaller GPUs, MapLibre also self-clamps. The fallback path itself was not exercised.)*
- [x] Already-300-dpi presets not double scaled. *(Select disabled; `resolveExportSize` ignores quality for them; tested.)*
- [x] Normalizer tests pass. *(`js/storage.test.mjs`, `js/export-quality.test.mjs`.)*

## Files affected

```
+ js/export-quality.js
+ js/export-quality.test.mjs
~ js/export.js, js/storage.js, js/storage.test.mjs, js/app.js, js/map.js
~ index.html, css/styles.css
+ jira/ux-review/uxr-016-print-quality-export.md
```
