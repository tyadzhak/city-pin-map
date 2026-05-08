# HARDEN-010: Rewrite js/export.js for canvas-based export

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-010`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `M`                                         |
| **Depends on**  | `HARDEN-008` (PROCEED decision); `HARDEN-009` (or implemented in lockstep) |

## Summary

Replace the `dom-to-image-more` DOM-walk export with a canvas-merge pipeline: composite the MapLibre canvas + title strip + (post-composited) markers into an off-screen 2D canvas, then `toDataURL('image/png')`. Drops `dom-to-image-more` as a runtime dependency (and the SRI hash from HARDEN-005). All seven dimension presets must continue to produce correct images.

**Do not start without an explicit PROCEED decision.** Verdict is currently PARK per `jira/harden/HARDEN-008-findings.md`.

## Context

This is the riskiest module in the codebase. PROJECT.md frames the app as "the output image is the product" — any rewrite must preserve current export quality on day one, not "fix later." `js/export.js` is currently 305 LOC including off-screen render trick, tile-wait timing, and dimension presets.

The HARDEN-008 spike confirmed the canvas-merge approach works in principle (PNG signature valid; ~975 KB output for a 1280×800 viewport at 2× DPR). It also surfaced the headline gotcha:

- **MapLibre's `Marker` HTML overlays are not in the WebGL canvas.** `getCanvas().toDataURL()` captures WebGL pixels only — markers vanish from the export. Workaround: post-composite each marker via `map.project(lngLat)` + `ctx.arc()`. The spike's prototype demonstrates this in ~10 lines (`spikes/harden-008-maplibre/main.js` export handler). If HARDEN-009 chooses the GeoJSONSource + circle-layer marker architecture instead, this post-composite step disappears — markers are already in the canvas.
- **Tile-wait**: replace the current `tileload` event polling with `map.once('idle', ...)`. Existing `TILE_WAIT_TIMEOUT_MS_PRESET` (12s) may need re-tuning — MapLibre's `idle` semantics include the GPU painting, so the timing budget shifts.
- **Title strip**: draw directly on canvas with `ctx.fillText` and a system font stack. No `dom-to-image-more` CSS-walk + `<foreignObject>` shenanigans means no webfont CORS-tainting risk, but text metrics must be measured from `ctx.measureText()` and laid out manually (current code lets the browser handle layout via DOM).
- **`preserveDrawingBuffer: true`** must be set on the MapLibre canvas at init time — without it, `toDataURL` returns blank pixels. Documented FPS impact ~5–15% on pan; invisible at this app's scale.
- **Off-screen render trick**: when exporting at a fixed dimension that differs from the on-screen viewport (e.g. 1080² square, A3 landscape), the current code resizes the map element off-screen, waits for tiles, captures, then restores. MapLibre's reflow semantics differ from Leaflet's — `map.resize()` is the explicit API and must be called after the container resizes.

## Acceptance criteria

- [ ] `js/export.js` no longer imports or uses `dom-to-image-more`. The CDN script tag (and HARDEN-005 SRI hash) are removed from `index.html`.
- [ ] All 7 export presets (Current view, 1080² square, 1920×1080, A4 portrait/landscape, A3 portrait/landscape — HARDEN-006) still produce correct images at the same dimensions.
- [ ] Title/subtitle band still renders with the same typography and spacing the user sees today.
- [ ] Inline progress indicator (HARDEN-003) still updates during the multi-second framed-PNG path.
- [ ] Markers visible on screen are visible in the export (post-composite or WebGL-layer markers, depending on HARDEN-009's architecture choice).
- [ ] Route polyline visible on screen is visible in the export.
- [ ] Group color overrides (`effectiveColor`) are honored in the export.
- [ ] Filename includes the date stamp (existing `todayStamp` helper or equivalent).
- [ ] No regressions in any of the 7 presets vs the current Leaflet+`dom-to-image-more` output (compare a fixed test set side-by-side before merge).

## Files affected

```
~ js/export.js                                  (full rewrite)
~ index.html                                    (remove dom-to-image-more script tag + SRI hash)
~ jira/harden/HARDEN-005-sri-hash-dom-to-image.md  (note that the dependency this task pinned is no longer used; HARDEN-012 cleanup)
```

## Out of scope

- `js/map.js` port — that's HARDEN-009.
- New export formats, sizes, or layouts. The PO_review.md "10×15 cm postcard" preset is a separate task if filed.
- Custom marker icons / "nicer pins" from PO_review.md — separate task.

## Implementation prompt

To be drafted at PROCEED time, after HARDEN-009's marker architecture is chosen (it determines whether markers are post-composited in this module or come for free from the WebGL canvas).
