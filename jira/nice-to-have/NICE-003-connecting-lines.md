# NICE-003: Connecting lines between pins

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `NICE-003`                                  |
| **Milestone**   | `Nice-to-have`                              |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `CORE-002`, `CORE-005`, `CORE-012`          |

## Summary

Draw an optional polyline that connects all pins in chronological order, so the user can visualize a travel route. The route is toggled on/off from the header, updates live as pins are added/moved/removed, and is captured by the PNG export.

## Context

`PROJECT.md` → "Nice-to-have" lists this as "Connecting lines between pins (great for travel routes)." The natural ordering is by `createdAt` ascending — the order the user pinned cities, which usually matches their trip narrative. Per `CLAUDE.md` → "Pin data model", `createdAt` is already populated on every pin, so no model change is needed.

CORE-005 (`js/map.js` → `renderPins`) already subscribes to the pin store and re-renders markers on every change. The polyline layer plugs into the same subscription: every store notification recomputes the polyline coordinates and updates a single managed `L.polyline` instance.

The on/off state is a UI preference, persisted under its own `localStorage` key (mirroring the pattern introduced in NICE-002 for map style).

## Acceptance criteria

- [x] A "Show route" toggle (checkbox or labeled switch) is visible in the header.
- [x] When the toggle is on, a single polyline is drawn through every pin in `createdAt` ascending order. The line is colored distinctly from any pin marker (a sensible default like `#1d3557` is fine).
- [x] When the toggle is off, no polyline is shown and there are no leftover Leaflet layers attached to the map.
- [x] Adding a new pin while the route is on extends the polyline to include the new pin (at the end of the chain, since createdAt is now).
- [x] Removing a pin while the route is on removes that vertex from the polyline; the remaining points stay connected in order.
- [x] Moving a pin (NICE-001) while the route is on updates the polyline's vertex live.
- [x] With fewer than 2 pins, no line is drawn (a polyline needs at least two points).
- [x] The toggle state persists across reloads.
- [x] The exported PNG (CORE-012) captures the polyline if it is currently on, with the correct vertices.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/storage.js
~ js/app.js
~ index.html
~ css/styles.css
```

## Out of scope

- Reordering pins manually to change the route order — order is always chronological for now.
- Per-segment styling (different colors per leg, animated dashes, arrowheads).
- Geodesic / great-circle curves. A straight line in screen space is the v2 deliverable.
- Multiple distinct routes / route grouping. (Closely related to NICE-004/005 grouping but explicitly deferred.)

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md.

Task: Add an optional connecting polyline through all pins in chronological order, with a header toggle and persistent state.

Requirements:
- In js/map.js, manage a single private `L.polyline` instance. Add an exported `renderRoute(pins, { visible })` (or fold into the existing renderPins flow — your choice; document it). The function:
  1. If `!visible` or pins.length < 2, removes any existing polyline from the map.
  2. Otherwise, sorts a shallow copy of pins by createdAt ascending, builds the [[lat, lon], ...] array, and either creates or updates the polyline (`polyline.setLatLngs(...)`).
  3. Default style: `{ color: '#1d3557', weight: 3, opacity: 0.85 }` is a good starting point — adjust if it conflicts with marker colors.
- In js/app.js, subscribe to the pin store and call `renderRoute(snapshot, { visible: routeVisible })` on every change. Initial paint must run after pin hydration (same pattern app.js uses for renderPins).
- Add a "Show route" checkbox to the header in index.html. Label it clearly. Use a real `<input type="checkbox">` for keyboard/screen-reader support.
- In js/storage.js, add `loadRouteVisible()` / `saveRouteVisible(bool)` under storage key `'city-pin-map.route-visible.v1'`. Default to `false` so first-time users see the unchanged map.
- On checkbox change, persist the new value and call `renderRoute(...)` immediately so the line appears/disappears.
- The polyline must be added BELOW the markers in z-order so markers stay on top (Leaflet handles this by add order — add the polyline before any markers, or use `polyline.bringToBack()` after each update).

Constraints:
- Follow the hard rules in CLAUDE.md.
- Use Leaflet's built-in L.polyline. Do not add a routing library or external service (no OSRM, no Mapbox Directions). The deliverable is straight-line connectors, not real route directions.
- Do not change the pin data model.

Deliverables:
- Updated js/map.js with renderRoute.
- Updated js/app.js wiring the pin store subscription and the toggle handler.
- Updated js/storage.js with route-visible load/save helpers.
- Updated index.html with the toggle.
- Updated css/styles.css with toggle styling consistent with header controls.

Verification:
- Open the app, add three or more pins (e.g. Lisbon, Madrid, Paris). Toggle "Show route" on. A connecting line appears running Lisbon → Madrid → Paris (in chronological add order).
- Toggle off — line disappears. No leftover Leaflet layers in `map._layers`.
- Toggle on, add a fourth pin (London). The line extends to London.
- Drag any pin (NICE-001 if landed) — the line vertex tracks the marker live (or at least settles on drop).
- Remove a pin — the polyline reconnects across the gap.
- Refresh — toggle state and polyline visibility match what they were before refresh.
- Export PNG with toggle on — the polyline appears in the captured image at the right vertices.
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

If the polyline ever needs to wrap across the antimeridian (a route from Tokyo to San Francisco), Leaflet will draw it the "long way" by default — that is the v2 acceptable behavior. Great-circle / antimeridian-aware routing is a later refinement and explicitly out of scope here.
