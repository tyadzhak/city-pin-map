# HARDEN-008 Findings — MapLibre GL + OpenFreeMap evaluation

**Verdict: PARK.** MapLibre + OpenFreeMap is technically viable and looks great, but the rewrite cost (~18 hours, including a rewrite of the load-bearing export pipeline) is not justified by the user-visible wins for a personal-scale, no-deadline poster app — especially because HARDEN-007 just shipped three more raster basemap styles addressing the original "not enough variety" complaint.

## How this spike was run

- **Prototype**: `spikes/harden-008-maplibre/` (HTML + ES module, MapLibre GL JS 4.7.1 from jsdelivr, OpenFreeMap "Liberty" style, no build step, no API key).
- **Driver**: Playwright (via the `plugin:playwright` MCP server) on macOS Chromium, viewport 1280×800.
- **Server**: `python3 -m http.server 8765` on the repo root — same shape as the production launcher (`start.command`).
- **Caveat on measurements**: load timings below are on a warm CDN cache and unthrottled. I did not run a true Fast-3G cold-cache trace. Every measurement that matters most for "is this slower for a real user?" should be re-validated on the user's actual setup before any PROCEED decision; I've flagged each below.

## Goal 1 — Does PNG export work?

**Verdict: works-with-caveat.**

The headline canvas-merge approach (off-screen 2D canvas → `drawImage(mapCanvas)` → `toDataURL('image/png')`) produces a valid PNG with the title strip composited on top. Verified end-to-end:

- PNG signature `89 50 4e 47 0d 0a 1a 0a` confirmed on the data URL.
- Output size 974,947 bytes (~975 KB) for a 1280×800 viewport at 2× DPR — same order of magnitude as `dom-to-image-more`'s output today.
- Title strip renders with a webfont-free system font stack (no canvas-CORS-tainting risk that historically bit `dom-to-image`).

**The caveat (this is the real spike finding):** MapLibre's `Marker` class renders the marker as an HTML `<div>` overlay positioned on top of the WebGL canvas. `getCanvas().toDataURL()` captures the WebGL pixels only — **markers vanish from the export**. I verified this by exporting at zoom 12 over Berlin where a marker was clearly visible on screen but absent in the PNG (`screenshots/02-maplibre-berlin-onscreen.png` vs the export-without-fix run that I deleted from the working set after replacing it with the fixed version).

Three workaround paths:

1. **Post-composite markers onto the export canvas** via `map.project(lngLat)` → `ctx.arc()`. ~10 lines. Implemented in `spikes/harden-008-maplibre/main.js` at the export handler. Output verified visually: `screenshots/03-maplibre-export-with-marker-fix.png` shows the Berlin marker present.
2. **Render markers as a WebGL layer** via `addSource({type: 'geojson', …})` + `addLayer({type: 'circle', …})`. Markers then *are* the canvas, no post-composite needed. This is the production-grade path but it abandons the convenient `Marker` class for drag/popup.
3. **Continue using `dom-to-image-more`**. Defeats the spike's premise.

The post-composite workaround is cheap, but it's a footgun the rewrite will keep paying for — every new marker visual (group color overrides, custom icons, drag-state ring) has to be re-implemented twice: once as DOM (on-screen) and once as canvas drawing (in-export). The route polyline (`js/map.js:213` → `renderRoute`) has the same shape: it's drawn as Leaflet SVG today, would be a MapLibre line layer (in-canvas, fine for export) under MapLibre, but if it ever becomes a styled overlay, same trap.

## Goal 2 — What's the porting cost?

**~18 hours** (call it 2–3 focused half-days). Grounded in current LOC and the API mappings I had to think through to write the prototype. Breakdown:

