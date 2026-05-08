# MapLibre Cutover Implementation Plan (HARDEN-009/010/011/012)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Leaflet + dom-to-image-more with MapLibre GL JS + a native canvas export pipeline, hybrid raster/vector basemap registry, all without regressing the 7 export presets, drag, search, groups, route, JSON backup, or persisted preferences.

**Architecture:**
- `js/map.js` is rewritten against MapLibre GL JS 4.7.1. Markers live as a `geojson` source + `circle` paint layer (Option B from spike findings) — they sit inside the WebGL canvas, so PNG export captures them for free; group color overrides become a data-driven paint expression. Drag is custom-wired against `map.on('mousedown', layerId, ...)` + document-level `mousemove`/`mouseup`.
- `js/export.js` is rewritten as canvas-merge: `map.getCanvas() → drawImage` into an off-screen 2D canvas plus a title strip drawn directly via `ctx.fillText`. No DOM walk, no `dom-to-image-more`. Tile-wait switches from Leaflet's `tileload` polling to MapLibre's one-shot `idle` event.
- `MAP_STYLES` becomes a hybrid registry: 4 OpenFreeMap-hosted vector styles (Liberty/Positron/Dark/Bright) replace the Leaflet OSM/Carto entries; the 3 raster-only entries (Wikimedia, OpenTopoMap, Esri Satellite) survive as inline MapLibre style objects with a single `raster` source. No HARDEN-007 functionality is lost.
- `setMapStyle` re-adds the markers + route source/layer in a `styledata` listener after the style swap finishes (necessary because `setStyle()` rebuilds the entire style).
- Public function signatures of `js/map.js` (`initMap`, `setMapStyle`, `getMap`, `renderPins`, `renderRoute`, `effectiveColor`) are preserved verbatim; no callers (`app.js`, `pin-list.js`, `search.js`, etc.) change.

**Tech Stack:**
- MapLibre GL JS 4.7.1 + CSS, loaded via jsdelivr CDN.
- OpenFreeMap hosted style endpoints (`https://tiles.openfreemap.org/styles/<name>`) — keyless, no SLA; we accept the dependency risk per spike findings.
- Native HTML5 Canvas for PNG export.
- All other modules (`pins.js`, `groups.js`, `pin-list.js`, `search.js`, `geocode.js`, `backup.js`, `storage.js`, `app.js`) are untouched except for one possible init-order verification in `app.js`.

**Design decisions captured in this plan (made by Claude per user direction "go with recommended option"):**
- **Markers: Option B (GeoJSON + circle layer).** The spike notes this is "the production-grade path" — markers are part of the WebGL canvas, so the export pipeline doesn't carry a permanent post-composite step. Group color override becomes a clean data-driven paint expression. Cost: custom drag wiring (~50 LOC).
- **MAP_STYLES: Hybrid registry.** Keep all 7 styles. The 4 vector-friendly entries become OpenFreeMap; the 3 raster-only entries become MapLibre styles wrapping a `raster` source. No HARDEN-007 user-visible regression. `setMapStyle` paths split on whether the style entry is a URL string (vector) or an inline style object (raster wrapper) — minor branching, not duplicate code paths.
- **Output canvas dimensions: CSS pixels, not device pixels.** Matches what dom-to-image-more produced today; the user's existing exports won't change size. Retina sharpness is unchanged, not gained — but the spike's recommendation was always "PNG must match current quality on day one."

---

## Task 0: Pre-flight — capture baseline screenshots

Establishes a "before" reference for the regression pass at the end. If the new app renders pixels differently in a way the user dislikes, we can compare.

**Files:** none modified.

- [ ] **Step 0.1: Start a server pointed at the current app**

```bash
cd /Users/tyadzhak/Projects/vibe-coding-apps/city-pin-map && python3 -m http.server 8765
```

Run in background. Leave it running for the whole plan execution.

- [ ] **Step 0.2: Open the app in Playwright and capture a baseline export**

Use the Playwright MCP server. Navigate to `http://localhost:8765`. Add ~3 pins via the search box. Click "Export PNG" with a non-empty title. Capture two screenshots: (a) the on-screen UI, (b) the resulting downloaded PNG read back. Save to `docs/superpowers/plans/baseline/` so the regression step can diff against them.

The exact pin coordinates don't matter — we just need a known-good reference. Berlin, Tokyo, New York is fine.

---

## Task 1: Rewrite `js/map.js` against MapLibre GL JS

This is the biggest single change in the plan. The full file is replaced. Public signatures (`initMap`, `setMapStyle`, `getMap`, `renderPins`, `renderRoute`, `effectiveColor`) stay so callers don't change. Internals shift completely:

- Markers: `geojson` source `pins` + `circle` layer `pins-circles` (Option B). `effectiveColor` is materialized onto each Feature's `properties.color` at render time, then read by the layer paint via `['get', 'color']`.
- Drag: `map.on('mousedown', 'pins-circles', ...)` captures the pin id, disables map drag, registers document `mousemove`/`mouseup` handlers; on release, calls `updatePin` with the new lat/lon.
- Route: `geojson` source `route` + `line` layer `route-line`, set via `setData()`. `null`-out source data when route is hidden or pins < 2.
- Basemap swap: `setMapStyle` calls `map.setStyle(...)` and adds a one-shot `styledata` listener that re-applies the marker + route source/layer.
- MAP_STYLES: hybrid registry (HARDEN-011). 4 OpenFreeMap URLs + 3 inline raster style objects.

**Files:**
- Modify: `js/map.js` (full rewrite, current file is 336 LOC; expected target ~280 LOC)

