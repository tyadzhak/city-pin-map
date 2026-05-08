# PO-003: Replace circle markers with polished drop-pin design

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-003`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `None`                                      |

## Summary

Replace the current WebGL circle markers with a polished drop-pin silhouette — rounded teardrop shape, soft drop-shadow, white inner contour, anchored at the bottom-tip on its coordinate. The pin tints with the pin's `effectiveColor()` so the existing group-color contract is preserved. The result reads like markers in modern travel apps (Wanderlog, Foursquare, Airbnb) rather than a generic data-viz dot.

## Context

`js/map.js` paints pins via a single `circle`-type layer reading `circle-color: ["get", "color"]` from the pin GeoJSON source (one feature per pin, color materialized into `properties.color` at render time so `effectiveColor()` — group color override or per-pin color — stays the single source of truth).

To switch to image-based markers we add SVG sprites to MapLibre's image registry via `mapInstance.addImage(id, image, { sdf: true })` and change the layer type from `circle` to `symbol` with:

- `icon-image: "<sprite-id>"` (the colored teardrop, registered as SDF for tinting)
- `icon-color: ["get", "color"]` (paint property — works on SDF icons)
- `icon-anchor: "bottom"` (the tip of the drop sits on the coordinate)
- `icon-allow-overlap: true` (markers must always show, unlike labels)
- `icon-size: 1.0` (sprite is designed at the right native size)

For the soft shadow + white inner contour, the cleanest pattern is **two icons stacked**: a non-SDF "shadow + contour" image rendered slightly behind, and the SDF "fill" image rendered on top. This keeps the icon-color tint clean (SDF icons are flat-color silhouettes by design) while letting the visual layering carry the shadow without leaking the color into the shadow.

Drag still works: the drag commit reads coordinates from the source feature, not the layer paint properties.

## Acceptance criteria

- [ ] Pins render as a teardrop drop-pin shape (rounded top, pointed bottom), NOT as flat circles.
- [ ] Each pin has a soft shadow underneath and a white inner contour for definition.
- [ ] The pin's tip (bottom-center of the drop) sits exactly on its `lat/lon` coordinate. Pan/zoom verifies — the tip stays glued to the geographic point.
- [ ] Group color override and per-pin color show up as the fill of the drop. Switching a pin's group recolors it without a re-render bounce.
- [ ] Pins remain draggable. Drag mechanics from CORE-009 (mousedown on pin layer + document-level mousemove/mouseup commit) work unchanged.
- [ ] Pin labels (PO-002, if it lands first) sit above the pin head without overlapping the drop silhouette.
- [ ] Switching through every basemap style (vector + raster) preserves the marker design.
- [ ] Exported PNG captures the new markers correctly (canvas-merge pipeline reads `mapInstance.getCanvas()`, so this is automatic).
- [ ] On retina displays, the drop edges and shadow remain crisp (SVG sprites registered at 2× source resolution).
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
+ assets/pin-fill.svg
+ assets/pin-shadow.svg
~ js/map.js
```

## Out of scope

- **A library of marker shapes** (drop, circle, square, custom SVG upload). Single shape for v2 is enough. Design space for shape libraries gets opinionated fast — defer until a user explicitly asks.
- **Marker clustering at low zoom.** Pin counts in this app are small (tens, not thousands) per CLAUDE.md → "What not to do" → "Don't optimize prematurely".
- **Per-pin emoji or icon overlay inside the drop.** Adds a third sprite layer and a per-pin metadata field — not the headline ask.
- **Animations on add/drag/select.** Pins should feel solid, not bouncy.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/map.js end-to-end — especially the pins source build, the circle layer, the effectiveColor()/group-color materialization, and the drag wiring (mousedown → document-level mousemove → mouseup commit).

Task: Replace the WebGL circle marker layer with two stacked symbol layers using SVG sprites — a non-SDF shadow+contour beneath and an SDF tintable fill on top.

Requirements:

