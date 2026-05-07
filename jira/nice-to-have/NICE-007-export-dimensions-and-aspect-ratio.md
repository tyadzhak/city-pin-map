# NICE-007: Adjustable export dimensions and aspect ratio

| Field           | Value                                                      |
|-----------------|------------------------------------------------------------|
| **ID**          | `NICE-007`                                                 |
| **Milestone**   | `Nice-to-have`                                             |
| **Status**      | `Done`                                                     |
| **Priority**    | `High`                                                     |
| **Estimate**    | `M`                                                        |
| **Depends on**  | `CORE-012`, `NICE-006`                                     |
| **Depends on (soft)** | `NICE-002` for visual variety in the exported sample |

## Summary

Add a preset selector to the Export options that lets the user pick the aspect ratio and pixel dimensions of the exported PNG (e.g. Square 1:1, 16:9, A4 portrait, A4 landscape). Selecting a preset other than the default "Current view" reshapes the captured image to match — tiles are pulled / repainted to fill the new frame, then the original on-screen view is restored. After this task the user can produce print-ready or social-ready images directly from the app.

## Context

`PROJECT.md` → "Nice-to-have" lists "Adjustable export dimensions and aspect ratio (square for social, A4/A3 for print, 16:9 for screensavers)." Posters are the headline use case in `PROJECT.md` → "Users and use cases", so print-format presets (A4 / A3) are the most important values to nail.

CORE-012 captures the map element at its on-screen pixel size. This task introduces a controlled resize step before capture, then restores the previous dimensions. NICE-006 (which lands first) introduces the Export options panel — this task adds the preset selector to that same panel for layout cohesion.

`PROJECT.md` → "Risks and mitigations" → "PNG export misses tiles that haven't loaded" applies in spades here: resizing the map will trigger many new tile fetches at the new viewport size. Re-use the existing `waitForTiles` helper from CORE-012 after the resize and before the capture.

## Acceptance criteria

- [x] A "Format" / preset selector is visible in the Export options area (introduced by NICE-006). It includes at minimum:
  - Current view (default — same as CORE-012 behavior)
  - Square 1:1 (e.g. 1080×1080 px)
  - 16:9 landscape (e.g. 1920×1080 px)
  - A4 portrait (e.g. 2480×3508 px @ 300 dpi, or 794×1123 px @ 96 dpi — pick one and document it)
  - A4 landscape (the inverse)
