# HARDEN-009: Port js/map.js to MapLibre GL JS

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-009`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `M`                                         |
| **Depends on**  | `HARDEN-008` (PROCEED decision)             |

## Summary

Replace Leaflet rendering with MapLibre GL JS. Re-implement marker management, drag handlers, route polyline, and the basemap switcher's `setMapStyle` flow against MapLibre's API while preserving every public function signature in `js/map.js` so callers (`app.js`, `pin-list.js`, `export.js`, `search.js`) don't change.

**Do not start without an explicit PROCEED decision.** This stub captures the shape of the work the HARDEN-008 spike sketched out; the verdict is currently PARK and the trigger signals for revisiting are documented in `jira/harden/HARDEN-008-findings.md`.

## Context

HARDEN-008 measured the porting cost at ~6h for `map.js` alone (it's 336 LOC) and identified the API mappings the rewrite will hit:

- **Coordinate axis flip**: Leaflet uses `[lat, lon]`, MapLibre uses `[lon, lat]` (matches GeoJSON). Every map binding site in this module flips order. Reliable bug source if missed.
- **Style swapping**: Leaflet's `L.tileLayer` add-then-remove pattern (`map.js:118-123`) becomes MapLibre `setStyle()`, which rebuilds the entire style. Preserving sources/layers (markers, route) across a basemap swap takes care — MapLibre fires `styledata` once the new style is loaded, and any added sources have to be re-added in that handler.
- **Markers**: `L.circleMarker` + custom drag (`attachDragHandlers`) becomes either MapLibre `Marker` with `draggable: true` (saves ~50 LOC of drag wiring, but markers are HTML overlays — see HARDEN-010 for the export caveat) **or** `GeoJSONSource` + circle layer (markers are part of the WebGL canvas, single GPU draw call, but custom drag wiring is back). The HARDEN-010 export pipeline drives this choice.
- **Route polyline**: `L.polyline` (`renderRoute`) becomes a MapLibre line layer fed by a GeoJSONSource. The "bringToBack" call drops because layer paint order is explicit in MapLibre.
- **Group color overrides**: `effectiveColor()` either applies per-Marker on update (option 1) or is expressed as a `paint` data-driven expression on the circle layer (option 2). Option 2 is genuinely nicer.

## Acceptance criteria

- [ ] `js/map.js` no longer imports or uses any `L.*` Leaflet APIs.
- [ ] Public function signatures unchanged: `initMap`, `setMapStyle`, `getMap`, `renderPins`, `renderRoute`, `effectiveColor`. Callers don't need edits.
- [ ] Marker drag still updates the pin store via `updatePin` on release (existing contract).
- [ ] Route polyline renders ordered by `createdAt` ascending and toggles cleanly on header change.
- [ ] Group color override semantics (group color wins over pin color when assigned; falls back on stale group reference) preserved exactly.
- [ ] Basemap switching preserves markers + route (MapLibre `setStyle()` rebuilds the whole style — sources/layers must be re-added in the `styledata` handler).
- [ ] No regressions in pin add, drag, rename (which goes through `updatePin`), or color picker.
- [ ] No console errors on cold load or after style switch.
- [ ] After `index.html` is updated to load MapLibre instead of Leaflet, the production app still loads and runs without `dom-to-image-more` (HARDEN-010 handles export; this task gates on it integrating cleanly).

## Files affected

```
~ js/map.js          (full rewrite)
~ js/app.js          (initialization order may shift; verify hydrate-then-render contract)
~ index.html         (swap CDN imports: leaflet → maplibre-gl + maplibre-gl.css)
```

## Out of scope

- `js/export.js` rewrite — that's HARDEN-010.
- `MAP_STYLES` vector entries — that's HARDEN-011.
- Removing `dom-to-image-more` and Leaflet from `index.html` permanently — that's HARDEN-012's cutover.
- Any new features. Spike findings explicitly say PARK absent specific user pain; don't smuggle features in here.

## Implementation prompt

To be drafted at PROCEED time, after the marker-architecture choice (option 1 vs option 2 above) is locked in alongside HARDEN-010's export approach. Drafting an implementation prompt now is premature — the spike's findings doc is the current authoritative reference for the technical shape.