- [ ] **Step 1.1: Replace `js/map.js` with the MapLibre rewrite**

Write the file shown below.

```js
// MapLibre GL JS setup, basemap registry, marker + route rendering.
//
// MapLibre is loaded as a classic <script defer> in index.html and exposes
// the global `maplibregl`. This module wraps initialization so the rest of
// the app never touches `maplibregl` directly — they go through getMap().

import { updatePin } from "./pins.js";
import { listGroups } from "./groups.js";
import { saveMapStyle } from "./storage.js";

// Registry of available basemap styles. Hybrid: 4 vector styles served by
// OpenFreeMap (keyless), and 3 raster-only entries wrapped as inline
// MapLibre styles so we don't lose Wikimedia / OpenTopoMap / Esri Satellite
// (HARDEN-007 user-visible coverage). Single source of truth: js/app.js
// reads this to populate the header <select>, so adding a style here is the
// only change needed to expose it in the UI. All styles must be free and
// key-free per CLAUDE.md → "Hard rules".
//
// `style` is either:
//   - a string URL pointing at a hosted MapLibre style JSON (vector path), or
//   - an inline style object `{ version, sources, layers }` (raster path).
// `setMapStyle` passes the value to `map.setStyle()` either way — MapLibre
// accepts both.
export const MAP_STYLES = [
  {
    id: "osm",
    label: "OSM Standard",
    style: "https://tiles.openfreemap.org/styles/liberty",
  },
  {
    id: "carto-light",
    label: "Light",
    style: "https://tiles.openfreemap.org/styles/positron",
  },
  {
    id: "carto-dark",
    label: "Dark",
    style: "https://tiles.openfreemap.org/styles/dark",
  },
  {
    id: "carto-voyager",
    label: "Voyager",
    style: "https://tiles.openfreemap.org/styles/bright",
  },
  {
    id: "wikimedia",
    label: "Wikimedia",
    style: rasterStyle({
      tiles: ["https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"],
      maxzoom: 19,
      attribution:
        '<a href="https://wikimediafoundation.org/wiki/Maps_Terms_of_Use">Wikimedia maps</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  },
  {
    id: "topo",
    label: "Topographic",
    style: rasterStyle({
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      maxzoom: 17,
      attribution:
        'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
  },
  {
    id: "esri-imagery",
    label: "Satellite",
    style: rasterStyle({
      // Esri's ArcGIS REST tile endpoint uses {z}/{y}/{x} ordering (y before
      // x), the inverse of the OSM/Carto convention used elsewhere here.
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      maxzoom: 19,
      attribution:
        'Tiles © <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    }),
  },
];

export const DEFAULT_MAP_STYLE_ID = "osm";

// Layer / source ids — kept in one place so the styledata re-add logic and
// the render functions agree on naming. Prefix avoids collisions with any
// layer id baked into the OpenFreeMap styles.
const PINS_SOURCE_ID = "city-pin-map.pins";
const PINS_LAYER_ID = "city-pin-map.pins-circles";
const ROUTE_SOURCE_ID = "city-pin-map.route";
const ROUTE_LAYER_ID = "city-pin-map.route-line";

// Module-scoped singleton. Treat as private; outside callers use getMap().
let mapInstance = null;

// Cached pin snapshot used to repaint markers after a basemap swap.
// renderPins keeps this updated on every call; the styledata handler reads
// it to re-add the source/layer with the same data after setStyle() blew
// the previous style away.
let lastPinsSnapshot = [];
let lastRouteVisible = false;

// Drag state. Set when a mousedown on a pin starts a drag; cleared on
// mouseup. The handlers live on `document` (not the map container) so a
// drag that passes through the side panel or briefly leaves the window
// doesn't desync.
let dragState = null;

/**
 * Initialize the MapLibre map inside the given container element id.
 * Idempotent: calling twice returns the existing instance.
 *
 * `preserveDrawingBuffer: true` is required for the export pipeline —
 * without it, getCanvas().toDataURL() returns blank/black pixels. Costs
 * ~5–15% FPS on sustained pan per MapLibre's own benchmarks; invisible at
 * this app's scale.
 */
export function initMap(containerId, initialStyleId = DEFAULT_MAP_STYLE_ID) {
  if (mapInstance) return mapInstance;

  const initial = MAP_STYLES.find((s) => s.id === initialStyleId)
    ?? MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);

  // MapLibre uses [lon, lat]; our previous Leaflet code used [lat, lon].
  // Center [0, 20] → 20° north, 0° east, matching the previous setView.
  mapInstance = new maplibregl.Map({
    container: containerId,
    style: initial.style,
    center: [0, 20],
    zoom: 2,
    preserveDrawingBuffer: true,
  });

  mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }));

  // The first style emits `load` once tiles + sprites + glyphs are ready.
  // Re-add markers/route here so a hydrated pin set paints on first frame
  // even though renderPins was called before the style was ready.
  mapInstance.on("load", () => addPinAndRouteLayers());
  attachPinInteractions();

  return mapInstance;
}

/**
 * Swap the active basemap to the style identified by `styleId`.
 * Falls back to the default (with a console.warn) if the id isn't known.
 *
 * MapLibre's `setStyle()` rebuilds the entire style object, dropping all
 * sources and layers we previously added. The `styledata` one-shot below
 * re-adds the markers + route once the new style finishes loading. We
 * pass `diff: false` so the rebuild is unconditional — a custom raster
 * style swapping into a vector style cannot be diffed safely.
 */
export function setMapStyle(styleId, { persist = true } = {}) {
  if (!mapInstance) return;

  let style = MAP_STYLES.find((s) => s.id === styleId);
  if (!style) {
    console.warn(
      `Unknown map style "${styleId}"; falling back to "${DEFAULT_MAP_STYLE_ID}".`
    );
    style = MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);
  }

  mapInstance.setStyle(style.style, { diff: false });
  // `styledata` fires once when the new style is ready. `once` is the
  // documented MapLibre helper for this exact pattern.
  mapInstance.once("styledata", () => {
    addPinAndRouteLayers();
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
  });

  if (persist) saveMapStyle(style.id);
}

/** Returns the live map instance, or null if initMap() hasn't run yet. */
export function getMap() {
  return mapInstance;
}

/**
 * Synchronize the rendered pins source against `pins`.
 *
 * Markers are GeoJSON features in a single `geojson` source. The circle
 * layer paints them as filled circles with a white border. Group color
 * override is materialized into each feature's `properties.color` — the
 * layer's paint reads it via `['get', 'color']`.
 *
 * Safe to call on every pin-store change. No-op until the style is loaded
 * (the source doesn't exist yet) — the `load` and `styledata` handlers
 * call us back with the latest snapshot once the source is in place.
 */
export function renderPins(pins) {
  lastPinsSnapshot = pins.slice();
  if (!mapInstance) return;
  const source = mapInstance.getSource(PINS_SOURCE_ID);
  if (!source) return;
  source.setData(pinsToFeatureCollection(pins));
}

/**
 * Synchronize the connecting-route line source against `pins` and the
 * toggle. Same data flow as renderPins: a GeoJSON source + a line layer.
 *
 * Sorted by createdAt ascending so the line traces the user's pinning
 * order — the natural travel-narrative order (PROJECT.md).
 */
export function renderRoute(pins, { visible }) {
  lastRouteVisible = visible;
  if (!mapInstance) return;
  const source = mapInstance.getSource(ROUTE_SOURCE_ID);
  if (!source) return;

  if (!visible || pins.length < 2) {
    source.setData(emptyLineFeatureCollection());
    return;
  }

  const ordered = pins.slice().sort((a, b) => a.createdAt - b.createdAt);
  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: ordered.map((p) => [p.lon, p.lat]),
        },
        properties: {},
      },
    ],
  });
}

/**
 * Resolve the color a pin should render as. Group color wins when the pin
 * is assigned to a still-existing group; otherwise the pin's own color.
 * A pin whose `group` references a deleted group is silently treated as
 * ungrouped — render must never crash on stale data.
 */
export function effectiveColor(pin) {
  if (!pin.group) return pin.color;
  const group = listGroups().find((g) => g.id === pin.group);
  return group?.color ?? pin.color;
}

// ---- Internals --------------------------------------------------------

function rasterStyle({ tiles, maxzoom, attribution }) {
  return {
    version: 8,
    sources: {
      "raster-source": {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom,
        attribution,
      },
    },
    layers: [
      {
        id: "raster-layer",
        type: "raster",
        source: "raster-source",
      },
    ],
  };
}

function pinsToFeatureCollection(pins) {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
      properties: {
        id: pin.id,
        color: effectiveColor(pin),
      },
    })),
  };
}

function emptyLineFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function addPinAndRouteLayers() {
  if (!mapInstance) return;

  // Route source + layer first, so it draws underneath the pins (MapLibre
  // z-orders by add-order within a layer type).
  if (!mapInstance.getSource(ROUTE_SOURCE_ID)) {
    mapInstance.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: emptyLineFeatureCollection(),
    });
  }
  if (!mapInstance.getLayer(ROUTE_LAYER_ID)) {
    mapInstance.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: {
        "line-color": "#1d3557",
        "line-width": 3,
        "line-opacity": 0.85,
      },
    });
  }

  if (!mapInstance.getSource(PINS_SOURCE_ID)) {
    mapInstance.addSource(PINS_SOURCE_ID, {
      type: "geojson",
      data: pinsToFeatureCollection(lastPinsSnapshot),
    });
  }
  if (!mapInstance.getLayer(PINS_LAYER_ID)) {
    mapInstance.addLayer({
      id: PINS_LAYER_ID,
      type: "circle",
      source: PINS_SOURCE_ID,
      paint: {
        "circle-radius": 8,
        // ['get', 'color'] reads from feature.properties.color, which we
        // bake from effectiveColor() at render time. So a group rename or
        // recolor flows through renderPins → setData → repaint without
        // touching this layer definition.
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.9,
      },
    });
  }
}

// Hover + drag wiring on the pin layer. Idempotent across style swaps:
// MapLibre keeps `map.on(eventType, layerId, handler)` listeners through
// setStyle() because they're attached to the map, not to layer instances.
// We only register them once at init time.
function attachPinInteractions() {
  if (!mapInstance) return;

  mapInstance.on("mouseenter", PINS_LAYER_ID, () => {
    mapInstance.getCanvas().style.cursor = "grab";
  });
  mapInstance.on("mouseleave", PINS_LAYER_ID, () => {
    if (!dragState) mapInstance.getCanvas().style.cursor = "";
  });

  mapInstance.on("mousedown", PINS_LAYER_ID, (e) => {
    if (e.originalEvent.button !== 0) return;
    const feature = e.features?.[0];
    if (!feature) return;

    e.preventDefault();
    e.originalEvent.stopPropagation();

    mapInstance.dragPan.disable();
    document.body.classList.add("dragging-pin");
    mapInstance.getCanvas().style.cursor = "grabbing";

    dragState = {
      pinId: feature.properties.id,
      lastLngLat: e.lngLat,
    };

    document.addEventListener("mousemove", onDocMove);
    document.addEventListener("mouseup", onDocUp);
    // mouseleave on document fires when the cursor exits the window —
    // commit there so a drag ending off-screen doesn't leak listeners.
    document.addEventListener("mouseleave", onDocUp);
  });
}

function onDocMove(ev) {
  if (!dragState || !mapInstance) return;
  const rect = mapInstance.getContainer().getBoundingClientRect();
  const point = [ev.clientX - rect.left, ev.clientY - rect.top];
  const lngLat = mapInstance.unproject(point);
  dragState.lastLngLat = lngLat;

  // Mutate the live source data so the dragged pin tracks the cursor.
  // We re-use the cached snapshot, swap the dragged pin's coordinates,
  // and re-set the source. Cheap at this app's scale (tens of pins).
  const updated = lastPinsSnapshot.map((p) =>
    p.id === dragState.pinId ? { ...p, lat: lngLat.lat, lon: lngLat.lng } : p
  );
  lastPinsSnapshot = updated;
  const source = mapInstance.getSource(PINS_SOURCE_ID);
  if (source) source.setData(pinsToFeatureCollection(updated));
}

function onDocUp() {
  if (!dragState || !mapInstance) return;
  const { pinId, lastLngLat } = dragState;
  dragState = null;

  document.removeEventListener("mousemove", onDocMove);
  document.removeEventListener("mouseup", onDocUp);
  document.removeEventListener("mouseleave", onDocUp);

  mapInstance.dragPan.enable();
  document.body.classList.remove("dragging-pin");
  mapInstance.getCanvas().style.cursor = "";

  // Routing the new position through updatePin keeps storage and the
  // pin list in sync. The resulting renderPins call repaints the source
  // with the same coordinates we already drew, so it's effectively a
  // no-op for this pin.
  updatePin(pinId, { lat: lastLngLat.lat, lon: lastLngLat.lng });
}
```

