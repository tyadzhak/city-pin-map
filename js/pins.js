// Default color for a newly-created pin. The add paths (search.js,
// import-foreign.js) no longer read this directly — they consume the
// user-configurable default via storage.js's loadDefaultPin(), whose
// normalizeDefaultPin falls back to this value. Still the ultimate
// fallback for a missing/blank color on JSON-backup import (backup.js)
// and the boot-time pin normalizer (storage.js) — one place to change the
// shade the app ships with.
export const DEFAULT_PIN_COLOR = "#e63946";

/**
 * Resolve the color a pin should render as — the pure precedence rule
 * behind js/map.js's effectiveColor() (which supplies the live group +
 * default-pin color and delegates here). Kept pure/standalone (no group or
 * localStorage lookups) so it's node-testable without a DOM (js/pins.test.mjs).
 *
 * Precedence (2026-08-11 pin-color-precedence flip — user decision): a
 * pin's own CUSTOMIZED color always wins now; group color is only a
 * DEFAULT for a pin that was never given a custom color (`pin.color ===
 * null`); the app-wide default-pin color (Design tab) is the final
 * fallback when there's no group either (or the group is stale/deleted).
 *
 *   1. `pin.color`, when it's a concrete (non-empty string) value —
 *      "customized" in the data model's sense.
 *   2. else `group.color`, when `group` is a live (non-null) group object
 *      carrying a concrete color.
 *   3. else `defaultColor` (whatever the caller passes — typically
 *      `loadDefaultPin().color`, itself already normalized to a hex).
 *
 * Tolerant of malformed input by design — a missing/undefined `pin.color`,
 * a stale group (pass `null`, never throw on a dangling id yourself), or a
 * missing `defaultColor` never throw; the caller just gets whatever
 * `defaultColor` was (even `undefined`) as the last resort. Render must
 * never crash on stale/malformed pin data (CLAUDE.md invariant).
 *
 * @param {{color?: string|null}|null|undefined} pin
 * @param {{color?: string}|null|undefined} group - The pin's live group, or
 *   null/undefined when ungrouped or the reference is stale.
 * @param {string} [defaultColor] - Final fallback, typically the
 *   default-pin config's color.
 * @returns {string|undefined}
 */
export function resolvePinColor(pin, group, defaultColor) {
  const own = pin?.color;
  if (typeof own === "string" && own) return own;
  const groupColor = group?.color;
  if (typeof groupColor === "string" && groupColor) return groupColor;
  return defaultColor;
}

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
 * @param {string|null} input.color - Hex like "#e63946", or null to INHERIT
 *   (2026-08-11 pin-color-precedence flip): a customized (concrete) color
 *   always wins at render time; null falls through to the live group's
 *   color when assigned, else the default-pin config color. See
 *   resolvePinColor below for the precedence and js/map.js's
 *   effectiveColor() for the render-time consumer.
 * @param {string|null} [input.group=null] - Group id; null means ungrouped.
 * @param {string|null} [input.icon=null] - Icon id from the registry; null falls back to DEFAULT_PIN_ICON at render time.
 * @param {number} [input.originalLat] - Geocoded origin latitude, captured once at creation (FBL-008). Optional; omitted for add paths that don't supply an origin.
 * @param {number} [input.originalLon] - Geocoded origin longitude, captured once at creation (FBL-008). Optional; omitted for add paths that don't supply an origin.
 * @returns {object} The created pin.
 */
export function addPin({
  name,
  lat,
  lon,
  color,
  group = null,
  icon = null,
  originalLat,
  originalLon,
}) {
  const pin = {
    id: crypto.randomUUID(),
    name,
    lat,
    lon,
    color,
    group,
    icon,
    // labelDx/labelDy (per-pin label drag offset) are deliberately NOT
    // defaulted here — absence means "no offset" (0), same contract as
    // originalLat/originalLon just below. The pin itself is never
    // draggable; only its label is.
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

// Undo support (UXR-004): re-insert a deleted pin verbatim (same id and
// fields) at its old list index, so list order and the createdAt-ordered
// route come back exactly. Targeted, so concurrent edits to other pins
// survive. No-op if a pin with that id already exists.
export function restorePin(pin, index) {
  if (pins.some((p) => p.id === pin.id)) return;
  const i = Number.isInteger(index) ? Math.max(0, Math.min(index, pins.length)) : pins.length;
  pins.splice(i, 0, { ...pin });
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

// UXR-009: pure reorder computation. The list and the route both order by
// `createdAt`, so a reorder is expressed by REASSIGNING the existing
// createdAt values (sorted ascending) to the pins in their new visual order:
// no new pin field, and backups and the route follow automatically.
// `pins` may be in any order (visual order = createdAt ascending). Returns
// new pin objects in the NEW visual order, or null when nothing would change
// (unknown id or same position). `newIndex` is clamped.
export function reorderByCreatedAt(pins, movedId, newIndex) {
  const order = pins.slice().sort((a, b) => a.createdAt - b.createdAt);
  const from = order.findIndex((p) => p.id === movedId);
  if (from === -1) return null;
  const to = Math.max(0, Math.min(order.length - 1, Math.trunc(newIndex)));
  if (!Number.isFinite(to) || to === from) return null;
  const values = order.map((p) => p.createdAt);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  // Duplicate/NaN createdAt values would leave the new order ambiguous
  // (stable-sort ties), so force strictly increasing values.
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) values[i] = i === 0 ? 0 : values[i - 1];
    if (i > 0 && values[i] <= values[i - 1]) values[i] = values[i - 1] + 1;
  }
  return order.map((p, i) => ({ ...p, createdAt: values[i] }));
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
