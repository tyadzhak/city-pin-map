# CORE-012: Export current map view as PNG

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-012`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-002`, `CORE-005`                      |

## Summary

Add an "Export PNG" button that captures the current map view — tiles, pins, labels, and OSM attribution — and triggers a download of the resulting image. This is the product itself, per `PROJECT.md` → "Goal": "the output image is the product".

## Context

`PROJECT.md` → "Architectural notes" defines what "the current view" means: the map element exactly as it appears, including pan/zoom, pin positions, and labels, with attribution preserved per OSM's license. `PROJECT.md` → "Risks and mitigations" calls out two specific risks for this task:

1. **Tiles not loaded yet at capture time** — must wait for tile-load events before capturing.
2. **Attribution accidentally cropped** — verify attribution is in the exported image.

CORE-001 pinned a single PNG-export library (`html-to-image` or `dom-to-image-more`). This task uses whichever was chosen.

## Acceptance criteria

- [x] An "Export PNG" button is visible in the header (or a clearly discoverable location).
- [x] Clicking the button triggers a download of a PNG file named like `city-pin-map-<yyyy-mm-dd>.png`.
- [x] The PNG contains the current map view: visible tiles, all pin markers in their on-screen positions, marker tooltips/labels (if visible), and the OSM attribution text in the bottom-right.
- [x] If any tiles are still loading when the button is pressed, the export waits for them before capturing — the resulting PNG has no missing/grey tiles.
- [x] The image dimensions match the on-screen size of the map element (no clipping of the visible area).
- [x] If export fails for any reason, the page-level error banner from CORE-004 shows a clear message; the app remains usable.
- [x] The button is keyboard-accessible.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/export.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- Custom dimensions / aspect ratios — v2 nice-to-have (`PROJECT.md` → "Nice-to-have").
- Custom titles or subtitles rendered into the image — v2 nice-to-have.
- High-DPI / retina upscaling beyond what the chosen library does by default.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note PROJECT.md → "Architectural notes" (export the map exactly as on-screen, attribution must remain) and "Risks and mitigations" (wait for tiles, verify attribution).

Use the PNG-export library that was selected in CORE-001 (html-to-image OR dom-to-image-more — check index.html's top-of-file comment).

Task: Implement the "Export PNG" feature in js/export.js, wired to a header button.

Requirements:
- Add a <button id="export-png" type="button">Export PNG</button> in the header alongside the search input. Style it consistently with the rest of the header.
- In js/export.js, export `exportMapAsPng(mapInstance)` that:
  1. Identifies the map root DOM element (e.g. `mapInstance.getContainer()`).
  2. Waits for all tiles to finish loading. Use Leaflet's events: track tile load on every active tile layer; resolve when there are zero pending tiles. A simple way: listen to the layer's `load` event (fires when all tiles in view have loaded) and gate behind it. Use a timeout (e.g. 5–10 s) as a safety net so the function never hangs.
  3. Calls the export library's main function (`htmlToImage.toPng(...)` or `domtoimage.toPng(...)`) on the map element.
  4. Creates a temporary <a download="city-pin-map-YYYY-MM-DD.png" href="<dataURL>"> element, clicks it, and removes it — that triggers the browser download.
- Verify the OSM attribution control is inside the captured element. If your library has any options that strip controls, disable that.
- Wrap the whole flow in try/catch; on failure call the `showError(message)` helper from CORE-004 with a friendly message like "Could not export the map. Try again."
- In js/app.js, wire the button's click handler to `exportMapAsPng(getMap())`.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Use the chosen library only — do not add a different one.
- Do not crop, resize, or watermark the image. WYSIWYG.
- Tile attribution must remain visible in the exported PNG (OSM license requirement).

Deliverables:
- js/export.js with `exportMapAsPng`.
- Updated index.html with the export button.
- Updated css/styles.css with button styling.
- Updated js/app.js wiring the click.

Verification:
- Pin three cities. Pan/zoom to a frame you like. Click "Export PNG".
- A file like `city-pin-map-2026-05-06.png` downloads.
- Open the PNG: it shows the map view exactly as it was on screen, all three pins are present in the right places, tooltips that were visible on hover may or may not appear (acceptable), and the "© OpenStreetMap contributors" attribution is visible in the bottom-right corner.
- Pan to a fresh region with un-cached tiles, immediately click Export — the PNG still has no grey/missing tiles (the wait-for-tiles guard worked).
- Temporarily break the export (e.g. comment out the library import) — the error banner shows a friendly message, the app keeps working.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Two pitfalls common to DOM-to-image libraries with Leaflet:

1. **Cross-origin tile images:** OSM serves tiles with permissive CORS, so canvas tainting is usually not an issue. If you do hit `SecurityError: Tainted canvases may not be exported`, check that the tile layer was added with `crossOrigin: 'anonymous'`.
2. **CSS background images on controls:** some control icons are loaded via CSS `background-image` from Leaflet's CSS. Both `html-to-image` and `dom-to-image-more` handle these, but if you see missing zoom buttons in the export, ensure the Leaflet CSS is on the same origin or that the library's `cacheBust`/`useCORS` options are enabled.
