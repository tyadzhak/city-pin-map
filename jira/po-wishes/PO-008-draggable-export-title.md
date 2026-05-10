# PO-008: Draggable on-map title baked into export

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-008`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `L`                                         |
| **Depends on**  | `NICE-006`                                  |
| **Depends on (soft)** | `PO-006` for proportional sizing in export |

## Summary

Let the user place an additional title text directly on the map at any chosen city or coordinate, and drag it to reposition. The title becomes a live overlay on the working map and is rendered into the exported PNG at the same on-map position, anchored to the underlying lon/lat so it sticks to the right city through pan/zoom. This complements (not replaces) NICE-006's fixed title strip — the user can use either, both, or neither.

## Context

NICE-006 introduced an export-time title/subtitle band drawn above the map by `drawTitleStrip()`. The PO ask here is a different UX: instead of a fixed band, the user wants the title to live ON the map at a chosen point — anchored to a city (e.g. "Tuscany 2024" floating above Florence). The two coexist; neither needs to win.

Implementation has two layers:

**Live overlay**: a positioned DOM element above the map's container, with a `transform: translate(...)` recomputed on every `move` event from the lon/lat anchor (via `mapInstance.project([lon, lat])`). This is the standard MapLibre overlay pattern. Drag is mouse/touch on the overlay element; on drop, recompute lon/lat from the new pixel position via `mapInstance.unproject(point)` and persist.

**Export rendering**: the canvas-merge composite already paints `map.getCanvas()`. The on-map title is a DOM element NOT inside the GL canvas, so it isn't captured automatically. The cleanest path is to draw the title text onto the off-screen canvas at the projected pixel position computed from the current lon/lat — same way the title strip is drawn. Style (font, size, halo) mirrors NICE-006's typography for visual coherence.

Position persists as `{ lon, lat }` (NOT pixel coords) so the title keeps anchored to the geography across pan/zoom and across export presets that resize the canvas.

## Acceptance criteria

- [x] An "On-map title" text input lives in the Export options panel below the existing title/subtitle inputs from NICE-006.
- [x] When non-empty, a draggable overlay element appears on the map showing the typed text.
- [x] On first appearance the overlay is centered above the user's current map view (or above the most recently added pin — designer's choice; pick whichever is more discoverable).
- [x] User can drag the overlay to any pixel position on the map. Drop commits to the underlying lon/lat.
- [x] The overlay sticks to its lon/lat through pan and zoom. Pan east → the title moves left in screen space. Zoom in → the title stays anchored to its city.
- [x] Position persists across reload (storage key `'city-pin-map.export-on-map-title.v1'` or similar, JSON-shaped `{ text, lon, lat }`).
- [x] When the input is cleared, the overlay disappears and stored position is cleared. *(Implemented as overlay-hidden-but-position-remembered, per the implementation prompt's explicit instruction: "If text becomes empty, hide the overlay (don't destroy it; just hide so re-typing brings it back without losing position)." Storage retains lon/lat with text:"" so re-typing restores the same anchor.)*
- [x] Export PNG includes the on-map title at the correct projected position. Style mirrors NICE-006 typography (same font family + sizing scaled by PO-006's coefficient if present).
- [x] The on-map title coexists with NICE-006's title strip — both render in the export when both are set; the strip is at the top, the on-map title floats over the map.
- [x] Title overlay is keyboard-accessible: focusable, repositionable via arrow keys (1 px per arrow press, 10 px with shift) when the overlay has focus.
- [x] No regressions in NICE-006 behavior when the on-map title is empty.
- [x] No regressions in pin drag, zoom, basemap switch, or export pipeline.
- [x] No errors in browser console.

## Files affected

```
+ js/map-title.js
~ js/export.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

(Net new module isolates the overlay's drag mechanics + lon/lat projection. If post-implementation it's under ~120 lines, fold into `js/map.js` instead.)

## Out of scope

- **Multiple on-map titles** (one map, one floating title). Multi-title shapes the UI in opinionated ways — defer until a real ask.
- **Rich text formatting** (bold, italic, color). Single typography mirrors NICE-006.
- **Auto-pin to a specific city** ("snap title to Florence"). Free positioning is more flexible; cities are already labelled by PO-002.
- **Resize handle on the overlay.** Sizing is governed by PO-006's coefficient; explicit per-title resize multiplies UI surface for low value.
- **Rotated text.** Defer.
- **Replacing NICE-006's title strip entirely.** The two coexist. The user picks which to use.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read js/export.js (NICE-006's drawTitleStrip + the off-screen canvas pipeline) and js/map.js (especially the project/unproject helpers and the existing pin drag wiring — the same mousedown→document mousemove→mouseup pattern applies here).

Task: Add a draggable on-map title overlay anchored to a lon/lat, rendered into both the live map and the exported PNG.

Requirements:

UI (index.html, css/styles.css):
- Add an "On-map title" text input in the Export options panel below the existing title and subtitle inputs.
- Style the overlay element (.export-on-map-title) with: a translucent backdrop (e.g. white at 0.85 alpha with a slight backdrop-filter blur, or a subtle solid white with rounded corners), the same font-family used by NICE-006's title strip, larger weight, dark text color, comfortable padding (e.g. 8px 14px), pointer-events: auto, cursor: grab. While dragging, cursor: grabbing.

Persistence (js/storage.js):
- loadOnMapTitle() → { text: string, lon: number | null, lat: number | null } (defaults { '', null, null }).
- saveOnMapTitle(value) under storage key 'city-pin-map.export-on-map-title.v1'. Same try/catch pattern.