- [ ] **Step 1.2: Verify the file compiles (syntax check)**

```bash
node --check /Users/tyadzhak/Projects/vibe-coding-apps/city-pin-map/js/map.js
```

Expected: no output (clean parse). If syntax errors, fix before continuing.

---

## Task 2: Update `index.html` — swap Leaflet for MapLibre

The index.html change is paired with the map.js rewrite — once Leaflet is gone, the old map.js can't load. Note: `dom-to-image-more` stays in this task; HARDEN-010 (Task 4) drops it once the new `export.js` is in place.

**Files:**
- Modify: `index.html` (script + stylesheet tags in `<head>`)

- [ ] **Step 2.1: Replace the Leaflet `<link>` with the MapLibre stylesheet**

Find:

```html
    <!-- Leaflet 1.9.4 — map rendering -->
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin=""
    />
    <script
      defer
      src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
      crossorigin=""
    ></script>
```

Replace with:

```html
    <!-- MapLibre GL JS 4.7.1 — map rendering (HARDEN-009 cutover) -->
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css"
    />
    <script
      defer
      src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"
    ></script>
```

The `defer` attribute on the script ensures `maplibregl` is on `window` before `js/app.js` runs (the module script is also deferred by virtue of being `type="module"`).

We deliberately omit SRI hashes in this swap. Adding them is a separate hardening pass (parallel to HARDEN-005) and HARDEN-012 will note the gap. Mixing concerns here would expand scope.

