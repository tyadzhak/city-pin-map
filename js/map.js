// Leaflet setup and tile layer wiring. Pin rendering is added in CORE-005.
//
// Leaflet is loaded as a classic <script defer> in index.html and exposes
// the global `L`. This module wraps initialization so the rest of the app
// never has to touch `L` directly — they go through `getMap()`.

// Module-scoped singleton. Treat as private; outside callers use getMap().
let mapInstance = null;

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