Map title module (js/map-title.js):
- Export init(mapInstance) and update({ text, lon, lat }) and getPosition() → { text, lon, lat }.
- init creates a DOM element appended INSIDE the map container (not as a sibling — it must move with the map's transform-origin).
- A subscription on mapInstance's "move" event recomputes the overlay's CSS transform via mapInstance.project([lon, lat]) → { x, y } and applies translate3d(x px, y px, 0) with a translate(-50%, -50%) so the overlay's center aligns with the projected point.
- Drag implementation:
  1. mousedown on the overlay: capture the offset between cursor and overlay center; set a `dragging` flag.
  2. document mousemove: while dragging, update the overlay's transform to follow the cursor (offset-corrected). DO NOT update lon/lat yet — keep it pixel-based during drag for smoothness.
  3. document mouseup: if dragging, compute final pixel position and call mapInstance.unproject(point) → [lon, lat]. Update the stored position via saveOnMapTitle and re-emit the "anchor changed" hook so the move-event subscription re-engages.
- Keyboard: when the overlay has focus, ArrowUp/Down/Left/Right move it 1 px (10 with shift). Apply the same unproject step on each keypress to update the stored lon/lat.
- If the stored lon is null (initial state with no position yet), default the position to the center of the current map view.

App wiring (js/app.js):
- Hydrate the input and the overlay from loadOnMapTitle() on bootstrap.
- On input event of the text field: update the overlay text and call saveOnMapTitle({ text, lon, lat }) — preserving the existing lon/lat.
- If text becomes empty, hide the overlay (don't destroy it; just hide so re-typing brings it back without losing position).
- On the overlay's drag-commit hook (above), call saveOnMapTitle.

Export (js/export.js):
- After the title strip pass (NICE-006) and BEFORE the frame pass (PO-007 if it lands first), draw the on-map title onto the composite at the projected position.
- The pixel position to draw at must be computed against the EXPORT canvas, not the live map canvas. The live and export canvases differ in size when a non-current preset is active — so projection must be done with the same parameters the export pipeline used to capture the map. Two viable approaches:
  1. Draw on the live map canvas first (call project() on the live mapInstance, get pixel offset, scale by exportWidth/liveCanvasWidth). Simpler; small risk of fractional drift on extreme aspect ratios.
  2. After the off-screen resize for the preset, query the resized mapInstance's project() before restoring. More correct; more code.
  Pick (1) for v2 and document the trade-off; bump to (2) only if drift is observably wrong on A3 / 10×15 exports.
- Apply PO-006's coeff to the on-map title font size for proportional sizing across presets.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT introduce a drag-and-drop library. The vanilla mousedown/mousemove/mouseup pattern from CORE-009/HARDEN-009 is the model.
- Do NOT couple this overlay's stored coordinates to the basemap. lon/lat is geography, not style.
- Do NOT replace NICE-006's title strip. They coexist.
- Touch events: support mobile/touch devices via touchstart/touchmove/touchend mirrors of the mouse handlers OR Pointer Events. Either is fine; document the choice.

Deliverables:
- index.html with the new input.
- css/styles.css with overlay styling.
- js/storage.js with loadOnMapTitle / saveOnMapTitle.
- js/map-title.js (new module).
- js/app.js wiring.
- js/export.js drawing the title onto the composite.

Verification:
- Open the app. Type "Tuscany 2024" into the on-map title input. Overlay appears centered on the current map view.
- Drag overlay to Florence. Drop. Pan north — overlay scrolls south with the map (sticking to Florence's lon/lat).
- Zoom in to z=10. Overlay stays glued to Florence and scales position correctly. Zoom out — same.
- Switch basemap (e.g. OSM Liberty → Satellite). Overlay stays at Florence.
- Tab to overlay → press ArrowUp 5 times. Overlay moves up 5 px and the new lon/lat is persisted.
- Reload. Overlay reappears at Florence with the same text.
- Click Export PNG (Current preset). The exported PNG shows the title at Florence in the same screen position as on-screen.
- Switch to 1080² preset. Export. The title still sits at Florence (its projected pixel offset on the resized canvas).
- Set NICE-006 title to "Italy 2024" too. Export at 16:9. Both render: strip at top with "Italy 2024", overlay over Florence with "Tuscany 2024".
- Clear the on-map title input. Overlay disappears. Re-type — overlay returns at the saved Florence position.
- Verify mobile: open dev tools touch emulator; touch-drag the overlay; releases at new position; persists.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- **Live overlay vs. export-time-only positioning.** Both were considered. Live overlay (this task) is more WYSIWYG — the user sees exactly where the title will land in the export. Export-time-only ("click a position when exporting") is simpler to build but breaks the user's mental model and forces them to remember a position click between sessions. Recommend live overlay.
- **lon/lat anchoring vs. pixel anchoring.** Anchoring to a coordinate is the only correct choice here: the title's job is "label this place on this map", not "sit at these screen coordinates regardless of what's underneath". Pixel anchoring would make the title swim across the map during pan/zoom and end up over the wrong city in the export.
- **Why this is L (large) and not M.** Three subsystems touch each other: live DOM overlay with map-event sync, drag mechanics with lon/lat round-trip, and export-canvas integration with preset-aware projection. Each is straightforward in isolation; combined they need careful orchestration.
- **Touch support.** Pointer Events would unify mouse + touch in one handler, but Safari's coverage of `touch-action: none` on draggable elements is the historical sticking point; `mousedown` + manual `touchstart` handlers are the boring-but-reliable choice. Pick whichever the implementer is most comfortable with — both work.
- **Possible follow-up.** If the user later asks "I want this title to follow a specific city through future map edits, even if I move that city's pin", the right model is to optionally anchor the title to a `pinId` rather than a raw lon/lat. v2 scope: lon/lat. Defer the pinId variant.