- [ ] **Step 2.2: Update the head comment block to reflect the new tooling**

Find:

```html
<!--
  City Pin Map — single-page, no-backend web app.

  PNG export library: dom-to-image-more (chosen over html-to-image for slightly
  better Leaflet/canvas-tile compatibility; see jira/core/CORE-001 notes).
  CORE-012 (PNG export) must use this same library — do not mix.

  All third-party libraries are loaded via CDN at exact pinned versions.
  Do not change to "latest" or unpinned tags (CLAUDE.md → Hard rules).
-->
```

Replace with:

```html
<!--
  City Pin Map — single-page, no-backend web app.

  Map rendering: MapLibre GL JS (HARDEN-009 — replaced Leaflet).
  PNG export: native HTML5 Canvas (HARDEN-010 — replaced dom-to-image-more).
  Basemaps: hybrid registry — OpenFreeMap vector styles + retained raster
  providers (HARDEN-011). See js/map.js MAP_STYLES.

  All third-party libraries are loaded via CDN at exact pinned versions.
  Do not change to "latest" or unpinned tags (CLAUDE.md → Hard rules).
-->
```

---

## Task 3: Rewrite `js/export.js` for canvas-based PNG export

Replaces the `dom-to-image-more` DOM-walk export with a canvas-merge pipeline. Same external API (`exportMapAsPng(mapInstance)`, `EXPORT_PRESETS`) so `app.js` doesn't change.

The strategy:
1. Wait for the map to be idle (`map.once('idle', ...)`) so all tiles are painted.
2. For "Current view" with no title strip → just `getCanvas().toDataURL()`.
3. For preset and/or title strip → resize the map element off-screen, wait for idle, then composite map canvas + title strip into a fresh 2D canvas at the preset's CSS-pixel dimensions.
4. Title strip is drawn via `ctx.fillText` using a system font (no webfont CORS taint risk).

**Files:**
- Modify: `js/export.js` (full rewrite, current 305 LOC; expected target ~280 LOC)

- [ ] **Step 3.1: Replace `js/export.js` with the canvas-merge pipeline**