Assets (assets/pin-fill.svg, assets/pin-shadow.svg):
- pin-fill.svg: a single-color (black) teardrop silhouette. Native size 64×80 px (2× retina; rendered at icon-size 1.0 the markers display at ~32×40 CSS px on screen, comparable to the current circle layer's 8 px radius + stroke). Anchor: tip at bottom-center of the SVG canvas.
- pin-shadow.svg: a slightly larger teardrop with a soft drop-shadow underneath and a thin white inner contour. Same canvas size and tip alignment as pin-fill so they stack pixel-aligned.
- Both should be hand-tunable — keep them small (under 100 lines each) and well-commented.

js/map.js:
- On map load (the same place the existing pin source/layer is set up), fetch both SVGs as Image() objects (or load via map.loadImage if you prefer the helper) and register them with the image registry:
    mapInstance.addImage("pin-fill",   pinFillImg,   { sdf: true,  pixelRatio: 2 });
    mapInstance.addImage("pin-shadow", pinShadowImg, { sdf: false, pixelRatio: 2 });
- Replace the existing circle layer with TWO new symbol layers, BOTH reading from the same pin source:
    1. PINS_SHADOW_LAYER_ID = "city-pin-map.pins-shadow"
       type: "symbol"
       layout: { "icon-image": "pin-shadow", "icon-anchor": "bottom",
                 "icon-allow-overlap": true, "icon-ignore-placement": true,
                 "icon-size": 1.0 }
    2. PINS_LAYER_ID (keep this id stable for the labels layer's positional reliance) = "city-pin-map.pins-fill"
       type: "symbol"
       layout: same as above except "icon-image": "pin-fill"
       paint:  { "icon-color": ["get", "color"], "icon-opacity": 1 }
- Order on add: shadow first (lower), fill second (above). If a labels layer (PO-002) is added later in the source, add it AFTER the fill layer.
- Update the styledata re-add path to re-register both images and re-add both layers in the right order. Images are wiped on every setStyle call — don't skip the re-addImage step.
- Update the drag wiring: it currently listens for mousedown on the circle layer's id. Switch the listener to PINS_LAYER_ID (the fill layer). Drag still uses queryRenderedFeatures against that id to find the picked pin.
- The drag commit, group-color materialization, addPin/removePin, and replaceAll flows do not need changes — the source contract is unchanged.
- Delete the obsolete circle-layer code path. No "keep the old layer behind a feature flag" — bin it.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT introduce a new dependency. Two SVG files are part of the repo, loaded at runtime.
- Do NOT change the pin or group data model.
- Do NOT switch to DOM-based markers (HTML divs over the map). The export pipeline reads the GL canvas; DOM markers would not appear in the PNG.
- Group color override stays in source feature properties — keep effectiveColor() as the single source of truth.

Deliverables:
- assets/pin-fill.svg and assets/pin-shadow.svg (new files).
- js/map.js with addImage calls, the two new symbol layers, layer ordering, styledata re-add updates, and drag listener id update.

Verification:
- Open the app. Existing pins now render as drop-pin shapes with shadow underneath and a white inner contour. The tip of each drop sits on the coordinate (verify by panning — tip stays glued to the geographic point).
- Add a pin. It renders as a drop, not a circle.
- Drag a pin. Drag mechanics work; the drop's tip follows the cursor while held.
- Assign the pin to a group with a vivid color (e.g. orange). The drop's fill tints orange; the white inner contour stays white; the shadow stays neutral.
- Switch a pin's color via the picker. Tints update.
- Switch through 5 basemaps (e.g. OSM Liberty, Dark, Satellite Hybrid, Wikimedia, Stamen Watercolor). Markers persist correctly on every style.
- Zoom in to 17 and out to 2. Marker shapes stay crisp on retina at high zooms.
- Export PNG. Drop-pins appear in the exported image with correct color and shadow.
- Delete a pin. Both shadow and fill disappear.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- The two-image stack pattern (non-SDF shadow + SDF tinted fill) is the canonical MapLibre approach for tintable markers with non-trivial visual depth. Single-image SDF would only allow a flat silhouette; single-image non-SDF would lose the per-pin color tint.
- `pixelRatio: 2` on `addImage` tells MapLibre to render the 64×80 sprite at 32×40 CSS px on screen, doubling effective DPI for retina crispness.
- If shadows look heavy on light basemaps but fine on dark ones, the right move is a single shadow opacity (0.25–0.4 alpha in the SVG itself) that reads acceptably on both — not a per-style shadow override.
- The previous circle layer's `circle-stroke-width: 2` + `circle-stroke-color: "#ffffff"` is the visual cue this task replaces with the SVG's white inner contour. Don't keep both.