| Module | Current LOC | Port hours | Notes |
|---|---|---|---|
| `js/map.js` | 336 | 6 | `initMap` + `setMapStyle` + `renderPins` + `renderRoute` + drag. MapLibre's `Marker` has `draggable: true` built in, so `attachDragHandlers` (~50 LOC) shrinks. But `setMapStyle` semantics differ: MapLibre `setStyle()` rebuilds the whole style — preserving sources/layers (markers, route) across a basemap swap takes care. |
| `js/export.js` | 305 | 6 | Full rewrite. Canvas-merge + marker post-composite + title strip drawn on canvas (no `dom-to-image-more` font/CSS walk) + dimension presets recalculation + tile-wait via `idle` event instead of `tileload`. Existing `TILE_WAIT_TIMEOUT_MS_PRESET` timing assumptions may need re-tuning. |
| `MAP_STYLES` registry | (in `map.js`) | 1 | OpenFreeMap ships Liberty / Bright / Positron / Dark. **No vector equivalents for Satellite, Wikimedia, OpenTopoMap** that are key-free. Either drop those styles (regression for HARDEN-007 users) or keep a hybrid raster/vector registry — both are real design decisions. |
| `effectiveColor` + group overrides | trivial | 0.5 | Either re-applied to each `Marker` instance (option 1 path) or expressed as a `paint` expression on the circle layer (option 2 path). Option 2 is genuinely nicer here. |
| Cross-feature regression testing | — | 3 | Search-then-add, drag, route, group color, export, JSON backup/restore, persisting the chosen style across reload. |
| Unforeseen / time tax | — | 1.5 | The lng/lat axis flip vs Leaflet's [lat, lon] is a reliable source of off-by-coordinate bugs across the codebase. |

**Architectural risk multiplier**: `js/export.js` is the single most-tested module in this codebase (off-screen render trick, tile-wait timing, dimension presets). Touching it is the highest-stakes change in any port. PROJECT.md says "the output image is the product. Everything else exists to make a good image" — so any rewrite has to preserve current export quality on day one, not "fix later."

## Goal 3 — Visual comparison

Side-by-side at the same zoom levels:

- **MapLibre + OpenFreeMap Liberty, Europe @ z3**: `screenshots/01-maplibre-europe-zoom3.png` — warm earth tones, visible labels in multiple scripts (Cyrillic for Russian regions, Arabic for North Africa), crisp coastlines, smooth fractional zoom.
- **MapLibre + OpenFreeMap Liberty, Berlin @ z12 (on-screen)**: `screenshots/02-maplibre-berlin-onscreen.png` — full street network, labelled districts (Mitte, Wedding, Prenzlauer Berg), water bodies, crisp typography at retina DPI.
- **MapLibre + OpenFreeMap Liberty, Berlin @ z12 (exported PNG with marker fix)**: `screenshots/03-maplibre-export-with-marker-fix.png` — same view rendered into the off-screen canvas, title strip composited, marker post-composited via `map.project()`. Proof of working pipeline.
- **Leaflet + Carto Light, world view (production app)**: `screenshots/04-leaflet-carto-light-world.png` — current shipping experience. Calm, low-contrast, almost no labels at z2; pins are the loudest thing in the frame.