```js
// PNG export via native HTML5 Canvas. Composites the MapLibre WebGL canvas
// + an optional title strip into an off-screen 2D canvas, then toDataURL.
//
// Markers and the route line are layers inside the WebGL canvas (see
// js/map.js — Option B GeoJSONSource + circle/line layers), so they are
// captured automatically by getCanvas(). No post-composite step is needed.

import { showError } from "./storage.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// Same budgets the previous Leaflet impl used; MapLibre's `idle` event
// has slightly different semantics (it includes GPU painting) but the
// wall-clock budget translates cleanly enough.
const TILE_WAIT_TIMEOUT_MS = 8000;
const TILE_WAIT_TIMEOUT_MS_PRESET = 12000;

// CSS-pixel offset that pushes the export frame fully off any reasonable
// viewport. Same value the Leaflet pipeline used.
const OFFSCREEN_PX = -100000;

// Preset id → { width, height } in CSS pixels for the exported PNG.
// `null` means "Current view — capture the live map at its on-screen size".
// 96 dpi for A-series; see NICE-007 notes.
export const EXPORT_PRESETS = {
  current: null,
  square: { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
  "a3-portrait": { width: 1191, height: 1684 },
  "a3-landscape": { width: 1684, height: 1191 },
};

// Title strip layout — matches css/styles.css .export-title-strip so the
// exported PNG looks the same as the previous DOM-walk capture.
const TITLE_STRIP = {
  background: "#ffffff",
  textColor: "#1f2933",
  subtitleColor: "#4b5563",
  // Georgia ships on macOS / Windows / most Linux desktops, so the PNG
  // looks the same on every machine. Same fontstack as the previous CSS.
  fontFamily: 'Georgia, "Times New Roman", serif',
  titleSize: 32,
  titleWeight: 700,
  subtitleSize: 18,
  subtitleStyle: "italic",
  subtitleWeight: 400,
  paddingTop: 24,
  paddingBottom: 20,
  paddingX: 32,
  titleSubtitleGap: 6,
  lineHeightMultiplier: 1.2,
};

/**
 * Capture the current map view and trigger a PNG download.
 * On any failure, surfaces a user-visible message via showError() and keeps
 * the app usable (no re-throw).
 */
export async function exportMapAsPng(mapInstance) {
  try {
    if (!mapInstance) throw new Error("map instance not provided");

    const titleInput = document.getElementById("export-title");
    const subtitleInput = document.getElementById("export-subtitle");
    const title = titleInput ? titleInput.value.trim() : "";
    const subtitle = subtitleInput ? subtitleInput.value.trim() : "";

    const formatSelect = document.getElementById("export-format");
    const presetId = formatSelect ? formatSelect.value : "current";
    const preset = EXPORT_PRESETS[presetId] ?? null;

    let dataUrl;
    if (!title && !subtitle && !preset) {
      // Fast path: live map, no title strip, no resize. Capture the
      // canvas as-is. triggerRepaint + once('render') ensures the
      // framebuffer reflects the current state before we read it.
      await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS);
      mapInstance.triggerRepaint();
      await waitForRender(mapInstance);
      dataUrl = mapInstance.getCanvas().toDataURL("image/png");
    } else {
      dataUrl = await captureFramed(mapInstance, title, subtitle, preset);
    }

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
}

// Single off-screen wrapper that handles both the title strip and the
// preset resize. One try/finally so any failure unwinds the DOM and the
// MapLibre container atomically.
async function captureFramed(mapInstance, title, subtitle, preset) {
  const mapEl = mapInstance.getContainer();

  const originalParent = mapEl.parentNode;
  const originalNextSibling = mapEl.nextSibling;
  const rect = mapEl.getBoundingClientRect();
  const savedInline = {
    position: mapEl.style.position,
    top: mapEl.style.top,
    right: mapEl.style.right,
    bottom: mapEl.style.bottom,
    left: mapEl.style.left,
    width: mapEl.style.width,
    height: mapEl.style.height,
  };

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = `${OFFSCREEN_PX}px`;
  wrapper.style.top = "0";
  wrapper.style.background = TITLE_STRIP.background;

  const frameWidth = preset ? preset.width : rect.width;

  // Pre-compute the title strip metrics on a throwaway canvas context so
  // we know its exact pixel height before the map is resized.
  const titleHeight = title || subtitle
    ? measureTitleStrip({ title, subtitle, width: frameWidth })
    : 0;

  const frameHeight = preset
    ? preset.height
    : rect.height + titleHeight;

  wrapper.style.width = `${frameWidth}px`;
  wrapper.style.height = `${frameHeight}px`;

  // Strip .app-map's inset:0 positioning so the map sits as a normal
  // child of the off-screen wrapper.
  mapEl.style.position = "relative";
  mapEl.style.top = "auto";
  mapEl.style.right = "auto";
  mapEl.style.bottom = "auto";
  mapEl.style.left = "auto";
  mapEl.style.width = `${frameWidth}px`;
  mapEl.style.height = `${frameHeight - titleHeight}px`;

  wrapper.appendChild(mapEl);
  document.body.appendChild(wrapper);

  try {
    // Tell MapLibre the container is a different size. animate:false is
    // implicit — `resize()` doesn't animate.
    mapInstance.resize();
    await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS_PRESET);
    mapInstance.triggerRepaint();
    await waitForRender(mapInstance);

    return composite({
      mapCanvas: mapInstance.getCanvas(),
      mapWidthCss: frameWidth,
      mapHeightCss: frameHeight - titleHeight,
      titleStrip: { title, subtitle, height: titleHeight, width: frameWidth },
      outputWidth: frameWidth,
      outputHeight: frameHeight,
    });
  } finally {
    if (originalNextSibling) {
      originalParent.insertBefore(mapEl, originalNextSibling);
    } else {
      originalParent.appendChild(mapEl);
    }
    mapEl.style.position = savedInline.position;
    mapEl.style.top = savedInline.top;
    mapEl.style.right = savedInline.right;
    mapEl.style.bottom = savedInline.bottom;
    mapEl.style.left = savedInline.left;
    mapEl.style.width = savedInline.width;
    mapEl.style.height = savedInline.height;
    mapInstance.resize();
    wrapper.remove();
  }
}

// Returns the title strip's exact pixel height for the given inputs. Uses
// a throwaway canvas context to measure font metrics — the strip itself
// is drawn into the output canvas later in composite().
function measureTitleStrip({ title, subtitle }) {
  const titleLineHeight = title
    ? Math.ceil(TITLE_STRIP.titleSize * TITLE_STRIP.lineHeightMultiplier)
    : 0;
  const subtitleLineHeight = subtitle
    ? Math.ceil(TITLE_STRIP.subtitleSize * TITLE_STRIP.lineHeightMultiplier)
    : 0;
  const gap = title && subtitle ? TITLE_STRIP.titleSubtitleGap : 0;

  return (
    TITLE_STRIP.paddingTop +
    titleLineHeight +
    gap +
    subtitleLineHeight +
    TITLE_STRIP.paddingBottom
  );
}

// Composite the map canvas + title strip into one output canvas and
// return its data URL. The output canvas is sized in CSS pixels to match
// what dom-to-image-more produced — same on-disk dimensions as the
// previous pipeline, no surprise size change for the user.
function composite({
  mapCanvas,
  mapWidthCss,
  mapHeightCss,
  titleStrip,
  outputWidth,
  outputHeight,
}) {
  const out = document.createElement("canvas");
  out.width = outputWidth;
  out.height = outputHeight;
  const ctx = out.getContext("2d");

  // Solid background under everything — covers the title strip area and
  // any margin if the map is letterboxed.
  ctx.fillStyle = TITLE_STRIP.background;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (titleStrip.height > 0) {
    drawTitleStrip(ctx, titleStrip);
  }

  // Map canvas drawn below the title strip, scaled to CSS pixel dims.
  // mapCanvas.width/.height are device pixels (CSS × dpr); drawImage's
  // 9-arg form rescales to the destination rect.
  ctx.drawImage(
    mapCanvas,
    0,
    0,
    mapCanvas.width,
    mapCanvas.height,
    0,
    titleStrip.height,
    mapWidthCss,
    mapHeightCss
  );

  return out.toDataURL("image/png");
}

function drawTitleStrip(ctx, { title, subtitle, height, width }) {
  ctx.fillStyle = TITLE_STRIP.background;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let cursorY = TITLE_STRIP.paddingTop;

  if (title) {
    ctx.fillStyle = TITLE_STRIP.textColor;
    ctx.font = `${TITLE_STRIP.titleWeight} ${TITLE_STRIP.titleSize}px ${TITLE_STRIP.fontFamily}`;
    const lineHeight = Math.ceil(
      TITLE_STRIP.titleSize * TITLE_STRIP.lineHeightMultiplier
    );
    // textBaseline alphabetic + cursorY+lineHeight*0.85 visually centers
    // the cap-height row in the line-height box. Matches the apparent
    // baseline the CSS engine produces with line-height: 1.2.
    ctx.fillText(title, width / 2, cursorY + lineHeight * 0.85);
    cursorY += lineHeight;
    if (subtitle) cursorY += TITLE_STRIP.titleSubtitleGap;
  }

  if (subtitle) {
    ctx.fillStyle = TITLE_STRIP.subtitleColor;
    ctx.font = `${TITLE_STRIP.subtitleStyle} ${TITLE_STRIP.subtitleWeight} ${TITLE_STRIP.subtitleSize}px ${TITLE_STRIP.fontFamily}`;
    const lineHeight = Math.ceil(
      TITLE_STRIP.subtitleSize * TITLE_STRIP.lineHeightMultiplier
    );
    ctx.fillText(subtitle, width / 2, cursorY + lineHeight * 0.85);
  }
}

// Resolves when MapLibre fires `idle` (all tiles loaded + nothing pending
// to render) or after the timeout, whichever comes first. If the map is
// already idle, `once('idle')` resolves on the next tick.
function waitForIdle(mapInstance, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      mapInstance.off("idle", finish);
      clearTimeout(timer);
      resolve();
    };
    mapInstance.once("idle", finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}

// Resolves on the next render frame. Used after triggerRepaint() so that
// getCanvas().toDataURL() reads pixels that match the current state, not
// the previous frame's framebuffer.
function waitForRender(mapInstance) {
  return new Promise((resolve) => mapInstance.once("render", resolve));
}

function triggerDownload(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

- [ ] **Step 3.2: Verify the file compiles**

```bash
node --check /Users/tyadzhak/Projects/vibe-coding-apps/city-pin-map/js/export.js
```

Expected: no output.

---

## Task 4: Drop `dom-to-image-more` from `index.html`

The new `export.js` is self-contained; the CDN script tag and its SRI hash are no longer needed.

**Files:**
- Modify: `index.html`

- [ ] **Step 4.1: Remove the dom-to-image-more `<script>` tag**

Find:

```html
    <!-- dom-to-image-more 3.5.0 — DOM → PNG export -->
    <script
      defer
      src="https://unpkg.com/dom-to-image-more@3.5.0/dist/dom-to-image-more.min.js"
      integrity="sha384-0PEs9VXKn6x/atQ5H1woMo0cQQnIz11UdqMzjvkDj+U+vxY4xwwj9J+gsbvLNcL9"
      crossorigin="anonymous"
    ></script>
