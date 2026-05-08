# PO-001: Hide all basemap labels

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `PO-001`                                    |
| **Milestone**   | `PO wishes`                                 |
| **Status**      | `Done`                                      |
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

- [x] A toggle control labelled "Hide map labels" lives in the header next to the basemap picker (or in the settings modal — pick the spot that's most discoverable).
- [x] Toggle state persists across reload via its own `localStorage` key.
- [x] When toggle is ON and the active basemap is **vector**: every layer with `type === "symbol"` and a `layout.text-field` is hidden (or removed). The map renders with no built-in city/country/street/POI text.
- [x] When toggle is ON, every **raster** entry in the basemap picker (`js/style-picker.js`) is rendered in a **disabled** state — visible in the list but visually dimmed and not selectable.
- [x] Hovering, focusing, or clicking a disabled raster entry shows an **info popup/tooltip** with the message: "Labels can't be hidden on raster basemaps because they're baked into the tile image. Pick a vector style to hide labels." The popup is keyboard-accessible (appears on focus, dismissible with Escape).
- [x] When toggle is ON and the **currently active** basemap is raster (i.e. the user toggled labels off while a raster style was already in use): the active style stays selected (no surprise auto-switch); a small inline notice appears near the toggle and the picker explaining the situation; the picker's disabled state applies to every raster entry including the active one.
- [x] When toggle is OFF: every basemap renders its native labels exactly as today, AND every entry in the picker (vector and raster) is selectable normally — no disabled state, no popup.
- [x] Switching basemap with the toggle ON re-applies label hiding on the new style (the `styledata` event hook re-runs the filter). Switching is only possible to vector styles while the toggle is ON.
- [x] User pins (and the route polyline) still render correctly with the toggle ON.
- [x] Pin labels (when PO-002 lands) are NOT affected by this toggle — they're a user-data layer, not a basemap layer.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/style-picker.js
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
- Style for disabled picker rows (.style-picker-row.is-disabled or similar): dimmed text (opacity 0.5), `cursor: not-allowed`, no hover background. Keep the row visible — do NOT `display: none` it.
- Style for the info popup/tooltip that appears on hover/focus/click of a disabled row: small floating panel anchored to the row, with the message about raster labels. Dismissible via Escape, click-outside, or blur. Reuse any existing tooltip/popover primitives in the codebase if present; otherwise a simple absolutely-positioned div with `role="tooltip"` and `aria-live="polite"` is enough.

Style picker (js/style-picker.js):
- Each row that maps to a registry entry whose `provider` is in the raster set ("wikimedia", "opentopomap", "esri", and the Stamen family — keep this raster-providers list inside js/map.js as the single source of truth and import from there) accepts a `disabled` flag.
- When the disabled flag is true:
  - Add the disabled visual class to the row.
  - Disable click-to-select (the click handler short-circuits and instead opens the info popup).
  - On hover, focus, or click, show the info popup anchored to the row.
- Subscribe the picker to the hide-labels store from js/storage.js (or accept a `hideLabels` boolean prop refreshed on each render). When the value flips to true, re-render the rows with `disabled` set on every raster entry; when false, re-render with `disabled` cleared everywhere.
- Keyboard navigation: arrow keys still traverse all rows including disabled ones (so the user can read why each is disabled). Pressing Enter on a disabled row opens the info popup instead of selecting.

Persistence (js/storage.js):
- Add loadHideLabels() → boolean (default false).
- Add saveHideLabels(value) under storage key 'city-pin-map.hide-labels.v1'. Match the defensive try/catch pattern used by loadPins/savePins.

App wiring (js/app.js):
- Hydrate the toggle from loadHideLabels() on bootstrap, BEFORE the map fires its first styledata.
- On change, persist via saveHideLabels(value), then call the map module's applyLabelVisibility() helper (added in this task) and trigger a re-render of the style picker so its disabled-row state reflects the new toggle value.
- Note: the user CAN turn the toggle ON while a raster style is currently active. Do NOT auto-switch to a vector style — the user explicitly chose this raster style and surprise-switching is bad UX. Just show the inline notice and let the user decide.

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
- Do NOT auto-switch the active basemap when the toggle flips. The user's explicit basemap choice is preserved; only the picker's selectability and the inline notice change.
- Do NOT hide raster entries from the picker (display: none). They MUST remain visible in the disabled state — discoverability of all available styles matters.

Deliverables:
- index.html with the toggle and notice element.
- css/styles.css with toggle + notice styling, disabled-row styling for the picker, and info-popup styling.
- js/storage.js with loadHideLabels / saveHideLabels.
- js/app.js wiring hydration + change persistence + picker re-render.
- js/map.js with applyLabelVisibility() exported, the styledata subscription, and the exported RASTER_PROVIDERS set used by the picker.
- js/style-picker.js with disabled-row support and the info popup on hover/focus/click of disabled rows.

Verification:
- Open index.html. Toggle is visible, defaults to OFF. The map looks identical to before. All picker rows are selectable.
- Switch to OSM Liberty (vector). Toggle ON. Every city, country, street, and POI label disappears within one frame. Pins remain visible.
- Open the basemap picker. Every raster row (Wikimedia, OpenTopoMap, Esri Satellite, Stamen Watercolor / Toner / Toner Lite / Terrain) is rendered dimmed and not selectable. Vector rows look normal.
- Hover one of the disabled rows — the info popup appears with the explanation. Click it — selection does NOT change; the popup stays open until dismissed.
- Tab through the picker. The disabled rows are still focusable for discoverability; pressing Enter on a focused disabled row opens the popup instead of selecting.
- Press Escape. Popup closes. Currently selected style is unchanged.
- Toggle OFF. Disabled state lifts everywhere. Labels return.
- With toggle ON, switch through every vector style (OpenFreeMap variants, MapTiler set, Stadia vector, Thunderforest variants). Labels are hidden on each.
- Turn toggle OFF. Pick Wikimedia (raster). Turn toggle ON. The Wikimedia style stays active (no surprise auto-switch). The inline notice appears near the toggle. Tile labels are still visible because they're baked in. The picker shows Wikimedia and other raster rows as disabled, but the active row is highlighted as the current selection.
- Switch from the active raster to a vector style via the picker (vector rows are still selectable). Notice disappears. Labels are re-hidden on the vector style without re-clicking the toggle.
- Reload. Toggle state persists. The map boots into the saved state cleanly. Picker disabled state reflects the persisted toggle.
- Drag a pin, switch styles, export PNG — none of these are affected.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

- **Why disabled-with-popup instead of hide**: hiding raster rows would silently shrink the picker from 29 entries to ~16 the moment the toggle flips. Users would wonder where their styles went. Disabled state with a hover/focus popup keeps the inventory visible AND teaches the user the vector-vs-raster distinction the first time they encounter it. Educational UX over magical UX.
- **Why no auto-switch when the toggle flips with a raster style active**: surprise basemap changes are disorienting. The user picked Wikimedia for a reason; turning the labels toggle on shouldn't override that choice. The inline notice next to the toggle explains what's happening; the user remains in control.
- **The two implementation strategies considered for vector styles** were (a) `setLayoutProperty(layerId, "visibility", "none")` per label layer and (b) cloning the style JSON, removing label layers from the clone, and calling `setStyleSafely(clonedStyle)`. (a) is simpler, fully reversible, and avoids burning a style swap on a UI preference. (b) keeps the style consistent during the brief gap between styledata firing and layer mutation. Recommended: (a) — the gap is sub-frame at our scale; the simplicity wins.
- Some vector styles place language labels in different layer ids (`country-label`, `place-label`, `poi-label-…`) and some bundle them under generic ids. The check `type === "symbol" && layout["text-field"]` is the registry-agnostic way to identify them all without hard-coding ids per provider.
- **The RASTER_PROVIDERS set lives in js/map.js** (alongside MAP_STYLES) so there's one source of truth for which entries are raster. The picker imports it; future raster-provider additions register themselves automatically. Don't duplicate this list inside style-picker.js.
- If the user later asks for "hide POI but keep country names" granularity, the right move is to expand the per-symbol-layer toggle into a small grouped UI (country, place, road, POI) by inspecting `layer["source-layer"]` rather than `layer.id` — that's the field that consistently distinguishes label categories across vector providers. Out of scope for v2.
