// Leaflet setup, tile layers, and pin → marker rendering.
//
// Leaflet is loaded as a classic <script defer> in index.html and exposes
// the global `L`. This module wraps initialization so the rest of the app
// never has to touch `L` directly — they go through `getMap()`.

import { updatePin } from "./pins.js";

// Module-scoped singleton. Treat as private; outside callers use getMap().
let mapInstance = null;

// pinId → Leaflet marker. Lets renderPins sync the visible markers against
// the pin store in O(n), preserving marker identity across updates so any
// per-marker Leaflet state (open tooltips, future drag handles, etc.) is
// not destroyed on every change.
const markers = new Map();

/**
 * Initialize the Leaflet map inside the given container element id.
 * Idempotent: calling twice returns the existing instance instead of
 * re-binding (Leaflet throws "Map container is already initialized" otherwise).
 */
export function initMap(containerId) {
  if (mapInstance) return mapInstance;

  // Latitude 20 (not 0) keeps populated landmasses centered vertically;
  // zoom 2 fits the whole world on a typical desktop viewport.
  mapInstance = L.map(containerId).setView([20, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapInstance);

  return mapInstance;
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

// Marker style: L.circleMarker. Picked over L.divIcon for simplicity and
// because vector circles capture cleanly in the dom-to-image-more export
// path (CORE-012). renderPins handles .addTo(map); these two functions
// only build / mutate the marker itself.

function createMarker(pin) {
  const marker = L.circleMarker([pin.lat, pin.lon], {
    radius: 8,
    color: pin.color,
    fillColor: pin.color,
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
  marker.setLatLng([pin.lat, pin.lon]);
  marker.setStyle({ color: pin.color, fillColor: pin.color });
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