```

Replace with: nothing — delete the whole block including the comment.

---

## Task 5: Smoke-test the rewrite end-to-end via Playwright MCP

Sanity check before we update docs. If anything is broken, fix it now rather than buried inside the doc-cleanup step.

**Files:** none modified.

- [ ] **Step 5.1: Hard-refresh the app in Playwright and check the console**

The dev server from Task 0 should still be running on port 8765. Navigate to `http://localhost:8765` in Playwright with cache disabled, and check the console messages.

Expected: zero errors. Map renders with the OpenFreeMap Liberty style (warm earth tones, visible labels). Pin list is empty if `localStorage` was clean; otherwise, hydrated pins appear as dots on the map.

- [ ] **Step 5.2: Exercise each feature in order**

Run through the regression checklist below in Playwright. After each step, capture a screenshot and check the console.

1. Search "Berlin" → click first result → pin appears on the map.
2. Search "Tokyo" → press Enter → pin appears.
3. Drag the Tokyo pin to a new spot → store updates, pin list reflects new position (hover to see).
4. Toggle "Show route" → polyline appears connecting the pins in createdAt order.
5. Click the swatch in the pin list → pick a new color → marker recolors.
6. Inline rename: click the pencil icon → type a new name → Enter → list + tooltip update.
7. Click "Add group" → set a name + color → assign Berlin to the group → marker recolors to group color.
8. Switch basemap to "Light" → Positron renders, pins + route persist.
9. Switch basemap to "Satellite" → Esri raster renders, pins + route persist.
10. Export PNG with title "MapLibre Cutover" + preset "Square 1:1" → 1080×1080 PNG downloads with title strip and pins visible.
11. Export JSON → file downloads with the current pins + groups.
12. Refresh the page → pins, groups, basemap, route toggle, export text all persist.

