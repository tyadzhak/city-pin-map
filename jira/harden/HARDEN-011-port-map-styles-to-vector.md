# HARDEN-011: Port MAP_STYLES to vector basemaps via OpenFreeMap

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-011`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Low`                                       |
| **Estimate**    | `S`                                         |
| **Depends on**  | `HARDEN-008` (PROCEED decision); `HARDEN-009` |

## Summary

Replace the seven raster basemap entries shipped in HARDEN-007 with vector equivalents from OpenFreeMap (Liberty / Bright / Positron / Dark) — and decide what to do with **Esri Satellite, Wikimedia, and OpenTopoMap**, which have no key-free vector equivalents.

**Do not start without an explicit PROCEED decision.** Verdict is currently PARK per `jira/harden/HARDEN-008-findings.md`.

## Context

This is not a mechanical port. OpenFreeMap publishes 4 styles. HARDEN-007 ships 7. The gap requires a real design decision before the implementation prompt can be drafted:

**Vector equivalent available (clean port):**
- OSM Standard → OpenFreeMap Liberty (or Bright)
- Carto Light → OpenFreeMap Positron
- Carto Dark → OpenFreeMap Dark
- Carto Voyager → OpenFreeMap Liberty (warmer alternative; same family)

**No vector equivalent (key-free):**
- **Esri World Imagery (Satellite)** — raster aerial photography. No key-free vector source exists.
- **OpenTopoMap (Topographic)** — terrain raster. The data exists in vector form (e.g. via `Tilemaker` from OSM extracts) but no public hosted endpoint is key-free.
- **Wikimedia osm-intl** — labelled OSM raster. Wikimedia hosts no public vector tile endpoint.

Two strategies, both real options:

1. **Pure-vector registry**: drop Satellite, Topographic, Wikimedia. User-visible regression vs HARDEN-007 — Satellite especially has a distinct "places I've been from above" use case.
2. **Hybrid registry**: keep raster entries via MapLibre's raster source support (`{type: 'raster', tiles: [...]}` in the style spec). Mixed mental model in the registry but no feature loss. Slight code complexity in `setMapStyle` because vector and raster styles are loaded differently.

The hybrid path is technically straightforward in MapLibre (it natively supports raster sources) but the question is whether the registry should expose both kinds or commit to vector-only. That call is a user-preference question, not a technical one.

## Acceptance criteria

- [x] `MAP_STYLES` registry entries point at vector or hybrid sources per the chosen strategy.
- [x] Header `<select>` continues to populate dynamically from the registry (no `index.html` change needed for entries; `app.js` loop should still work).
- [x] Persisted style id round-trips across reload (existing `saveMapStyle` / `loadMapStyle` should not need changes; verify, don't re-implement).
- [x] Switching styles preserves markers and route (HARDEN-009's `setStyle()` rebuild must re-add sources/layers in the `styledata` handler).
- [x] Attribution control updates correctly when switching between OpenFreeMap and any retained raster providers (legal requirement, not polite touch).

## Files affected

```
~ js/map.js                          (MAP_STYLES array + setMapStyle implementation, depending on hybrid choice)
```

## Out of scope

- **Self-hosted PMTiles / Protomaps.** OpenFreeMap is the keyless evaluation target. If OpenFreeMap proves unreliable in production, self-hosting is a separate decision.
- **MapTiler / Mapbox / Stadia.** All require API keys, which violates CLAUDE.md hard rule #3.
- **Per-style minZoom / initial-view tweaks.** Default world view at `[20, 0]` zoom 2 should still work for all retained styles; bespoke per-style limits are over-engineering at this scale.

## Implementation prompt

Executed via `docs/superpowers/plans/2026-05-08-maplibre-cutover.md`. Strategy choice: **hybrid registry**. All 7 HARDEN-007 styles preserved.

- **Vector entries (4)** — `style` is a hosted style URL string:
  - `osm` → `https://tiles.openfreemap.org/styles/liberty`
  - `carto-light` → `https://tiles.openfreemap.org/styles/positron`
  - `carto-dark` → `https://tiles.openfreemap.org/styles/dark`
  - `carto-voyager` → `https://tiles.openfreemap.org/styles/bright`
- **Raster entries (3)** — `style` is an inline MapLibre style object built by the local `rasterStyle({tiles, maxzoom, attribution})` helper. Each wraps the original tile URL pattern from HARDEN-007 in a `version: 8` style with one `raster` source + one `raster` layer:
  - `wikimedia` → `https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png`
  - `topo` → OpenTopoMap a/b/c subdomains
  - `esri-imagery` → Esri ArcGIS World_Imagery (with the inverse `{z}/{y}/{x}` ordering)
- **`setMapStyle`**: passes `style.style` to `map.setStyle()` regardless of whether it's a string URL or inline object — MapLibre accepts both, no consumer-side branching needed.
- **Attribution**: each raster style carries its `attribution` field on the source so MapLibre's built-in attribution control (added in `initMap`) merges legal text correctly. Vector entries inherit attribution from the OpenFreeMap-hosted style JSON.

Done as part of the same `js/map.js` rewrite as HARDEN-009 (the registry would be empty/non-functional split apart from the consumer code).

Verification: Playwright-driven smoke test confirmed style swaps Light → Satellite → OSM → Wikimedia all preserved markers + route through the `styledata` re-add path; attribution updated to match the active provider in each case.
