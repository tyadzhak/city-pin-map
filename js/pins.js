// Default color for a newly-created pin — used by every add path (manual
// search-and-select in search.js, foreign-file import in import-foreign.js)
// so there is one place to change the shade the app ships with.
export const DEFAULT_PIN_COLOR = "#e63946";

const pins = [];
const listeners = [];

function notify() {
  const snapshot = listPins();
  for (const fn of listeners.slice()) {
    try {
      fn(snapshot);
    } catch (err) {
      console.error("pin store listener threw:", err);
    }
  }
}

/**
 * Add a new pin to the store.
 *
 * @param {object} input
 * @param {string} input.name - User-facing label.
 * @param {number} input.lat
 * @param {number} input.lon
 * @param {string} input.color - Hex like "#e63946". Overridden visually by group color when assigned.
 * @param {string|null} [input.group=null] - Group id; null means ungrouped.
 * @param {string|null} [input.icon=null] - Icon id from the registry; null falls back to DEFAULT_PIN_ICON at render time.
 * @param {number} [input.originalLat] - Geocoded origin latitude, captured once at creation (FBL-008). Optional; omitted for add paths that don't supply an origin.
 * @param {number} [input.originalLon] - Geocoded origin longitude, captured once at creation (FBL-008). Optional; omitted for add paths that don't supply an origin.
 * @returns {object} The created pin.
 */
export function addPin({ name, lat, lon, color, group = null, icon = null, originalLat, originalLon }) {
  const pin = {
    id: crypto.randomUUID(),
    name,
    lat,
    lon,
    color,
    group,
    icon,
    createdAt: Date.now(),
  };
  // originalLat/originalLon are optional (FBL-008): the "reset position"
  // affordance restores a deliberately-dragged pin to its geocoded origin.
  // Only stamp them when the caller supplies finite values — never invent an
  // origin for a pin that didn't provide one (pre-FBL-008 pins have none).
  if (Number.isFinite(originalLat) && Number.isFinite(originalLon)) {
    pin.originalLat = originalLat;
    pin.originalLon = originalLon;
  }
  pins.push(pin);
  notify();
  return pin;
}

export function removePin(id) {
  const idx = pins.findIndex((p) => p.id === id);
  if (idx === -1) return;
  pins.splice(idx, 1);
  notify();
}

export function updatePin(id, patch) {
  const idx = pins.findIndex((p) => p.id === id);
  if (idx === -1) return;
  pins[idx] = { ...pins[idx], ...patch, id: pins[idx].id };
  notify();
}

export function listPins() {
  return pins.slice();
}

export function replaceAll(newPins) {
  pins.length = 0;
  pins.push(...newPins);
  notify();
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