- [ ] **Step 5.3: Fix anything broken**

If any of the above fail, debug and fix in `js/map.js` or `js/export.js`. Common gotchas to look for first:
- Coordinate axis flip (MapLibre is `[lon, lat]`, not `[lat, lon]`).
- `setStyle` not re-adding sources/layers — verify the `styledata` listener fires.
- Drag releasing without committing — verify `updatePin` is called in `onDocUp`.
- Export PNG blank / black — `preserveDrawingBuffer: true` missing on init.

Re-run the checklist until all 12 steps pass cleanly.

---

## Task 6: Update `PROJECT.md` tech stack

**Files:**
- Modify: `PROJECT.md` (Tech stack section)

- [ ] **Step 6.1: Read PROJECT.md to find the tech-stack table**

```bash
grep -n -A 20 "Tech stack" /Users/tyadzhak/Projects/vibe-coding-apps/city-pin-map/PROJECT.md
```

- [ ] **Step 6.2: Update the rendering and export library entries**

Replace the row(s) referencing Leaflet with MapLibre GL JS (4.7.1, hosted via jsdelivr CDN). Replace the row(s) referencing dom-to-image-more with "Native HTML5 Canvas (no external library)". Add a row for OpenFreeMap (vector tiles, keyless) under basemap providers.

The exact wording should match the existing column shape — read the file first and follow its format. Do not introduce new columns or restructure the table.

---

## Task 7: Update `CLAUDE.md` — flip the parked entry, refresh "What's shipped"

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 7.1: Update the "What's shipped" Leaflet line**

Find the line starting with "Leaflet map with 7 basemap styles" and replace with something that references MapLibre + the hybrid registry. Concretely:

> MapLibre GL JS map (HARDEN-009 cutover) with 7 basemap styles via a hybrid registry (HARDEN-011): 4 vector styles from OpenFreeMap (Liberty/Positron/Dark/Bright) plus 3 retained raster providers (Wikimedia, OpenTopoMap, Esri Satellite). Switchable from the header.

- [ ] **Step 7.2: Update the PNG export bullet**

Find the bullet starting with "PNG export with optional title/subtitle band" and append "(HARDEN-010 — native canvas pipeline; replaced dom-to-image-more)" to it.

- [ ] **Step 7.3: Flip the "Considered and parked" entry**

Replace the existing MapLibre paragraph in the "Considered and parked" section with a new paragraph that parks Leaflet + raster instead. Concrete content:

> **Leaflet + raster-only basemaps.** Replaced by MapLibre GL JS + a hybrid registry in HARDEN-009..012, after the user authorized the cutover during a single session in 2026-05-08. Reverting would be ~18 h of work and would lose: smooth fractional zoom, retina-crisp text on the 4 vector styles, the data-driven group-color paint expression on markers, and the canvas-native export pipeline (replacing it with the previous dom-to-image-more DOM walk would re-introduce the font-tainting and SRI-pinning surface area). The current parked stack is preserved in `git log` and the closed task files HARDEN-001..007 for reference.

- [ ] **Step 7.4: Update the "Libraries (load via CDN)" subsection**

Find the lines listing leaflet@1.9.4 and dom-to-image-more@3.5.0. Replace with:

```markdown
- `maplibre-gl@4.7.1` — map rendering. Loaded via jsdelivr CDN.
- (No PNG export library — native HTML5 Canvas, see `js/export.js`.)
```

- [ ] **Step 7.5: Update the "Pin data model" prose if needed**

