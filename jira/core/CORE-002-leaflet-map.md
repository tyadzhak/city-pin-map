# CORE-002: Interactive Leaflet map with pan and zoom

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `CORE-002`                                  |
| **Milestone**   | `Core`                                      |
| **Status**      | `Done`                                      |
| **Priority**    | `High`                                      |
| **Estimate**    | `S`                                         |
| **Depends on**  | `CORE-001`                                  |

## Summary

Initialize a Leaflet map inside the `#map` container with OpenStreetMap tiles, sensible default view, and working pan/zoom controls. After this task the user has a live world map even though no pins exist yet.

## Context

The shell from CORE-001 has an empty `<div id="map">`. This task fills it with a real map. `PROJECT.md` → "Tech stack" specifies Leaflet + OpenStreetMap as the default tile source, attribution-only (no API key). `PROJECT.md` → "Architectural notes" requires that tile attribution remain visible — that's already Leaflet's default and we must not hide it.

All map setup belongs in `js/map.js` (CLAUDE.md → "File layout"). `js/app.js` should call into it during bootstrap.

## Acceptance criteria

- [x] Opening `index.html` shows a fully interactive world map filling the map area.
- [x] The user can pan by click-drag and zoom by mouse wheel, double-click, or the `+`/`−` buttons.
- [x] OpenStreetMap tiles render at the default zoom level showing the whole world or a sensible default region.
- [x] OSM attribution (e.g. "© OpenStreetMap contributors") is visible in the bottom-right of the map.
- [x] Resizing the browser window resizes the map without leaving grey regions.
- [x] No regressions in previously completed tasks.
- [x] No errors in browser console.

## Files affected

```
~ js/map.js
~ js/app.js
~ css/styles.css
```

## Out of scope

- No pin rendering yet (CORE-005).
- No alternate tile styles — the Carto/Stamen options listed in `PROJECT.md` are a v2 nice-to-have.
- No saved view (zoom/center persistence) — this is local UI state, not part of the pin set.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Note especially the "Tech stack" and "Architectural notes" sections of PROJECT.md.

Task: Initialize a Leaflet map with OpenStreetMap tiles in the #map container, set up by js/map.js, called from js/app.js.

Requirements:
- In js/map.js, export an `initMap(containerId)` function that:
  - Creates a Leaflet `L.map` bound to the given DOM id.
  - Adds the standard OpenStreetMap tile layer (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`) with proper attribution: `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors`.
  - Sets a sensible default view (e.g. `setView([20, 0], 2)` for a world view).
  - Returns the map instance so other modules can use it later.
- In js/app.js, call `initMap('map')` during bootstrap and store the returned instance in a module-scoped variable that other modules can request via an exported getter (e.g. `getMap()`).
- In css/styles.css, ensure `#map` fills its parent region (height: 100%) so Leaflet renders the full map area. Leaflet requires an explicit height on its container — this is the most common bug.

Constraints:
- Follow the hard rules in CLAUDE.md: no build step, no backend, no frameworks, no paid APIs.
- Use only Leaflet from the CDN already loaded in index.html — do not add new dependencies.
- Do not hide or restyle the OSM attribution control. PROJECT.md requires it remain visible.

Deliverables:
- js/map.js — exports `initMap(containerId)` and `getMap()`.
- Updated js/app.js — wires init on DOMContentLoaded.
- Updated css/styles.css — gives #map a height so tiles render.

Verification:
- Open index.html. The map fills the map area, you can pan and zoom freely, attribution is visible, console is silent.
- Resize the browser; the map resizes with it (no grey strips).
- All acceptance criteria in this task file are satisfied.

When finished, update this task file's Status field to `Done` and tick every acceptance criteria checkbox.
```

## Notes

If the map renders but appears greyed out, the usual cause is the container having zero height; double-check `#map { height: 100%; }` and that every parent in the chain also has a defined height.
