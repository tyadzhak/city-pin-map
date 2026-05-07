// Renders the pin store into the side panel as a flat, scrollable list.
//
// CORE-008 delivers the *display* half of "list of pins with edit and delete".
// Remove buttons (CORE-009), inline rename (CORE-010), and color picker
// (CORE-011) attach their controls to the rows produced here.

import { subscribe, listPins, removePin, updatePin } from "./pins.js";

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
  // Side effect: a row in rename mode is destroyed if any pin changes.
  // Acceptable here because store mutations only happen from user actions
  // that would have blurred the input first (search, remove, etc.).
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
  // Acts as a button that opens the native color picker. role + tabindex
  // pair makes a non-button element keyboard-focusable and announced as
  // a button by screen readers.
  swatch.setAttribute("role", "button");
  swatch.setAttribute("tabindex", "0");
  swatch.setAttribute("aria-label", `Change color of pin ${pin.name}`);

  // Hidden <input type="color"> sits next to the swatch and is opened
  // programmatically. It always returns a 7-char #rrggbb string, which
  // matches the pin store's color contract (CLAUDE.md → Pin data model)
  // — no normalization needed.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "pin-list__color-input";
  colorInput.value = pin.color;
  colorInput.tabIndex = -1;
  colorInput.setAttribute("aria-hidden", "true");

  const openPicker = () => colorInput.click();
  swatch.addEventListener("click", openPicker);
  swatch.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  // `change` only fires when the user actually picks a color; cancelling
  // the dialog (Escape, click-away) is silent — so no commit on cancel.
  // updatePin → notify() fans out: this row re-renders with the new
  // swatch color (CORE-008) and the marker recolors (CORE-005).
  colorInput.addEventListener("change", () => {
    updatePin(pin.id, { color: colorInput.value });
  });

  const name = document.createElement("span");
  name.className = "pin-list__name";
  // textContent (not innerHTML) — pin.name is user- or geocoder-provided.
  name.textContent = pin.name;

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit-pin";
  edit.textContent = "✎";
  edit.setAttribute("aria-label", `Rename pin ${pin.name}`);
  edit.addEventListener("click", () => enterRenameMode(pin, name));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-pin";
  remove.textContent = "✕";
  remove.setAttribute("aria-label", `Remove pin ${pin.name}`);
  remove.addEventListener("click", () => removePin(pin.id));

  row.appendChild(swatch);
  row.appendChild(colorInput);
  row.appendChild(name);
  row.appendChild(edit);
  row.appendChild(remove);
  return row;
}

// Swaps the name <span> for an <input>, wires Enter/Escape/blur, and
// commits via updatePin on Enter/blur with a non-empty trimmed value.
//
// A `finalized` latch prevents double-commit: a successful Enter triggers
// updatePin -> notify -> re-render, which removes the input from the DOM
// and synthesizes a blur event after we've already committed.
function enterRenameMode(pin, nameEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pin-list__rename-input";
  input.value = pin.name;
  input.setAttribute("aria-label", `Rename pin ${pin.name}`);

  let finalized = false;

  const finalize = (mode) => {
    if (finalized) return;
    finalized = true;

    if (mode === "commit") {
      const trimmed = input.value.trim();
      if (trimmed && trimmed !== pin.name) {
        // The store will fan out: list re-renders this row, map updates
        // the marker tooltip, storage subscriber persists. Done.
        updatePin(pin.id, { name: trimmed });
        return;
      }
    }
    // Cancel, empty rejection, or no-op commit: revert the row in place.
    // Safe even if the input has already been detached by a re-render.
    if (input.isConnected) {
      input.replaceWith(nameEl);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finalize("commit");
    } else if (e.key === "Escape") {
      e.preventDefault();
      finalize("cancel");
    }
  });
  input.addEventListener("blur", () => finalize("commit"));

  nameEl.replaceWith(input);
  // .select() makes typing immediately replace the existing name —
  // matches the "I'm overwriting this" mental model better than a caret
  // at the end of the text.
  input.focus();
  input.select();
}
