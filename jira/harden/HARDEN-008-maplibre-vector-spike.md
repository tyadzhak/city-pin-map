# HARDEN-008: Spike — MapLibre GL + vector tiles evaluation

| Field           | Value                                       |
|-----------------|---------------------------------------------|
| **ID**          | `HARDEN-008`                                |
| **Milestone**   | `Hardening`                                 |
| **Status**      | `Done`                                      |
| **Priority**    | `Medium`                                    |
| **Estimate**    | `M`                                         |
| **Depends on**  | `HARDEN-007`                                |

## Summary

A research-only spike (no production code change) to answer one question: **is moving from Leaflet (raster tiles) to MapLibre GL JS (vector tiles, served free by OpenFreeMap) worth the rewrite cost?** HARDEN-007 ships more raster styles to address style variety. This task evaluates whether a follow-up vector-tile rewrite would meaningfully improve the parts HARDEN-007 doesn't touch — smooth zoom, retina crispness, modern look — without breaking the PNG export pipeline. Deliverable is a written recommendation plus a throwaway prototype, not a merged change.

## Context

The current rendering stack:

- **Library**: Leaflet 1.9.4 (loaded via CDN, ~42 KB).
- **Tiles**: raster PNGs from OSM / Carto / OpenTopoMap (and after HARDEN-007: Esri / Wikimedia / Voyager).
- **Markers**: `L.circleMarker`, custom drag implementation in `js/map.js` (see `attachDragHandlers`).
- **Export**: `dom-to-image-more` walks the DOM and rasterizes elements via SVG `<foreignObject>`. This works because Leaflet renders tiles as `<img>` elements that DOM traversal can see (see `js/export.js`).

The vector-tile alternative:

