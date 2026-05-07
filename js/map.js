// Leaflet setup, tile layers, and pin → marker rendering.
//
// Leaflet is loaded as a classic <script defer> in index.html and exposes
// the global `L`. This module wraps initialization so the rest of the app
// never has to touch `L` directly — they go through `getMap()`.

import { updatePin } from "./pins.js";
import { listGroups } from "./groups.js";
import { saveMapStyle } from "./storage.js";

// Registry of available basemap styles. Single source of truth: js/app.js
// reads this to populate the header <select>, so adding a style here is the
// only change needed to expose it in the UI. All styles must be free and
// key-free per CLAUDE.md → "Hard rules".
export const MAP_STYLES = [
  {
    id: "osm",
    label: "OSM Standard",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  {
    id: "carto-light",
    label: "Light",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
  {
    id: "carto-dark",
    label: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
  {
    id: "topo",
    label: "Topographic",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
];

export const DEFAULT_MAP_STYLE_ID = "osm";

// Module-scoped singleton. Treat as private; outside callers use getMap().
let mapInstance = null;
// Reference to the currently-mounted L.TileLayer. setMapStyle() swaps this
// in place; null until initMap() runs setMapStyle() for the first time.
let activeTileLayer = null;

// pinId → Leaflet marker. Lets renderPins sync the visible markers against
// the pin store in O(n), preserving marker identity across updates so any
// per-marker Leaflet state (open tooltips, future drag handles, etc.) is
// not destroyed on every change.
const markers = new Map();

// Single managed L.polyline for the optional connecting route (NICE-003).
// Treat as private; renderRoute is the only legitimate caller. Null when
// the route is hidden or there are <2 pins, so callers can read this as
// "is the route currently on the map?". Color picked to read clearly on
// both light and dark basemaps without colliding with the default pin red.
const ROUTE_STYLE = { color: "#1d3557", weight: 3, opacity: 0.85 };
let routePolyline = null;

/**
 * Initialize the Leaflet map inside the given container element id.
 * Idempotent: calling twice returns the existing instance instead of
 * re-binding (Leaflet throws "Map container is already initialized" otherwise).
 *
 * The initial tile layer is painted via setMapStyle so first-paint and later
 * style swaps share one code path. Callers that want a non-default style on
 * boot (e.g. restoring a saved preference) should call setMapStyle right
 * after initMap, before any pins render.
 */
export function initMap(containerId, initialStyleId = DEFAULT_MAP_STYLE_ID) {
  if (mapInstance) return mapInstance;

  // Latitude 20 (not 0) keeps populated landmasses centered vertically;
  // zoom 2 fits the whole world on a typical desktop viewport.
  mapInstance = L.map(containerId).setView([20, 0], 2);

  setMapStyle(initialStyleId, { persist: false });

  return mapInstance;
}

/**
 * Swap the active basemap to the style identified by `styleId`.
 * Falls back to OSM (with a console.warn) if the id isn't in MAP_STYLES.
 *
 * `persist`: when true (the default) the choice is saved via storage. The
 * initMap call passes `persist: false` so first-paint with a hydrated style
 * doesn't write back the same value that was just loaded.
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

  // Add-then-remove order: the new layer mounts on top, paints over the old
  // tiles as it loads, then the old layer (with its attribution string) is
  // removed in the same tick. The user sees a smooth fade rather than a
  // grey flash. The old layer's attribution is dropped from Leaflet's
  // attribution control on remove(), so no duplicate lines accumulate.
  const previousLayer = activeTileLayer;
  activeTileLayer = L.tileLayer(style.url, {
    attribution: style.attribution,
    maxZoom: style.maxZoom,
  }).addTo(mapInstance);
  if (previousLayer) previousLayer.remove();

  if (persist) saveMapStyle(style.id);
}

/**
 * Returns the live map instance, or null if initMap() hasn't run yet.
 * Other modules (pins, export) will use this once they come online.
 */
export function getMap() {
  return mapInstance;
}

/**
 * Synchronize the rendered marker set with `pins`.
 *
 * - Pins newly present in the array → a marker is created and added.
 * - Pins still present → the existing marker is mutated in place.
 * - Markers whose pin is gone → removed from the map.
 *
 * Safe to call on every pin-store change. No-op until initMap() has run.
 */
export function renderPins(pins) {
  if (!mapInstance) return;

  const seen = new Set();
  for (const pin of pins) {
    seen.add(pin.id);
    const existing = markers.get(pin.id);
    if (existing) {
      updateMarker(existing, pin);
    } else {
      const marker = createMarker(pin).addTo(mapInstance);
      markers.set(pin.id, marker);
    }
  }

  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }
}

/**
 * Synchronize the connecting-route polyline against `pins` and the toggle.
 *
 * Lives in its own function (rather than folded into renderPins) because
 * the visibility toggle is orthogonal to the pin set: the route can change
 * without pins changing (toggle on/off), and pins can change without the
 * route's visibility changing (add/remove/drag). Two listeners on the pin
 * store, each with one job, keeps the data flow legible.
 *
 * Behaviour:
 * - When hidden, or fewer than 2 pins, the polyline is removed and the
 *   ref is nulled so map._layers stays clean (acceptance criterion).
 * - Otherwise, pins are sorted by createdAt ascending — that's the order
 *   the user pinned cities, which is the natural travel-narrative order
 *   (PROJECT.md → "documenting a multi-city trip").
 * - The polyline instance is reused across updates via setLatLngs to keep
 *   add-order stable; recreating it on every change would push it back on
 *   top of the markers and force a fresh DOM node each time.
 */
export function renderRoute(pins, { visible }) {
  if (!mapInstance) return;

  if (!visible || pins.length < 2) {
    if (routePolyline) {
      routePolyline.remove();
      routePolyline = null;
    }
    return;
  }

  const ordered = pins.slice().sort((a, b) => a.createdAt - b.createdAt);
  const latLngs = ordered.map((p) => [p.lat, p.lon]);

  if (routePolyline) {
    routePolyline.setLatLngs(latLngs);
  } else {
    routePolyline = L.polyline(latLngs, ROUTE_STYLE).addTo(mapInstance);
  }
  // Markers are added to the map before this runs (renderPins is subscribed
  // first), and Leaflet z-orders SVG overlays by add-time, not CSS z-index.
  // Without bringToBack the line draws on top of the markers it connects.
  routePolyline.bringToBack();
}

// Resolve the color a pin should render as. Group color wins when the pin
// is assigned to a still-existing group; otherwise the pin's own color is
// the source of truth. A pin whose `group` references a deleted group is
// silently treated as ungrouped — render must never crash on stale data
// (NICE-005 acceptance criterion).
//
// Re-reads the group list on every call. Cheap at v2 scale (handfuls of
// groups) and avoids any caching concerns when groups are renamed/recolored.
export function effectiveColor(pin) {
  if (!pin.group) return pin.color;
  const group = listGroups().find((g) => g.id === pin.group);
  return group?.color ?? pin.color;
}

// Marker style: L.circleMarker. Picked over L.divIcon for simplicity and
// because vector circles capture cleanly in the dom-to-image-more export
// path (CORE-012). renderPins handles .addTo(map); these two functions
// only build / mutate the marker itself.

function createMarker(pin) {
  const color = effectiveColor(pin);
  const marker = L.circleMarker([pin.lat, pin.lon], {
    radius: 8,
    color,
    fillColor: color,
    fillOpacity: 0.9,
    weight: 2,
  }).bindTooltip(pin.name);

  // The SVG element only exists after the marker is added to the map.
  marker.on("add", () => {
    const el = marker.getElement();
    if (el) el.classList.add("city-pin");
  });

  attachDragHandlers(marker, pin.id);
  return marker;
}

function updateMarker(marker, pin) {
  const color = effectiveColor(pin);
  marker.setLatLng([pin.lat, pin.lon]);
  marker.setStyle({ color, fillColor: color });
  marker.setTooltipContent(pin.name);
}

// Manual drag for L.circleMarker (which has no built-in `draggable` option).
// Listeners live on `document` rather than the map so the marker keeps
// tracking the cursor when it leaves the map pane (e.g. into the side panel
// or briefly out of the window). The store is updated only on release —
// during the drag we mutate the marker directly so the visible position
// stays smooth without one localStorage write per pixel.
function attachDragHandlers(marker, pinId) {
  marker.on("mousedown", (leafletEvent) => {
    // Without this, the map's container-level drag handler also fires and
    // the world pans alongside the marker.
    L.DomEvent.stopPropagation(leafletEvent.originalEvent);
    L.DomEvent.preventDefault(leafletEvent.originalEvent);

    const map = mapInstance;
    if (!map) return;

    const container = map.getContainer();
    const markerEl = marker.getElement();
    let lastLatLng = marker.getLatLng();

    map.dragging.disable();
    if (markerEl) markerEl.classList.add("city-pin--dragging");
    document.body.classList.add("dragging-pin");

    function onMove(ev) {
      const rect = container.getBoundingClientRect();
      const point = L.point(ev.clientX - rect.left, ev.clientY - rect.top);
      lastLatLng = map.containerPointToLatLng(point);
      marker.setLatLng(lastLatLng);
    }

    function commit() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", commit);
      document.removeEventListener("mouseleave", commit);

      map.dragging.enable();
      if (markerEl) markerEl.classList.remove("city-pin--dragging");
      document.body.classList.remove("dragging-pin");

      // Routing the new position through updatePin keeps storage and the
      // pin list in sync; the resulting renderPins() call is a no-op for
      // this marker because setLatLng matches lastLatLng we already set.
      updatePin(pinId, { lat: lastLatLng.lat, lon: lastLatLng.lng });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", commit);
    // Fires when the cursor leaves the document/window — without this a
    // drag that ends outside the browser leaves listeners attached.
    document.addEventListener("mouseleave", commit);
  });
}
