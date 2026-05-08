# PO-001: Hide all basemap labels

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-001`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `None`                                      |

## Summary

Hide every built-in basemap label (city names, country names, street names, POIs) on the live map so the visual focus is exclusively on the user's pins. The result is a minimalist canvas where the only text on the map comes from the user's own data — perfect for the poster/gift use case where the city pins should carry the story.

## Context

`js/map.js` → `MAP_STYLES` is a hybrid registry of 29 entries: vector styles served as MapLibre style JSON (OpenFreeMap, MapTiler, Stadia vector, Thunderforest) and raster-only providers wrapped as inline raster styles (Wikimedia, OpenTopoMap, Esri Satellite, Stamen Watercolor/Toner family). The two paths have very different control surfaces:

- **Vector styles** carry their label rendering in dedicated `symbol`-type layers with a `layout.text-field` property. Those can be filtered out at runtime — set their visibility to `none`, or remove them from the style entirely after `setStyleSafely()` resolves. The map repaints labelless on the next frame.
- **Raster styles** bake labels into the tile pixels server-side. They can't be hidden client-side without re-tiling. The right contract for raster basemaps is therefore "this preference does not apply" — show a small notice next to the toggle when a raster style is active, rather than silently failing.

`setStyleSafely()` (added in the expanded basemap milestone) already races `styledata` vs `error` for swap success. The label-hide step must hook the `styledata` event because every style swap reinstantiates the layer set; a one-shot mutation on init would be wiped on the first basemap change.

This task is the foundation for PO-002 (pin name labels). The two together produce the "labelled-by-pins-only" experience the PO is asking for.

## Acceptance criteria

- [ ] A toggle control labelled "Hide map labels" lives in the header next to the basemap picker (or in the settings modal — pick the spot that's most discoverable).
- [ ] Toggle state persists across reload via its own `localStorage` key.
- [ ] When toggle is ON and the active basemap is **vector**: every layer with `type === "symbol"` and a `layout.text-field` is hidden (or removed). The map renders with no built-in city/country/street/POI text.
- [ ] When toggle is ON and the active basemap is **raster**: a small inline notice appears near the toggle ("Labels are baked into raster tiles for this style — switch to a vector style to hide them"). The toggle's stored state remains ON so it takes effect the moment the user switches to a vector style.
- [ ] When toggle is OFF: every basemap renders its native labels exactly as today.
- [ ] Switching basemap with the toggle ON re-applies label hiding on the new style (the `styledata` event hook re-runs the filter).
- [ ] User pins (and the route polyline) still render correctly with the toggle ON.
- [ ] Pin labels (when PO-002 lands) are NOT affected by this toggle — they're a user-data layer, not a basemap layer.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- **Per-category granularity** — no "hide POI but keep streets" or "hide country but keep ocean labels" toggle. One global on/off only. Granular control multiplies UI surface for marginal gain at this scale.
- **Editing raster tiles** — would require server-side processing or a custom tile pipeline; both violate CLAUDE.md hard rules.
- **Hiding the OSM/tile attribution control** — legal requirement, never hidden.
- **Filtering the user pin layer** — out of scope; user pin labels are PO-002's territory.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full and skim js/map.js for the basemap registry shape and the setStyleSafely() pipeline.

Task: Add a "Hide map labels" toggle that strips label-bearing layers from vector basemaps and shows a graceful notice on raster basemaps.

Requirements:

UI (index.html, css/styles.css):
- Add a checkbox-style toggle "Hide map labels" near the basemap picker. Make it keyboard-accessible.
- Add a small inline notice element next to the toggle — hidden by default, shown only when the toggle is ON and the current basemap is raster. Wording: "Labels are baked into raster tiles for this style. Pick a vector style to hide them."

Persistence (js/storage.js):
- Add loadHideLabels() → boolean (default false).
- Add saveHideLabels(value) under storage key 'city-pin-map.hide-labels.v1'. Match the defensive try/catch pattern used by loadPins/savePins.

App wiring (js/app.js):
- Hydrate the toggle from loadHideLabels() on bootstrap, BEFORE the map fires its first styledata.
- On change, persist via saveHideLabels(value), then call the map module's applyLabelVisibility() helper (added in this task) so the change takes effect immediately.

Map module (js/map.js):
- Export applyLabelVisibility(hide: boolean). Implementation:
  1. Inspect the active style. If the style's `metadata` or registry entry tags it as raster (the registry already carries `provider`; "wikimedia", "opentopomap", "esri", and Stamen entries are raster — keep this list inside map.js so the check has one source of truth), update the inline notice visibility and return without mutating layers.
  2. If vector: walk `mapInstance.getStyle().layers`. For every layer where `type === "symbol"` AND `layout?.["text-field"]` is defined, call `mapInstance.setLayoutProperty(layer.id, "visibility", hide ? "none" : "visible")`.
  3. Skip the user pin label layer added by PO-002 (when present) — match by layer id (e.g. starts with `city-pin-map.`). The user pin layers should never be hidden by this toggle.
- Subscribe to `styledata` once at init: every time it fires, re-read the current `loadHideLabels()` value and call applyLabelVisibility(...) again. This handles basemap swaps cleanly.
- Make sure applyLabelVisibility is idempotent and safe to call before any layers exist (e.g. during the gap between style URL request and styledata firing).

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no frameworks).
- Match the file layout and coding conventions in CLAUDE.md.
- Do NOT mutate the registry's style objects — those are the source of truth for setStyleSafely(). Mutating layers must happen via setLayoutProperty on the live mapInstance, not by editing MAP_STYLES.
- Do NOT introduce a new dependency.

Deliverables:
- index.html with the toggle and notice element.
- css/styles.css with toggle + notice styling consistent with the existing header.
- js/storage.js with loadHideLabels / saveHideLabels.
- js/app.js wiring hydration + change persistence.
- js/map.js with applyLabelVisibility() exported and the styledata subscription.

Verification:
- Open index.html. Toggle is visible, defaults to OFF. The map looks identical to before.
- Switch to OSM Liberty (vector). Toggle ON. Every city, country, street, and POI label disappears within one frame. Pins remain visible.
- Toggle OFF. Labels return.
- With toggle ON, switch through every vector style (OpenFreeMap variants, MapTiler set, Stadia vector, Thunderforest variants). Labels are hidden on each.
- With toggle ON, switch to Wikimedia (raster). The inline notice appears. Tile labels are still visible because they're baked in. Toggle remains ON in storage.
- Switch from raster back to a vector style. Notice disappears. Labels are re-hidden on the vector style without re-clicking.
- Reload. Toggle state persists. The map boots into the saved state cleanly.
- Drag a pin, switch styles, export PNG — none of these are affected.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- The two implementation strategies considered for vector styles were (a) `setLayoutProperty(layerId, "visibility", "none")` per label layer and (b) cloning the style JSON, removing label layers from the clone, and calling `setStyleSafely(clonedStyle)`. (a) is simpler, fully reversible, and avoids burning a style swap on a UI preference. (b) keeps the style consistent during the brief gap between styledata firing and layer mutation. Recommended: (a) — the gap is sub-frame at our scale; the simplicity wins.
- Some vector styles place language labels in different layer ids (`country-label`, `place-label`, `poi-label-…`) and some bundle them under generic ids. The check `type === "symbol" && layout["text-field"]` is the registry-agnostic way to identify them all without hard-coding ids per provider.
- If the user later asks for "hide POI but keep country names" granularity, the right move is to expand the per-symbol-layer toggle into a small grouped UI (country, place, road, POI) by inspecting `layer["source-layer"]` rather than `layer.id` — that's the field that consistently distinguishes label categories across vector providers. Out of scope for v2.
