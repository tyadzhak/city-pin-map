# NICE-002: Multiple map styles with switcher

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `NICE-002`                                  |
| **Milestone**   | `Nice-to-have`                              |
| **Status**      | `Todo`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-002`, `CORE-004`, `CORE-012`          |

## Summary

Offer the user a choice of map tile styles (default OSM, light minimalist, dark, plus one or two other looks) via a dropdown in the header. The selection persists across reloads and is reflected in the exported PNG. Per `PROJECT.md` → "Nice-to-have", map styles have a "major impact on poster look", so this is the highest-leverage aesthetic upgrade.

## Context

CORE-002 (`js/map.js` → `initMap`) currently hardcodes a single `L.tileLayer` pointing at OpenStreetMap. This task generalises that into a small registry of named styles, plus a `setMapStyle(styleId)` API that swaps the active tile layer in place. The map instance, pins, polylines (NICE-003 if landed), and other overlays must all survive a style change unchanged.

The selected style is a piece of UI preference, not pin data, so it is persisted under a separate `localStorage` key from the pin set — following the `STORAGE_KEY = 'city-pin-map.pins.v1'` convention from CORE-004. Use `'city-pin-map.map-style.v1'`.

`CLAUDE.md` → "Hard rules" forbids paid APIs and any provider that requires an API key. Carto's basemaps (Positron, Dark Matter) and OpenTopoMap are free and key-free; their tile URLs and required attribution strings are listed in the implementation prompt. Stamen's tiles migrated to Stadia Maps and now require a (free) key, so they are excluded.

`PROJECT.md` → "Risks and mitigations" notes that tile attribution must remain visible in the exported PNG. Each tile provider has its own attribution string — Leaflet's `tileLayer({ attribution })` option already routes that to the on-map control, which CORE-012's export already includes. Verify per style.

## Acceptance criteria

- [ ] A clearly labeled style selector (e.g. `<select>` or a small button group) is visible in the header. It lists at least four styles: OSM Standard (default), Carto Positron (light), Carto Dark Matter (dark), and one additional distinct style (e.g. OpenTopoMap or CyclOSM).
- [ ] Selecting a style swaps the visible tiles within ~1 second; markers, tooltips, and any other overlays remain in place at the same positions.
- [ ] The current style is persisted to localStorage and restored on reload — opening the app applies the previously chosen style without flashing OSM first if possible (or with at most a brief flash that doesn't cause visible jank).
- [ ] After a style change, the PNG export captures the newly chosen style. The correct attribution string for that style is visible in the exported image.
- [ ] Switching styles does not throw, leak tile layers, or duplicate attribution lines.
- [ ] The selector is keyboard-accessible (Tab to focus, arrow keys / Enter to choose).
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

- Custom user-defined tile URLs.
- Per-style font / typography changes in the rest of the UI.
- Styles that require an API key or paid plan (Mapbox, Stadia, Thunderforest, etc.).

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note CLAUDE.md → "Hard rules" — no paid APIs, no API keys.

Task: Replace the single hardcoded OSM tile layer with a registry of styles, expose a switcher in the header, and persist the choice.

Requirements:
- In js/map.js, define a `MAP_STYLES` array of objects, each: { id, label, url, attribution, maxZoom }. Include at least:
  - { id: 'osm', label: 'OSM Standard', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }
  - { id: 'carto-light', label: 'Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 20 }
  - { id: 'carto-dark', label: 'Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 20 }
  - One more, e.g. OpenTopoMap: { id: 'topo', label: 'Topographic', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: 'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', maxZoom: 17 }
- Refactor `initMap(containerId)` so that instead of adding a fixed tile layer, it stores a reference to the active L.TileLayer and calls a new `setMapStyle(styleId)` for the initial paint.
- Export `setMapStyle(styleId)` from js/map.js. It should:
  1. Look up the style in MAP_STYLES; if unknown, fall back to OSM and console.warn.
  2. Remove the previous tile layer from the map (if any) so attribution doesn't accumulate.
  3. Add a new L.tileLayer with the resolved url, attribution, and maxZoom.
  4. Persist the chosen styleId via a new helper.
- In js/storage.js, add `loadMapStyle()` / `saveMapStyle(styleId)` using key `'city-pin-map.map-style.v1'`. Keep the same defensive try/catch + showError pattern used by loadPins/savePins.
- In index.html, add a <select id="map-style-select"> in the header (next to the search and Export PNG button). Populate its options from MAP_STYLES at runtime in js/app.js (don't hardcode the option list in HTML — single source of truth lives in js/map.js).
- In js/app.js, wire it up: on init, read the saved style and call setMapStyle before any other rendering; on `change`, call setMapStyle(event.target.value).
- Style the selector in css/styles.css to match the existing header controls visually (height, font, hover/focus rings).

Constraints:
- Follow the hard rules in CLAUDE.md.
- No paid tile providers, no API keys, no new CDN libraries.
- Each style's attribution must reach Leaflet's on-map attribution control (use the L.tileLayer `attribution` option) so it is included in the exported PNG (CORE-012).
- Do not destroy/rebuild the map instance on style change; only the tile layer swaps.

Deliverables:
- Updated js/map.js with MAP_STYLES, setMapStyle, refactored initMap.
- Updated js/storage.js with loadMapStyle / saveMapStyle.
- Updated js/app.js to wire the selector to setMapStyle and persist on change.
- Updated index.html with the <select id="map-style-select"> element.
- Updated css/styles.css with selector styling.

Verification:
- Open the app. The selector shows all configured styles. The default selection on first load is OSM Standard.
- Pick "Light" — the tiles swap to Carto Positron within ~1s; pins remain in place; no duplicate attribution lines appear.
- Pick "Dark" — same, but darker.
- Pick "Topographic" — same, with topo style.
- Refresh the page. The previously selected style is reapplied.
- With each style active, click "Export PNG". Open each exported image: the tiles match the chosen style and the correct attribution text appears in the bottom-right.
- Open DevTools console — no warnings or errors during style changes.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

Carto's public CDN basemaps are free for non-commercial use with attribution; personal poster output is well within scope. If a style ever 404s on a tile, Leaflet just renders a grey square — that is acceptable here, but the network errors will be visible in the console. If it becomes a persistent issue, swap that style out for another free, key-free one (CyclOSM, Wikimedia tiles, etc.).
