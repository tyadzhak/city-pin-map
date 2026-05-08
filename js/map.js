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

  const initial =
    MAP_STYLES.find((s) => s.id === initialStyleId) ??
    MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE_ID);

  // MapLibre uses [lon, lat]; our previous Leaflet code used [lat, lon].
  // Center [0, 20] → 20° north, 0° east, matching the previous setView.
  mapInstance = new maplibregl.Map({
    container: containerId,
    style: initial.style,
    center: [0, 20],
    zoom: 2,
    preserveDrawingBuffer: true,
  });

  // The first style emits `load` once tiles + sprites + glyphs are ready.
  // Re-add markers/route here so a hydrated pin set paints on first frame
  // even though renderPins was called before the style was ready.
  mapInstance.on("load", () => {
    addPinAndRouteLayers();
    renderPins(lastPinsSnapshot);
    renderRoute(lastPinsSnapshot, { visible: lastRouteVisible });
  });
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