- **Library**: MapLibre GL JS (open-source fork of Mapbox GL after Mapbox closed-sourced; ~200 KB). Renders to a single `<canvas>` via WebGL.
- **Tiles**: [OpenFreeMap](https://openfreemap.org) — completely free, no API key, hosted styles (Liberty / Bright / Positron / Dark). Vector tiles in PMTiles/Mapbox style spec.
- **Trade-offs we already know**:
  - **Wins**: smooth fractional zoom, GPU-accelerated rendering, crisp text and lines at any DPI, modern aesthetic, runtime style customization.
  - **Costs**: ~5x larger library, full rewrite of `js/map.js`, custom marker drag needs re-implementation, **PNG export pipeline likely needs reworking** because `dom-to-image-more` cannot traverse a WebGL canvas the way it traverses Leaflet's `<img>` tiles.

The PNG export question is the single biggest unknown. `js/export.js` is the trickiest module in the codebase (off-screen render trick, tile-wait timing, dimension presets). If MapLibre forces us to switch to `map.getCanvas().toDataURL()` and composite the title strip separately, that's a meaningful rewrite — but `preserveDrawingBuffer: true` plus a canvas-merge step is a known pattern, not a research breakthrough. The spike's job is to **prove or disprove that the export still works**, not to reach a finished implementation.

## Goals

The spike is done when the recommendation answers, with evidence, all of:

1. **Does PNG export work** with MapLibre + a title strip composited on top? Worst case (preserveDrawingBuffer kills FPS) and best case (capture is clean) both exercised.
2. **What's the porting cost** for marker drag, route polyline, and the basemap switcher in `MAP_STYLES`? Estimate in hours, not vibes.
3. **What does it look like** side-by-side? OpenFreeMap Liberty vs current Carto Light at the same zoom and viewport.
4. **What's the bundle/load cost?** Time-to-interactive on a cold cache, on the same connection used to test HARDEN-007.
5. **Final call**: ship it (open follow-up tasks), park it (write down why and close), or escalate (specific blocker that needs user input).

## Acceptance criteria

- [x] A throwaway prototype lives at `spikes/harden-008-maplibre/index.html` (or similar path under a `spikes/` directory at repo root). It is **not** wired into the main app.
- [x] The prototype loads MapLibre GL JS via CDN, renders an OpenFreeMap style, supports adding circle markers by clicking, and exports the visible map to PNG with a single fixed title bar above it.
- [x] PNG export from the prototype produces a correct image at the rendered viewport size, validated by opening the file.
- [x] A written recommendation lives at `jira/harden/HARDEN-008-findings.md` covering the five Goals above, with concrete numbers (KB, ms, hours estimate) — not just qualitative impressions.
- [x] The recommendation ends with one of: **Proceed** (with a list of follow-up task stubs to file), **Park** (with the specific reason it's not worth it right now), or **Escalate** (with the blocker).
- [x] No change to any file under `js/`, `css/`, `index.html`, or any other production path.
- [x] No regressions in the production app (trivially satisfied because no production files change — but verify the app still loads after the spike work).

## Files affected

```
+ spikes/harden-008-maplibre/index.html        (prototype, throwaway)
+ spikes/harden-008-maplibre/main.js           (prototype, throwaway)
+ jira/harden/HARDEN-008-findings.md           (recommendation, kept)
```

The `spikes/` directory is new and intentionally separate from `js/` so it cannot be confused with shipped code. Add a one-line `spikes/README.md` if helpful, explaining "prototypes that informed past tasks; safe to delete once the parent task is closed and follow-ups (if any) are filed."

## Out of scope

- **Production integration.** This task ships nothing the user sees. If the recommendation is "Proceed," follow-up tasks (HARDEN-009+ or a new milestone) handle the actual swap.
- **Self-hosted Protomaps / PMTiles.** OpenFreeMap is the cheapest evaluation target; if it's not fast enough, self-hosting is a separate question, not part of this spike.
- **MapTiler, Mapbox, Stadia, or any other keyed provider.** The whole point of evaluating OpenFreeMap is that it's the no-key vector option. Keyed providers are a different decision tree.
- **Side-by-side performance benchmarks beyond "is it good enough."** Don't tune; just measure.
- **Mobile / touch testing.** PROJECT.md targets desktop browsers. Mobile is a separate concern.

## Implementation prompt

> The block below is what you paste into a coding agent to actually run the spike. It must be self-contained.

```
You are working in the city-pin-map repository. Before doing anything, read CLAUDE.md and PROJECT.md so you understand the conventions and the no-build-step / no-backend constraints. Then read this task file in full.

Task: Run a research spike to evaluate whether MapLibre GL JS + OpenFreeMap is worth replacing Leaflet + raster tiles. Produce a throwaway prototype and a written recommendation. Ship NO production code.

Requirements:

1. Build a prototype at spikes/harden-008-maplibre/ with index.html and
   main.js. Load MapLibre GL JS from CDN (jsdelivr or unpkg, pinned exact
   version). Load an OpenFreeMap style URL (Liberty is the recommended
   starting point — see openfreemap.org).
2. The prototype must support:
   - World view on load.
   - Click-to-add circle marker.
   - Drag a marker (verify MapLibre's GeoJSONSource update pattern, or use
     Marker draggable: true).
   - Single "Export PNG" button that captures the current map + a fixed
     title bar reading "MapLibre Spike" and downloads a PNG.
3. The MapLibre canvas MUST be initialized with preserveDrawingBuffer: true
   (otherwise toDataURL returns a blank canvas). Document the FPS impact
   you observe in the findings doc.
4. For the export, composite the title bar and the map canvas into an
   off-screen 2D canvas, then call toDataURL('image/png'). Do NOT pull in
   dom-to-image-more — the whole point is to test the canvas approach.
5. Write findings to jira/harden/HARDEN-008-findings.md covering:
   - Bundle size delta (KB) vs current Leaflet stack.
   - Time-to-first-paint on a cold cache (DevTools, throttle to "Fast 3G"
     or whatever you used for HARDEN-007).
   - Hours estimate to port js/map.js (markers, drag, route, MAP_STYLES
     switcher).
   - PNG export verdict: works / works-with-caveat / does-not-work, with
     specifics.
   - Visual comparison: 2–3 sentences plus side-by-side screenshots saved
     under spikes/harden-008-maplibre/screenshots/.
   - Final recommendation: PROCEED / PARK / ESCALATE, with reasoning.

Constraints:
- No production-file changes. Do not edit anything under js/, css/,
  index.html, README.md, or any existing module. The prototype is isolated
  under spikes/ for exactly this reason.
- Follow the hard rules in CLAUDE.md within the prototype too: no build
  step, no backend, no API keys (OpenFreeMap is keyless by design).
- Do not introduce a package.json or any node tooling for the prototype.
  Plain HTML + ES modules + CDN scripts only.
- Be honest in the findings doc. If MapLibre is great but the rewrite is
  too much for the user value at v2 scale, write that down. PARK is a
  legitimate outcome.

Deliverables:
- spikes/harden-008-maplibre/index.html
- spikes/harden-008-maplibre/main.js
- spikes/harden-008-maplibre/screenshots/ with 2–3 PNGs
- jira/harden/HARDEN-008-findings.md

Verification:
- Open spikes/harden-008-maplibre/index.html in a browser. Add markers,
  drag one, export PNG, confirm the file looks correct.
- Open the production app (index.html at repo root) and confirm everything
  still works — there should be no risk because no production file changed,
  but verify anyway.
- Re-read the findings doc after a short break: does each Goal in the task
  file have a concrete answer? If not, finish the spike before claiming
  Done.
- All acceptance criteria in this task file are satisfied.

When finished:
- Update this task file's Status field to `Done` and tick every acceptance
  criteria checkbox.
- If recommendation is PROCEED: file follow-up task stubs in jira/harden/
  (HARDEN-009 onward) for the integration work. List them in the findings
  doc with one-line summaries.
- Create a feature branch `harden-008-maplibre-vector-spike`.
- Commit with message `HARDEN-008: spike — MapLibre GL + OpenFreeMap
  evaluation` and the Co-Authored-By footer matching this repo's commit
  style.
- Push the branch and open a pull request titled
  `HARDEN-008: spike — MapLibre GL + OpenFreeMap evaluation` against
  `main`. Include the findings doc verdict in the PR description so the
  reviewer can decide on PROCEED vs PARK without scrolling the diff.
```

## Notes

- A spike that produces "park it" is a successful spike, not a wasted one. The cost of writing it down now is small; the cost of re-doing the same investigation in six months because nobody remembered why we said no is large.
- If during the spike OpenFreeMap turns out to be unreliable (CDN slow, style files moved, etc.), MapTiler's free tier is the obvious comparison point — but it requires an API key, which violates CLAUDE.md hard rule #3. Note that fact in the findings doc rather than secretly switching providers.
- The PNG export is the load-bearing question. If it doesn't work, every other "win" of vector tiles is moot for this app, because the whole point of the app is producing exportable city-pin maps.
- After this spike, if the answer is PROCEED, the natural shape of the follow-up is one task per concern: marker drag port, route polyline port, basemap switcher port, export pipeline rewrite, then a final cutover task. Don't try to do it as one giant PR.