Check if any of the text references Leaflet markers, circleMarker, or polyline. If so, replace with the MapLibre equivalents (GeoJSON source + circle layer for markers; GeoJSON source + line layer for the route). Keep the data shape unchanged — pin and group records didn't change.

---

## Task 8: Append a footnote to HARDEN-005

The SRI hash for `dom-to-image-more` was the entire purpose of HARDEN-005. The dependency is now gone.

**Files:**
- Modify: `jira/harden/HARDEN-005-sri-hash-dom-to-image.md`

- [ ] **Step 8.1: Append a "Superseded by HARDEN-012" footnote**

After the last line of the file, append:

```markdown

---

## Superseded by HARDEN-012 (2026-05-08)

`dom-to-image-more` was retired during the MapLibre cutover. The SRI hash this task pinned no longer applies to any loaded asset — the entire `<script>` tag was removed from `index.html`. This task remains in the historical record for the SRI hardening pattern it established (since reapplied to MapLibre's own CDN tag in HARDEN-012's followup).
```

(The trailing parenthetical is honest about a remaining gap — Task 2 omitted SRI on the MapLibre tag. HARDEN-012 closes by noting this so a follow-up task can be filed.)

---

## Task 9: Mark each task file Done and capture the implementation prompts that were drafted

Each task file's "Implementation prompt" section was a placeholder ("To be drafted at PROCEED time"). Now that we've drafted and executed them, fill the section with a one-paragraph reference back to this plan, and flip Status to Done.

**Files:**
- Modify: `jira/harden/HARDEN-009-port-map-js-to-maplibre.md`
- Modify: `jira/harden/HARDEN-010-rewrite-export-canvas.md`
- Modify: `jira/harden/HARDEN-011-port-map-styles-to-vector.md`
- Modify: `jira/harden/HARDEN-012-maplibre-cutover-cleanup.md`

- [ ] **Step 9.1: For each of the four files, set `Status` to `Done`**

Edit the table at the top of each file. Change `| **Status**      | `Todo` | ` to `Done`.

- [ ] **Step 9.2: For each of the four files, fill the Implementation prompt section**

Replace the placeholder text with a short pointer to the plan plus the design choices made:

```markdown
## Implementation prompt

Executed via `docs/superpowers/plans/2026-05-08-maplibre-cutover.md`. Design choices made by Claude per user authorization on 2026-05-08:

- **Markers**: GeoJSON source + circle layer (Option B from spike findings). Group color override is a data-driven `['get', 'color']` paint expression, with `effectiveColor()` materialized into each Feature's properties at render time.
- **MAP_STYLES**: hybrid registry — 4 OpenFreeMap vector styles (Liberty/Positron/Dark/Bright) + 3 retained raster providers (Wikimedia/OpenTopoMap/Esri Satellite) wrapped as inline MapLibre styles.
- **Export**: canvas-merge — `getCanvas() → drawImage` + title strip via `ctx.fillText`, no DOM walk, no `dom-to-image-more`.

See plan file for the full sequence and verification steps.
```

- [ ] **Step 9.3: Tick every acceptance-criteria checkbox in each file**

For each of the 4 task files, walk the acceptance-criteria list and tick `[x]` on every line. (We verified all of them in Task 5's regression pass; the doc-cleanup tasks 6–8 closed the documentation criteria in HARDEN-012.)

---

## Task 10: Final regression pass — second smoke test after doc updates

Catches doc-update accidents (e.g. a CLAUDE.md edit that broke the file structure) and confirms the app is still healthy.

- [ ] **Step 10.1: Hard-refresh the app, run through the 12-step regression checklist again**

Same checklist as Task 5.2. Should pass identically. If any step fails now and didn't fail in Task 5, the doc-update task accidentally touched application code or settings — investigate.

- [ ] **Step 10.2: Stop the dev server**

```bash
# Find and kill the python3 -m http.server process started in Task 0.
ps aux | grep "http.server 8765" | grep -v grep | awk '{print $2}' | xargs -r kill
```

---

## Self-review notes

**Spec coverage:**
- HARDEN-009 acceptance criteria — covered by Tasks 1+2 (rewrite + index.html swap), verified in Task 5.2.
- HARDEN-010 acceptance criteria — covered by Tasks 3+4 (rewrite + dom-to-image-more removal), verified in Task 5.2.
- HARDEN-011 acceptance criteria — covered by Task 1's MAP_STYLES registry section, verified in Task 5.2 step 8/9.
- HARDEN-012 acceptance criteria — covered by Tasks 6/7/8/9/10 (doc updates + regression pass).

**Type consistency:**
- `MAP_STYLES` shape changes: `url` + `attribution` + `maxZoom` → single `style` field. Verified the only consumers are `setMapStyle` (this module) and `app.js`'s `initMapStyleSelector` (which only reads `id` and `label` — both still present).
- `effectiveColor` signature unchanged; called from `pin-list.js` (stays).
- Public function signatures in `map.js`: `initMap`, `setMapStyle`, `getMap`, `renderPins`, `renderRoute`, `effectiveColor` — all preserved.

**Placeholders:** none. All code blocks are concrete.

**Gaps known and accepted:**
- SRI hash on the new MapLibre `<script>` tag is omitted in Task 2, by design — it's a separate hardening pass parallel to HARDEN-005, not part of this cutover. HARDEN-005's footnote (Task 8.1) calls this out so a follow-up task can be filed.
- The "merge attribution control across raster/vector providers cleanly" criterion in HARDEN-011 is met by `addControl(new maplibregl.AttributionControl({ compact: true }))` in `initMap`. MapLibre auto-merges attribution from the active style's sources — no manual merge code needed.
