# UXR-033: Switching export size crops pins out of the preview and export

| Field           | Value                |
|-----------------|----------------------|
| **ID**          | `UXR-033`            |
| **Milestone**   | `UX review`          |
| **Status**      | `Done`               |
| **Severity**    | `Major`              |
| **Priority**    | `Medium`             |

## Summary

Picking a narrower export size (e.g. A4 portrait) letterboxes the live map without moving the camera, so pins that were visible get cropped out of the preview and, because preview = export, out of the PNG.

## Context

**Files:** `js/app.js` (`initExportFormatSelector`), `js/geo-wrap.js`, `js/geo-wrap.test.mjs`, `CLAUDE.md`

- `js/map-viewport.js` `setPreset` resizes `#map` synchronously via `map.resize()`; the camera is untouched.

## Failure scenario

After "Fit all pins" frames Rome, Berlin and Madrid, choosing "A4 portrait" silently drops cities from the frame.

## Fix direction

On a preset `change` (not on boot) snapshot the pins visible before the resize, resize, and if any of them are now outside the viewport call `fitToPins(visibleBefore, { animate })` (no animation under `prefers-reduced-motion`) and show an info toast. If nothing was cropped the camera is left alone. Added pure `pinsInViewport(map, pins, w, h)` to `js/geo-wrap.js` (uses `projectNearCenter`).

## Acceptance criteria

- [x] Fit all, then A4 portrait keeps all pins visible. *(Playwright smoke: 3/3 inside after, zoom 4.72 to 4.20.)*
- [x] A single centered pin: camera does not move. *(Smoke: center and zoom identical.)*
- [x] Reduced motion respected. *(animate flag from matchMedia.)*
- [x] `node --check` and `node --test js/*.test.mjs` pass.
