// Renders the pin store into the side panel as a flat, scrollable list.
//
// CORE-008 delivers the *display* half of "list of pins with edit and delete".
// Remove buttons (CORE-009), inline rename (CORE-010), and color picker
// (CORE-011) attach their controls to the rows produced here.
//
// NICE-005 adds a per-row group selector and the "effective color" rule:
// when a pin is assigned to a group, the row's appearance tile (and the
// marker on the map) renders with the group's color, not the pin's own.
// The pin's individual color stays untouched in storage — un-grouping
// restores it.
//
// PI-001 (icon picker, this iteration) replaces the bare color swatch
// with an "appearance tile": a single button that previews the chosen
// icon at the chosen color. Clicking the tile opens a popover with the
// 6-icon grid AND the native color input — color and icon are siblings
// of "appearance" so they share one affordance.

import { subscribe, listPins, removePin, updatePin } from "./pins.js";
import {
  subscribe as subscribeGroups,
  listGroups,
} from "./groups.js";
import { effectiveColor } from "./map.js";
import { effectiveIcon, getIcon } from "./icons.js";
import { openIconPicker } from "./icon-picker.js";

/**
 * Wires the list to the pin store AND the group store. Call once during
 * bootstrap, after both stores have been hydrated so the first render
 * reflects persisted data.
 *
 * Returns an unsubscribe function that tears down both subscriptions, for
 * symmetry with subscribe(). app.js currently never tears down.
 */
export function initPinList() {
  const listEl = document.getElementById("pin-list");
  const emptyEl = document.getElementById("pin-list-empty");

  if (!listEl || !emptyEl) {
    console.warn("pin-list elements missing; list will not render");
    return () => {};
  }

  const unsubPins = subscribe((pins) => render(listEl, emptyEl, pins));
  // Group changes (rename, recolor, delete) all alter what the row should
  // display — selector options, tile color — so re-render the whole list
  // from a fresh pin snapshot. Full re-render is fine at Core scale and
  // matches the strategy CORE-008 already uses for pin changes.
  const unsubGroups = subscribeGroups(() =>
    render(listEl, emptyEl, listPins())
  );
  // Backfill the hydration notify() that fired before we subscribed.
  // See app.js for the same pattern around renderPins().
  render(listEl, emptyEl, listPins());
  return () => {
    unsubPins();
    unsubGroups();
  };
}

function render(listEl, emptyEl, pins) {
  // Defensive copy is already provided by listPins(); the snapshot passed
  // through the listener is also a slice. Sorting here is therefore safe
  // and won't disturb other subscribers.
  const sorted = pins.slice().sort((a, b) => a.createdAt - b.createdAt);
  const groups = listGroups();

  // Full clear-and-rebuild is fine at Core scale (tens of pins).
  // Side effect: a row in rename mode is destroyed if any pin changes.
  // Acceptable here because store mutations only happen from user actions
  // that would have blurred the input first (search, remove, etc.).
  listEl.replaceChildren(...sorted.map((pin) => buildRow(pin, groups)));
  emptyEl.hidden = sorted.length > 0;
}

function buildRow(pin, groups) {
  const row = document.createElement("li");
  row.className = "pin-list__row";
  row.dataset.pinId = pin.id;

  // A pin with a `group` id that no longer exists in the store is treated
  // as ungrouped — render defensively, do NOT mutate pin data here. The
  // cascade that clears stale references on group deletion lives in
  // group-panel.js. This branch protects against hand-edited storage and
  // any future race where a group is removed before this re-render runs.
  const groupAssigned = groups.find((g) => g.id === pin.group) ?? null;
  const tileColor = effectiveColor(pin);
  const tileIcon = effectiveIcon(pin);

  row.appendChild(buildAppearanceTile(pin, tileIcon, tileColor, groupAssigned));

  const name = document.createElement("span");
  name.className = "pin-list__name";
  // textContent (not innerHTML) — pin.name is user- or geocoder-provided.
  name.textContent = pin.name;
  row.appendChild(name);

  row.appendChild(buildGroupSelect(pin, groups, groupAssigned));

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit-pin";
  edit.textContent = "✎";
  edit.setAttribute("aria-label", `Rename pin ${pin.name}`);
  edit.addEventListener("click", () => enterRenameMode(pin, name));
  row.appendChild(edit);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-pin";
  remove.textContent = "✕";
  remove.setAttribute("aria-label", `Remove pin ${pin.name}`);
  remove.addEventListener("click", () => removePin(pin.id));
  row.appendChild(remove);

  return row;
}

// Renders the per-row appearance composition: an icon tile (opens the
// modal icon picker) + a small native color swatch sibling. Two
// affordances side-by-side, each does one thing — keeps the row narrow
// while letting the modal own the richer icon-grid surface.
//
// For grouped pins the whole composition is passive (group owns
// appearance), mirroring the pre-PI-001 read-only swatch.
function buildAppearanceTile(pin, iconId, color, groupAssigned) {
  const wrapper = document.createElement("span");
  wrapper.className = "pin-list__appearance";

  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pin-list__tile";
  tile.style.color = color;

  const iconEntry = getIcon(iconId);
  const iconImg = document.createElement("img");
  iconImg.alt = iconEntry?.label || iconId;
  iconImg.src = iconEntry?.svg
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(iconEntry.svg)
    : iconEntry?.src || "";
  iconImg.style.cssText = "width:18px;height:18px;display:block;";
  tile.appendChild(iconImg);

  if (groupAssigned) {
    tile.classList.add("pin-list__tile--readonly");
    tile.disabled = true;
    tile.setAttribute(
      "aria-label",
      `Appearance is controlled by group ${groupAssigned.name}`
    );
    wrapper.appendChild(tile);
    return wrapper;
  }

  tile.setAttribute("aria-label", `Change icon of pin ${pin.name}`);
  tile.setAttribute("aria-haspopup", "dialog");
  tile.addEventListener("click", () => openIconPicker(pin.id));
  wrapper.appendChild(tile);

  // Small native color swatch — sibling to the icon tile. Opens the
  // browser's native color picker on click. `change` only fires when the
  // user picks; cancelling is silent.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "pin-list__color-swatch";
  colorInput.value = pin.color;
  colorInput.setAttribute("aria-label", `Change color of pin ${pin.name}`);
  colorInput.addEventListener("change", () => {
    updatePin(pin.id, { color: colorInput.value });
  });
  wrapper.appendChild(colorInput);

  return wrapper;
}

// Builds the per-row group selector. Empty value === "(none)" === ungrouped.
// A pin pointing at a deleted group renders with "(none)" pre-selected; we
// don't auto-rewrite pin.group here, the group-deletion cascade handles
// that authoritatively in group-panel.js.
function buildGroupSelect(pin, groups, groupAssigned) {
  const select = document.createElement("select");
  select.className = "pin-list__group-select";
  select.setAttribute("aria-label", `Group for pin ${pin.name}`);

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "(none)";
  select.appendChild(noneOption);

  for (const g of groups) {
    const option = document.createElement("option");
    option.value = g.id;
    option.textContent = g.name;
    select.appendChild(option);
  }

  select.value = groupAssigned ? groupAssigned.id : "";

  select.addEventListener("change", () => {
    const value = select.value;
    updatePin(pin.id, { group: value === "" ? null : value });
  });

  return select;
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
