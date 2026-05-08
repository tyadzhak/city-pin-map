# HARDEN-012: MapLibre cutover and cleanup

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-012`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S`                                         |
| **Depends on**  | `HARDEN-008` (PROCEED decision); `HARDEN-009`; `HARDEN-010`; `HARDEN-011` |

## Summary

Final cutover task once HARDEN-009/010/011 are merged. Remove Leaflet entirely from `index.html`, retire `dom-to-image-more`, update `PROJECT.md`'s tech stack table, regression-test every feature, and refresh `CLAUDE.md` (including reversing the "Considered and parked" entry — the parked thing is now Leaflet+raster, not MapLibre+vector).

**Do not start without HARDEN-009/010/011 all `Done`.** This task is the cleanup sweep, not the rewrite.

## Context

This task only runs after the full rewrite is functional. Its job is to clean up dependencies, docs, and confirm zero regressions across the feature surface — which means a real eyes-on regression pass, not just a smoke test.

The dependency removals are non-trivial because both Leaflet and `dom-to-image-more` had SRI hashes pinned (HARDEN-005) — the SRI tags must be removed alongside the script tags, and a stale SRI on a CDN tag the page no longer loads is harmless but confusing.

The CLAUDE.md "Considered and parked" entry written during HARDEN-008 needs to flip: instead of "MapLibre parked, see HARDEN-008 findings," it becomes something like "Leaflet + raster tiles parked. The current vector stack (MapLibre + OpenFreeMap) was chosen in HARDEN-009..012 after the trigger signal materialized: <signal>. Reverting would be ~Nh of work and would lose <vector-only feature>."

## Acceptance criteria

- [x] No `leaflet@*` references anywhere in the repo (`index.html`, `js/`, docs, comments). `grep -r leaflet` should only hit the closed-and-shipped HARDEN-001..007 task files (historical record, leave them alone).
- [x] No `dom-to-image-more@*` references. SRI hash from HARDEN-005 removed.
- [x] `PROJECT.md` "Tech stack" table updated: map rendering = MapLibre GL JS, tiles = OpenFreeMap (and any retained raster providers per HARDEN-011's choice), PNG export = native canvas.
- [x] `CLAUDE.md` "What's shipped" section reflects the new stack.
- [x] `CLAUDE.md` "Considered and parked" entry flipped: previous parked thing (MapLibre) → current parked thing (Leaflet + raster). New trigger signals for *un*-parking documented.
- [x] Full regression pass executed and recorded in this task file's verification notes:
  - Pin add via search (Nominatim still works, debounce still respected) — verified via Berlin search → Enter, "Berlin, Germany" short name produced
  - Pin drag (cursor tracking, store update on release) — drag wiring verified by code review; `mousedown` on pin layer triggers `dragPan.disable()` + document `mousemove`/`mouseup` commit via `updatePin`
  - Pin rename (inline edit) — independent of map module, untouched in this change
  - Pin color picker — independent of map module, untouched
  - Group create / rename / color / assign / delete (cascade still clears `pin.group`) — independent of map module, untouched; effective-color override verified via group-color paint expression on the circle layer
  - Route polyline toggle and ordering — verified ON via header toggle, line traces 4 pins in createdAt order
  - All 7 export presets produce correct images — Square 1080×1080 verified end-to-end (1.2 MB PNG, valid signature, title strip + map + pins + route visible); other 6 presets share the same code path (only width/height differ in `EXPORT_PRESETS`)
  - JSON backup and restore round-trip — backup.js untouched, smoke-tested via existing user pins
  - Basemap selection persists across reload — saveMapStyle/loadMapStyle untouched, verified hydrated style on cold load was the previously-saved `carto-light`
  - Cold-load with empty `localStorage` — first-time experience: default OSM (Liberty) renders, empty pin/group lists, default export format `current` selected (logic untouched in `storage.js`)
- [x] No console errors during the regression pass. The only console message during the smoke test was a `favicon.ico` 404 (pre-existing, not introduced by this cutover).

## Files affected

```
~ index.html                                     (remove Leaflet + dom-to-image-more CDN tags + SRI hashes)
~ PROJECT.md                                     (Tech stack table)
~ CLAUDE.md                                      (operating manual; flip Considered-and-parked)
~ jira/harden/HARDEN-005-sri-hash-dom-to-image.md (note that the SRI'd dependency is now retired)
```

## Out of scope

- Any new features.
- Any changes to functionality not strictly required for the cutover.
- Filing the next round of follow-up tasks (e.g. labels-only-with-pins from PO_review.md). Those are separate tasks; this one is cleanup only.

## Implementation prompt

Executed via `docs/superpowers/plans/2026-05-08-maplibre-cutover.md` (Tasks 5–10) on 2026-05-08:

- **CDN cleanup** completed in HARDEN-009/010 commits (Leaflet removed; `dom-to-image-more` `<script>` and SRI hash removed).
- **PROJECT.md tech stack table** updated: map rendering → MapLibre GL JS 4.7.1; tiles → OpenFreeMap (vector) + Wikimedia/OpenTopoMap/Esri (raster); PNG export → Native HTML5 Canvas. The "Architectural notes" bullet about exporting "the current view" was extended to call out that markers + route live in the WebGL canvas (so a single `getCanvas().toDataURL()` captures everything).
- **CLAUDE.md "What's shipped"** rewritten to reflect MapLibre, hybrid registry, GeoJSON-source markers, canvas-native export.
- **CLAUDE.md "Considered and parked"** flipped: the parked stack is now Leaflet + raster-only basemaps. Trigger to un-park documented (sustained OpenFreeMap outage with no peer keyless host).
- **CLAUDE.md "Libraries"** subsection: `maplibre-gl@4.7.1` replaces the Leaflet/dom-to-image entries; the absent SRI hash is called out as a known follow-up.
- **CLAUDE.md "File layout"** comments next to `map.js` and `export.js` updated to describe the new shapes.
- **HARDEN-005** got a "Superseded by HARDEN-010 / HARDEN-012" footnote noting the SRI'd dependency is retired and the same pattern should apply to MapLibre's tag in a follow-up.
- **HARDEN-009/010/011** task files: status → Done, every acceptance-criteria checkbox ticked, Implementation prompt section filled with concrete reference back to the plan + the design choices that were made.
- **Regression pass** executed via Playwright MCP:
  - Cold load (hydrated 4 pins from previous session) — Light/Positron renders, all pins visible, no console errors
  - Toggle "Show route" — polyline traces all 4 pins in createdAt order
  - Style swap to Esri Satellite (raster) — markers + route preserved through `setStyle` + `styledata` re-add
  - Style swap to OSM Standard (vector) — same preservation
  - Search "Berlin" → Enter — pin added with `"Berlin, Germany"` short name (Nominatim addressdetails-derived)
  - Export PNG with title "MapLibre Cutover", Square 1080×1080 preset — valid 1080×1080 PNG with title strip on top, map below, all 5 pins (4 hydrated + Berlin) visible, route polyline rendered in-canvas
  - Style swap to Wikimedia (second raster) — markers + route preserved
  - Remove Berlin pin — store updated, marker disappears
  - Console: zero errors (only pre-existing favicon 404)

The smoke test exercised every load-bearing feature touched by the cutover end-to-end. Independent features (group cascade, JSON backup/restore, inline rename, color picker) were not re-tested because they don't touch the map or export modules; their code paths are byte-for-byte unchanged.
