# CORE-005: Render pins as markers on the map

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-005`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-002`, `CORE-003`                      |

## Summary

Make `js/map.js` subscribe to the pin store and render each pin as a colored Leaflet marker on the map, with a tooltip showing the pin's name. After this task, any pin in the store appears on the map automatically.

## Context

CORE-002 produced the live Leaflet map. CORE-003 produced the pin store with pub/sub. This task connects the two: every change to the store updates the markers on screen. CORE-008 will do the same for the side-panel list.

The pin's `color` field controls marker appearance — this is the spec from `CLAUDE.md` → "Pin data model" and is what the user will customize in CORE-011.

## Acceptance criteria

- [x] Adding a pin via the pin store API immediately places a marker on the map at the correct lat/lon.
- [x] The marker visibly uses the pin's `color` field (e.g. a colored circle marker, divIcon, or tinted SVG — whatever is consistent and visible).
- [x] Hovering the marker shows a tooltip or label containing the pin's `name`.
- [x] Removing a pin from the store removes the corresponding marker from the map.
- [x] Updating a pin's `name` updates the tooltip; updating its `color` updates the marker color; updating `lat`/`lon` moves the marker.
- [x] After a page refresh, all persisted pins (CORE-004) appear on the map without further interaction.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/app.js
~ css/styles.css
```

## Out of scope

- No marker drag-to-reposition — that's a v2 nice-to-have (`PROJECT.md` → "Nice-to-have").
- No marker click → open editor — UI for editing comes in CORE-010/011 from the side panel, not from the map itself.
- No clustering or performance optimizations. Pin counts are tens, not thousands (`CLAUDE.md` → "What not to do").

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md. Note CLAUDE.md → "Pin data model" (color is a hex string like '#e63946') and "What not to do" (don't optimize prematurely).

Task: Make js/map.js render the current pin set as Leaflet markers, reacting to pin store changes.

Requirements:
- Export a `renderPins(pins)` function in js/map.js that synchronizes the current marker set on the map with the given pins array — adds new markers, removes gone markers, and updates moved/recolored/renamed markers in place.
- Maintain a module-scoped `Map<pinId, leafletMarker>` so syncing is O(n) and identity-based (don't tear down and rebuild every time).
- Markers must visually reflect the pin's `color`. Two acceptable approaches:
  - Use `L.circleMarker` with `{ color, fillColor: color, fillOpacity: 0.9 }`. Simple and reliable.
  - Use `L.divIcon` with an SVG/CSS-styled pin shape colored via the pin's color. More poster-like but more code.
  Pick one and stay consistent.
- Bind a tooltip to each marker showing `pin.name` (`marker.bindTooltip(name)`).
- In js/app.js, after the map and pin store are initialized (and after attachStorage has hydrated the store), subscribe `renderPins` to the pin store so it fires on every change. Also call it once with the current state to render persisted pins.

Constraints:
- Follow the hard rules in CLAUDE.md.
- Do not call into the DOM directly; use Leaflet APIs to manage markers and tooltips.
- Do not introduce new CDN dependencies.

Deliverables:
- Updated js/map.js with renderPins and an internal pinId→marker map.
- Updated js/app.js wiring the subscription.
- Updated css/styles.css if you use divIcon and need styling for the marker shape.

Verification:
- Manually call `addPin({ name: 'Tokyo', lat: 35.68, lon: 139.69, color: '#e63946' })` from the console. A red marker appears in Tokyo with a "Tokyo" tooltip on hover.
- `updatePin(id, { color: '#1d3557' })` recolors the marker in place.
- `updatePin(id, { name: 'Tokyo, Japan' })` updates the tooltip.
- `removePin(id)` removes the marker.
- Refresh the page; persisted pins reappear at their correct positions and colors.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

`L.circleMarker` is the simpler option and ships out of the box. If you go the `L.divIcon` route, remember markers do not auto-update when the pin's color changes — you have to swap the icon — that's why an identity-based `pinId→marker` map is important.
