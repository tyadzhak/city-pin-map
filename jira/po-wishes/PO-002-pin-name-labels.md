# PO-002: Render each pin's name as a label on the map

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-002`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `None`                                      |
| **Depends on (soft)** | `PO-001` for the visual story (labels-from-pins-only) |

## Summary

Display each pin's `name` (e.g. "Київ, Україна") as a text label adjacent to its marker on the live map. Labels render via a MapLibre symbol layer that shares the existing pin GeoJSON source, so renames and color/group updates propagate without an extra subscription. The label layer is also captured by the existing canvas-merge export pipeline, so labels appear in the exported PNG without any export-side changes.

## Context

`js/map.js` currently renders pins as a single `circle` layer reading from the `city-pin-map.pins-source` GeoJSON source. Each feature already has the pin's color materialized into `properties.color` (and group color override is applied at render time inside `pins-source` updates). The pin's `name` either is or trivially can be added to feature properties.

The path of least resistance is to add a sibling `symbol` layer reading from the same source with `layout.text-field: ["get", "name"]`, anchored above the pin (`text-anchor: "top"`, `text-offset: [0, 1.0]`). Collision behaviour stays at MapLibre defaults (`text-allow-overlap: false`, `text-ignore-placement: false`) so dense clusters degrade gracefully — at low zoom some labels hide rather than overlap, at high zoom all labels show.

A halo (`text-halo-color` white, `text-halo-width` 1.5–2 px) keeps labels legible on every basemap from satellite to dark mode without per-style tuning.

PO-001 hides the basemap's own labels; once both ship, the map's only text is the user's pin names — the headline experience the PO is asking for.

## Acceptance criteria

- [x] Each pin renders its `name` as a text label near the marker on the live map.
- [x] Label position sits above (or to the side, designer's call) the marker, with consistent offset that visually pairs label-to-pin without overlapping the pin geometry.
- [x] Label has a halo so it remains legible on light, dark, and satellite basemaps.
- [x] Renaming a pin (via the existing inline rename in the side panel) updates its label on the map within the same frame as the rename — no full re-render bounce.
- [x] Adding a pin shows its label immediately.
- [x] Removing a pin removes its label.
- [x] Group color changes on a pin do NOT change the label color — labels stay readable regardless of marker color.
- [x] At sufficiently low zoom, MapLibre's collision detection hides overlapping labels rather than rendering them on top of each other; at high zoom all labels show.
- [x] Switching basemap preserves the label layer (re-added on `styledata`, same pattern as the existing pin layer).
- [x] Exported PNG includes the labels at the same on-screen positions (this comes for free via `map.getCanvas()`).
- [x] The PO-001 "Hide map labels" toggle does NOT hide pin labels.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
```

(One module — the symbol layer, the source-property addition for `name`, and the styledata re-add live in the same place as the existing pin layer wiring.)

## Out of scope

- **Per-pin label visibility toggle.** Either all pin labels show or none. Per-pin granularity adds UI surface for a low-value feature.
- **Per-pin font / size override.** A single typography is fine for v2.
- **Click-to-edit the label inline on the map.** Renaming stays in the side panel.
- **Smart placement (e.g. avoid overlapping the pin's own geometry, or LR/UD auto-flip).** MapLibre's default collision is good enough at our scale.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/map.js end-to-end — especially the pins source, the circle layer, the styledata re-add path, and the effectiveColor() function.

Task: Add a MapLibre symbol layer that renders each pin's name as a text label, sharing the existing pin GeoJSON source.

Requirements:

js/map.js:
- In the place that builds the pins GeoJSON FeatureCollection, ensure each feature's `properties` object includes `name: pin.name` alongside the existing `color`. If it's already there, leave it. (Refactor only what you have to.)
- Define a new layer constant PINS_LABELS_LAYER_ID = "city-pin-map.pins-labels".
- Add an addLayer call right AFTER the existing circles layer (so labels render above pins) with shape:
    {
      id: PINS_LABELS_LAYER_ID,
      type: "symbol",
      source: <same source id as the circles layer>,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-size": 13,
        "text-anchor": "top",
        "text-offset": [0, 1.0],
        "text-padding": 4,
        "text-allow-overlap": false,
        "text-ignore-placement": false
      },
      paint: {
        "text-color": "#1f2937",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
        "text-halo-blur": 0.5
      }
    }
- The exact text-font fontstack must be one supported by every active vector style. "Open Sans Regular" is broadly available; if a style lacks it, MapLibre will fall back to the system default and warn — that's acceptable. Do NOT add a per-style fontstack table.
- The styledata re-add path must re-add the labels layer alongside the circles layer. Look at how the circles layer is currently re-added on style swap and mirror it.
- Make sure addPin / removePin / replaceAll / drag commit / group color override flows all update the source's GeoJSON normally. The labels layer reads from the same source, so any source update propagates automatically — no separate subscription needed.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT add a CSS-rendered overlay for labels. The point is to keep the export pipeline clean — the existing canvas-merge export path captures whatever the MapLibre canvas renders, so labels rendered via a symbol layer come along for free; labels rendered as DOM children of the map container do NOT.
- Do NOT introduce a new dependency.
- Do NOT couple this layer to PO-001's label-hide toggle. Pin labels are user data.

Deliverables:
- Updated js/map.js with the labels layer, source `name` property, and styledata re-add support.

Verification:
- Open the app. Add three pins (Kyiv, Lviv, Odesa). Each pin shows its name above the marker with a clean halo.
- Rename a pin via the side panel. The label updates instantly on the map.
- Drag a pin. The label moves with it.
- Assign a pin to a group with a different color. The marker tints; the label stays readable (text-color does not change).
- Zoom out so pins crowd. Some labels hide via collision. Zoom in — all return.
- Switch through 5 different basemap styles (vector + raster). Labels persist on every style.
- Toggle PO-001 "Hide map labels" if it has landed. Pin labels are NOT hidden.
- Export PNG. The exported image includes the pin labels at the same positions as on screen.
- Delete a pin. Its label disappears with the marker.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- Halo color choice: white halo on dark text is the most legible option across the full basemap range (light, dark, satellite, watercolor). Tested in HARDEN-007/011 era — no per-style override needed.
- `text-padding: 4` keeps labels from clipping the marker geometry. Fine-tune if PO-003's drop-pin shape lands and changes the marker silhouette.
- The combination of `text-anchor: "top"` and `text-offset: [0, 1.0]` places the label just below the pin's center. With PO-003's drop-pin (anchored at bottom-tip), consider re-checking whether `text-anchor: "bottom"` with a negative offset reads better — defer the decision to whichever lands second.
- If a future task wants to show labels only on hover or only at specific zooms, the right pattern is `layout.text-field` interpolation with a `["case", ...]` expression on a feature-level boolean (e.g. `properties.always_label`). Do not introduce per-zoom JS toggles.