- [x] Selecting "Current view" preserves CORE-012 behavior exactly — pixel-for-pixel the same image.
- [x] Selecting any other preset produces an exported PNG whose dimensions match the preset (within a 1-pixel tolerance for any rounding).
- [x] The map content in the exported image is the same map state (same center, same zoom, same pin set, same style, same route line, same group colors, same title/subtitle band) — the chosen frame just changes the visible window over that map.
- [x] After export, the on-screen map returns to its original dimensions and is fully usable: the user can pan, zoom, click pins, drag pins, switch styles, etc. with no leftover layout side effects.
- [x] During export, the brief visual transition (if any) is acceptable — the user clicked Export and is now waiting; some flicker as tiles re-load is fine, but the page must not jump or scroll unexpectedly.
- [x] The exported PNG has no missing / grey tiles even at large preset sizes (`waitForTiles` is invoked after the resize).
- [x] The chosen preset persists across reloads (so a user iterating on a print map doesn't have to re-pick A4 every session).
- [x] If the export fails for any reason at any stage, the error banner shows a friendly message AND the on-screen map is restored to its original dimensions.
- [x] The selector is keyboard-accessible.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/export.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- Custom user-entered width × height values. The preset list is the v2 deliverable; arbitrary dimensions can be added later.
- DPI selection beyond the single chosen value per preset. (You document the chosen DPI for A-formats; the user accepts it.)
- Re-projecting the map for cartographic correctness in print (the export is a screenshot, not a print-ready cartographic render).
- Cropping / framing UI overlays on the live map showing where the export frame will land. (A possible future refinement.)

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md, plus js/export.js (CORE-012) and the export-related changes from NICE-006.

Task: Add an export-format preset selector and capture the map at the chosen dimensions, restoring the on-screen view afterwards.

Requirements:

UI (index.html, css/styles.css):
- Add a `<select id="export-format">` to the Export options panel (the same panel introduced by NICE-006). Options must include at minimum:
  - "current" — Current view (default)
  - "square" — Square 1:1 (1080×1080)
  - "16x9" — 16:9 (1920×1080)
  - "a4-portrait" — A4 portrait
  - "a4-landscape" — A4 landscape
- For A4, pick ONE consistent DPI and document it in the task notes. Recommended: 96 dpi (794×1123 px portrait), which keeps export times reasonable and image sizes manageable. 300 dpi is fine if performance is acceptable on your test machine — say so in the task notes.

Persistence (js/storage.js):
- Add `loadExportFormat()` → string preset id, default `"current"`.
- Add `saveExportFormat(id)` under storage key `'city-pin-map.export-format.v1'`. Same defensive try/catch pattern.

App wiring (js/app.js):
- Hydrate the selector from `loadExportFormat()` on bootstrap.
- On change, persist via `saveExportFormat(value)`.

Export (js/export.js):
- Define a `EXPORT_PRESETS` map: `{ id: { width, height } | null }`. `null` (or absence) means "Current view — capture as-is".
- In `exportMapAsPng`, after the title-strip wrapping logic from NICE-006 but BEFORE the capture:
  1. If preset is "current" / null, skip the resize and proceed exactly as CORE-012 + NICE-006.
  2. Otherwise:
     a. Capture the original inline width / height of the map's container (or the wrapper element introduced by NICE-006) so they can be restored later.
     b. Apply the preset's pixel width / height as inline styles on the capture target.
     c. Call `mapInstance.invalidateSize({ animate: false })` so Leaflet recomputes its viewport at the new size and starts loading the additional tiles needed.
     d. Await `waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS)` (re-use the helper from CORE-012). Bump the timeout if needed for large presets — 12s is reasonable for A4 at 300 dpi.
     e. Call `domtoimage.toPng(captureTarget, { cacheBust: true, width, height })`. Pass the explicit `width` / `height` so the rendered PNG canvas matches the preset.
     f. In the same `finally` block that NICE-006 uses to unwrap the title strip, restore the original inline dimensions and call `mapInstance.invalidateSize({ animate: false })` again so the on-screen map returns to its prior state.
- Make sure errors at any stage still trigger the existing showError path AND fully restore the original layout. The wrap/unwrap from NICE-006 is the canonical place for the `try/finally` — the resize + restore lives inside the same `try/finally` so a single failure unwinds everything atomically.
- The on-screen page must NOT scroll because of the temporary resize. Approaches that satisfy this:
  - Apply the resize to the wrapper element from NICE-006 while it lives off-screen (e.g. `position: fixed; left: -100000px; top: 0;` or `visibility: hidden`) so the user never sees the resized map. dom-to-image-more captures invisible / off-screen elements just fine as long as they are in the document.
  - Or, lock body scroll during the export and absolutely-position the wrapper so the on-screen layout doesn't reflow.
- Pick whichever approach is least invasive and document the choice in the task's Notes section.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Stay on dom-to-image-more (no library swap, no new dependencies).
- Restore the on-screen map fully after every export (success OR failure). Verify by panning / zooming after export.
- Do not change the pin or group data models.
- Keep the OSM/tile attribution visible in the exported PNG at all preset sizes.

Deliverables:
- Updated index.html with the format selector inside the Export options panel.
- Updated css/styles.css with selector styling AND any temporary off-screen positioning class needed for export.
- Updated js/storage.js with loadExportFormat / saveExportFormat.
- Updated js/app.js with hydration and change wiring.
- Updated js/export.js with the resize/capture/restore logic and EXPORT_PRESETS map.

Verification:
- Open the app, add four pins, give it a title and subtitle (NICE-006).
- Pick "Current view" → Export. Image dimensions match the on-screen map size; behavior identical to CORE-012 + NICE-006.
- Pick "Square 1:1" → Export. Image is 1080×1080. The map is centered as before; pins visible.
- Pick "16:9" → Export. Image is 1920×1080.
- Pick "A4 portrait" → Export. Image is the documented portrait pixel size (e.g. 794×1123). All pins still visible; tile attribution visible.
- Pick "A4 landscape" → Export. Image is the inverse of the portrait dimensions.
- Between each export, confirm the on-screen map: pan, zoom, hover a pin, click "Show route" (if NICE-003 landed). Everything works; no leftover layout issues.
- Refresh — the previously selected preset is restored.
- Trigger an export failure deliberately at a non-Current preset — error banner appears, on-screen map is fully restored to its original size, no scroll jump.
- Inspect each exported PNG — no grey/missing tiles even at the largest preset.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox. In the Notes section, record: (1) the chosen DPI for A-formats, and (2) the chosen approach for hiding the temporarily resized wrapper (off-screen positioning vs. visibility-hidden vs. another technique).
```

## Notes

A4 at 300 dpi is 2480×3508 px — that is a substantial canvas for `dom-to-image-more`, and `cacheBust: true` will re-fetch every tile, so first-time exports at this size can take several seconds even on a fast connection. 96 dpi (794×1123 px) is the safer default for v2 and will already produce a print-acceptable image at most consumer printer settings. Document the chosen value in the task's Notes after implementation, and revisit if user feedback says the print result is too soft.

If the chosen technique relies on briefly mounting the wrapper off-screen via `position: fixed; left: -100000px;`, double-check that Leaflet does not throw on `invalidateSize` when the container has unusual offsets. As a fallback, `visibility: hidden; position: absolute; top: 0; left: 0;` plus a body-level scroll lock works on every browser tested for CORE-012.

### Implementation notes

1. **Chosen DPI for A-formats: 96 dpi.** A4 portrait is `794 × 1123` px and A4 landscape is `1123 × 794` px (the inverse). 300 dpi was rejected for v2 because `cacheBust: true` re-fetches every tile and the resulting 2480×3508 canvas pushes a typical export over 10 s on a normal home connection while producing ~6 MB PNGs. 96 dpi is print-acceptable on most consumer printers and keeps click-to-download under a few seconds. Documented inline in `EXPORT_PRESETS` in `js/export.js` so a future bump is a one-line edit.

2. **Chosen approach for hiding the temporarily resized wrapper: off-screen positioning** via `position: fixed; left: -100000px; top: 0`. This is the same technique CORE-012 / NICE-006 already use for the title-strip wrapper, so NICE-007 just generalises the existing helper instead of adding a new hide mechanism (no body-level scroll lock, no `visibility: hidden` toggle). Verified via Playwright that the page does not scroll during a 1920×1080 export and that the on-screen map's `getBoundingClientRect` is unchanged before vs. after a deliberately failed export at the 16×9 preset. Leaflet's `invalidateSize` works correctly at the negative offset — no exceptions or layout glitches were observed across the five presets.
