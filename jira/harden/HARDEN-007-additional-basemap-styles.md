# HARDEN-007: Additional basemap styles

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-007`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Todo`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `S`                                         |
| **Depends on**  | `None`                                      |

## Summary

Add three more entries to `MAP_STYLES` so the basemap switcher offers seven choices instead of four: **Satellite** (Esri World Imagery), **Wikimedia** (English-labelled OSM), and **Carto Voyager** (warm illustrated). User feedback flagged the current OSM-derived set as "not optimal" — most of that complaint is variety, not rendering. Three extra raster styles cost ~30 lines and address the symptom without touching the rendering pipeline.

## Context

`js/map.js` → `MAP_STYLES` is the single source of truth for the header `<select>`. Adding a style is one entry per row; the existing wiring in `app.js` populates the dropdown from this array on init, and `setMapStyle()` already swaps `L.TileLayer` instances cleanly with the add-then-remove order documented in `map.js:114-123`. Persistence via `saveMapStyle` already key/value-rounds-trips any new id without changes, because the registry is consulted by id at hydrate time and falls back to OSM with a `console.warn` for unknown ids (`map.js:106-111`).

All three new providers are **free with no API key**, satisfying CLAUDE.md hard rule #3:

- **Esri World Imagery** — satellite/aerial photography. Free tile service published by ArcGIS Online with attribution. Tile URL note: Esri's REST endpoint uses `{z}/{y}/{x}` ordering (y before x), the inverse of the OSM/Carto convention. Leaflet's `L.tileLayer` template handles either by name, but the URL string itself must be correct or every tile 404s.
- **Wikimedia Maps** — OSM data rendered by the Wikimedia Foundation with English-first labels (`osm-intl` style). The same data as OSM but a noticeably quieter label layer; useful for users who said the standard OSM rendering is too busy.
- **Carto Voyager** — third style in the Carto basemap family (alongside the Light and Dark you already ship). Warm cream background, illustrated road hierarchy. Same CDN, same attribution rules, same maxZoom 20.

This task does **not** address the deeper "raster tiles look dated on retina" feedback — that's the vector-tile question parked under HARDEN-008.

## Acceptance criteria

- [ ] `MAP_STYLES` in `js/map.js` includes three new entries with ids `esri-imagery`, `wikimedia`, and `carto-voyager`, each with the correct `url`, `attribution`, and `maxZoom`.
- [ ] The header basemap `<select>` shows seven options in this order: OSM Standard, Light, Dark, Voyager, Wikimedia, Topographic, Satellite. (Group by family: OSM-derived first, then thematic, then Satellite as the visual outlier.)
- [ ] Selecting **Satellite** loads Esri imagery tiles globally with no broken-tile placeholders at zoom levels 2–17.
- [ ] Selecting **Wikimedia** loads OSM data with English labels.
- [ ] Selecting **Voyager** loads the warm cream Carto style.
- [ ] Each new style's attribution string appears in the Leaflet attribution control while that style is active and is removed when the user switches away (this is automatic via the existing `setMapStyle` add-then-remove pattern; the criterion is verifying it works).
- [ ] The chosen style persists across reload (already handled by `saveMapStyle` / `loadMapStyle` — verify, don't re-implement).
- [ ] Pin add, drag, route polyline, and PNG export all behave identically on every new style.
- [ ] No regressions in previously completed tasks.
- [ ] No errors in browser console, including no tile 404s in the network tab on any new style.

## Files affected

```
~ js/map.js
```

That's it. The dropdown is populated dynamically from `MAP_STYLES`, so no `index.html` change is needed.

## Out of scope

- **Any provider that requires an API key.** That includes Stadia Maps (which hosts the Stamen styles), MapTiler, Thunderforest, Mapbox, and Jawg. CLAUDE.md hard rule #3 is the constraint; relaxing it is a separate decision, not part of this task.
- **Removing OpenTopoMap.** Its tile servers are slow but it's the only terrain style currently shipped and some users like it. Replacing it is a separate UX decision.
- **Vector tiles / MapLibre GL.** Tracked under HARDEN-008 (spike). Mixing the two paths in one task buries the trade-offs.
- **Per-style minZoom or initial-view tweaks.** Default world view at `[20, 0]` zoom 2 works for all seven; bespoke per-style zoom limits would be over-engineering at this scale.
- **Reordering the dropdown beyond the one-time grouping above.** No drag-to-reorder, no "favourites", no "recently used". Static order, static labels.

## Implementation prompt

> The block below is what you paste into a coding agent to actually implement the task. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and scope. Then read this task file in full.

Task: Add three new entries to MAP_STYLES in js/map.js — Esri World Imagery, Wikimedia, and Carto Voyager.

Requirements:
- Append the three entries to the MAP_STYLES array. Final order in the array
  (which drives the header <select> order) must be:
    osm, carto-light, carto-dark, carto-voyager, wikimedia, topo, esri-imagery
  with labels: "OSM Standard", "Light", "Dark", "Voyager", "Wikimedia",
  "Topographic", "Satellite".
- Esri World Imagery URL must use the {z}/{y}/{x} ordering that Esri's
  REST endpoint expects (y before x). Verify by loading the page on Satellite
  and confirming tiles render at zooms 2, 6, 10, 14, 17 with no 404s in the
  network tab.
- Wikimedia uses the osm-intl style for English labels.
- Carto Voyager uses Carto's rastertiles/voyager path; attribution mirrors the
  existing Carto Light/Dark entries (OpenStreetMap + CARTO).
- Use accurate, complete attribution strings for each provider — these are
  legal requirements for the free tile services, not a polite touch.

Constraints:
- Follow the hard rules in CLAUDE.md (no build step, no backend, no
  frameworks, NO API keys).
- Match existing entry shape exactly: id, label, url, attribution, maxZoom.
- Do not change MAP_STYLES entries that already ship; only append.
- Do not change index.html — the <select> is populated from MAP_STYLES at
  runtime by app.js.

Deliverables:
- js/map.js with the three new entries appended to MAP_STYLES.

Verification:
- Open index.html. Confirm the basemap selector shows seven options in the
  documented order.
- Switch through every option in turn. For each: confirm tiles load at zoom
  2 and zoom 12 (pan to a major city), confirm the attribution control
  updates, confirm a pre-existing pin still drags smoothly, confirm Export
  PNG still produces a correct image.
- Reload the page on each style and confirm it persists.
- Open DevTools Network tab on Satellite and pan around — confirm zero 404s
  on tile requests (this catches the {z}/{y}/{x} vs {z}/{x}/{y} mistake).
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- Create a feature branch `harden-007-additional-basemap-styles`.
- Commit with message `HARDEN-007: add satellite, Wikimedia, and Voyager
  basemap styles` and the Co-Authored-By footer matching this repo's commit
  style.
- Push the branch and open a pull request titled
  `HARDEN-007: add satellite, Wikimedia, and Voyager basemap styles` against
  `main`.
```

## Notes

- The `{z}/{y}/{x}` quirk on Esri is the one thing that's almost guaranteed to bite a first-pass implementation. Worth flagging in the PR description so a future maintainer copying-pasting another Esri service URL knows why this entry looks different.
- If a user later reports that Wikimedia's tile CDN is rate-limiting heavy panning, the correct response is to drop it from `MAP_STYLES` rather than add a fallback layer — the registry's whole point is "list = ship".
- A future `HARDEN-009` could swap OpenTopoMap (slow German servers) for an Esri World Topo Map entry while we're in the neighborhood. Not part of this task; flagged here so the option isn't forgotten.
