# UXR-020: The map goes blank while exporting

| Field           | Value                |
|-----------------|----------------------|
| **ID**          | `UXR-020`            |
| **Milestone**   | `UX review`          |
| **Status**      | `Done`               |
| **Severity**    | `Medium`             |
| **Priority**    | `Medium`             |

## Summary

During PNG export the live map area showed only the grey letterbox mat until the render finished. A frozen copy of the map with a "Rendering…" pill now covers it, and is always removed afterwards.

## Context

**Files:** `js/export.js` (`captureFramed`, new `createFreezeOverlay`), `css/styles.css` (`.export-freeze*`, next to `.export-status`)

- UXR-001/UXR-016 changed presets to keep the container size and raise resolution with `setPixelRatio`, but `captureFramed` still reparents `#map` into an off-screen wrapper for the whole capture, so `.app-map` is empty throughout.
- Findings from a headless Playwright check (rAF-sampled `#map`'s parent each frame, swiftshader GL): in all three cases (Current view with a pin = composite path, A4 Screen, A4 Print) `#map` was off `.app-map` for the duration of the capture (2, 78 and 6 sampled frames respectively; software GL, so timings are not representative). There is no layout jump or visible pixel-ratio flicker, because the map is off-screen; the visible disruption is the blank area. The fast path (Current view, no pins/title/fade/inset) never moves the map and needs no overlay.

## Failure scenario

The user clicks Export PNG and the map vanishes for roughly a second (longer for Print) before reappearing.

## Fix direction

- Before reparenting, `captureFramed` copies `map.getCanvas()` (drawing buffer is preserved) into a canvas inside an absolutely positioned `.export-freeze` div placed over `#map`'s old rect in `.app-map`, dimmed slightly, with a centered "Rendering…" pill.
- The overlay is a sibling of `#map` (never inside it), so it cannot reach the PNG. It is removed in `finally`. Creation is best-effort: a failure logs a warning and the export proceeds without it.
- Limitation: the snapshot is the WebGL canvas only; DOM overlays (title, frame, labels) are not in the frozen copy.

## Acceptance criteria

- [x] No blank flash during export; a "Rendering…" overlay shows instead. Evidence: `.export-freeze` present on every sampled frame where `#map` was off-screen (Current/A4 Screen/A4 Print).
- [x] It is always removed. Evidence: removed in `finally`; none left in the DOM after each export in the smoke run.
- [x] The PNG is unaffected. Evidence: overlay is outside `#map`; the downloads completed normally for all three runs, filename unchanged.