Two- or three-sentence read: Liberty is more polished and richer — clearly a "modern web map" aesthetic — but for poster-making, Carto Light's minimalism arguably serves the user's goal better because the pins are unambiguously the focus. The crisp-on-retina win is real but invisible at typical desktop DPRs (most users won't see it side-by-side); the smooth-fractional-zoom win is real and noticeable, but it's an interaction polish, not an output-quality improvement.

## Goal 4 — Bundle and load cost

Measured directly against the CDN, gzipped (transfer size, what actually crosses the wire):

| Stack | JS (gz) | CSS (gz) | Helper (gz) | Total transfer |
|---|---|---|---|---|
| Current Leaflet + dom-to-image-more | leaflet.js 42 KB | leaflet.css 3.5 KB | dom-to-image-more 5.6 KB | **~52 KB** |
| MapLibre GL + OpenFreeMap | maplibre-gl.js 207 KB | maplibre-gl.css 9 KB | (none) | **~216 KB** |
| **Delta** | | | | **+164 KB (~4.1×)** |

Uncompressed (parse + execute cost): Leaflet stack is ~178 KB raw, MapLibre stack is ~869 KB raw — a +691 KB raw delta (~4.9×). On a fast modern desktop browser, the parse-time difference is sub-100ms and invisible. On a slow connection or older device, this is the load metric that matters.

**Time-to-first-paint on the prototype** (warm cache, unthrottled, viewport 1280×800):
- `first-contentful-paint`: 380 ms (toolbar paints first, before MapLibre is ready)
- `DOMContentLoaded`: 611 ms
- `loadEventEnd`: 618 ms
- Map "idle" (tiles fully painted): ~2.5 s after navigation in observation, but this is heavily dependent on OpenFreeMap CDN latency which I did not throttle.

I did not run a Fast-3G cold-cache trace because the spike's tool surface (Playwright MCP) doesn't expose Chrome DevTools network throttling cleanly in one shot. **For a final PROCEED decision, this needs to be measured on the user's connection.**

## Goal 5 — Final recommendation

**PARK**, with reasons:

1. **HARDEN-007 just shipped**, adding Carto Voyager, Wikimedia, and Esri Satellite. The original complaint that motivated the vector-tile question was style variety. That's now addressed at near-zero rewrite cost.
2. **The export pipeline rewrite is the riskiest change in the codebase**, and the marker-not-in-canvas finding shows that the rewrite isn't a clean drop-in — it adds a permanent post-compositing step (or forces a marker-architecture change to GeoJSONSource, which has its own implications for drag/popup ergonomics).
3. **Bundle delta is real (~4×)**. Negligible on a fast desktop, real on slow connections. Worth it only if the user-visible benefit is also real.
4. **The user-visible benefits are mostly aesthetic interaction polish** (smooth zoom, retina crispness), not output-quality improvements. PROJECT.md frames the app as "the output image is the product" — so the bar for changes that don't improve the output is high.
5. **OpenFreeMap longevity risk**: the project is currently funded by a single individual (Zsolt Ero); no SLA, no tier-1 redundancy. For a persistent personal-poster app, a less-load-bearing dependency is preferable.

### Things that would change this verdict to PROCEED

- A specific user complaint about retina blur or pan jankiness that HARDEN-007's three new styles don't address.
- OpenFreeMap announcing organizational backing (foundation, multiple maintainers, SLA) that materially de-risks the dependency.
- A second app being built on this codebase where smooth zoom is genuinely load-bearing (e.g., a mobile-target spin-off — but PROJECT.md scope is desktop-only, so this is unlikely).

### What about ESCALATE?

I considered escalating on the open question of "should we lose Satellite/Topographic to gain smooth zoom?" — that's a user-preference call I shouldn't make alone. But because the verdict from everything else is already PARK, the question doesn't need answering now. If a future decision flips this to PROCEED, the style-coverage trade-off is the first thing that needs the user's judgment, not the spike's.

### No follow-up tasks filed

PROCEED would mean filing HARDEN-009 (port `map.js`), HARDEN-010 (port `export.js`), HARDEN-011 (port `MAP_STYLES` to vector), and HARDEN-012 (cutover + cleanup). Since the verdict is PARK, **none of these stubs are filed**. If this question reopens, the natural shape of the work is one task per concern in that order.

## Appendix — exact dependencies tested

- `https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js`
- `https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css`
- `https://tiles.openfreemap.org/styles/liberty`

## Appendix — known unknowns I did not measure

These would need a real Chrome DevTools session, not Playwright MCP, to answer rigorously:

- **FPS impact of `preserveDrawingBuffer: true` on sustained pan**. MapLibre's own benchmarks document a ~5–15% FPS hit on pan because the GPU has to keep the framebuffer live between paints. On a 60 Hz desktop with handfuls of markers, this is invisible. For a final PROCEED decision on a low-power machine, run `requestAnimationFrame` timing during a programmatic `flyTo` to measure.
- **Cold-cache time-to-interactive on Fast 3G**. The 216 KB transfer is roughly 4× the current 52 KB; on a Fast-3G 1.6 Mbps connection that's ~1.0 s vs ~0.25 s — meaningful only if the user's cache is cold, which it usually isn't for a personal-use bookmarked app.
- **OpenFreeMap CDN latency from the user's geographic location**. I'm running this against an unspecified jsdelivr POP and an unspecified OpenFreeMap CDN edge. The user's experience may differ.
