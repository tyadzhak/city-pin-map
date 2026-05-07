// Renders the pin store into the side panel as a flat, scrollable list.
//
// CORE-008 delivers the *display* half of "list of pins with edit and delete".
// Remove buttons (CORE-009), inline rename (CORE-010), and color picker
// (CORE-011) attach their controls to the rows produced here.

import { subscribe, listPins } from "./pins.js";

/**
 * Wires the list to the pin store. Call once during bootstrap, after
 * storage hydration so the first render reflects persisted pins.
 *
 * Returns an unsubscribe function for symmetry with subscribe(), even
 * though app.js currently never tears down.
 */
export function initPinList() {
  const listEl = document.getElementById("pin-list");
  const emptyEl = document.getElementById("pin-list-empty");

  if (!listEl || !emptyEl) {
    console.warn("pin-list elements missing; list will not render");
    return () => {};
  }

  const unsubscribe = subscribe((pins) => render(listEl, emptyEl, pins));
  // Backfill the hydration notify() that fired before we subscribed.
  // See app.js for the same pattern around renderPins().
  render(listEl, emptyEl, listPins());
  return unsubscribe;
}

function render(listEl, emptyEl, pins) {
  // Defensive copy is already provided by listPins(); the snapshot passed
  // through the listener is also a slice. Sorting here is therefore safe
  // and won't disturb other subscribers.
  const sorted = pins.slice().sort((a, b) => a.createdAt - b.createdAt);

  // Full clear-and-rebuild is fine at Core scale (tens of pins).
  listEl.replaceChildren(...sorted.map(buildRow));
  emptyEl.hidden = sorted.length > 0;
}

function buildRow(pin) {
  const row = document.createElement("li");
  row.className = "pin-list__row";
  row.dataset.pinId = pin.id;

  const swatch = document.createElement("span");
  swatch.className = "pin-list__swatch";
  // Inline style is the right tool here: the color is per-pin data, not
  // a design token. CSS handles the size/shape; the value comes from state.
  swatch.style.background = pin.color;
  swatch.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "pin-list__name";
  // textContent (not innerHTML) — pin.name is user- or geocoder-provided.
  name.textContent = pin.name;

  row.appendChild(swatch);
  row.appendChild(name);
  return row;
}
