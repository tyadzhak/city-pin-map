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
import { loadDefaultPin } from "./storage.js";

/**
 * Wires the list to the pin store AND the group store. Call once during
 * bootstrap, after both stores have been hydrated so the first render
 * reflects persisted data.
 *
 * Returns an unsubscribe function that tears down both subscriptions, for
 * symmetry with subscribe(). app.js currently never tears down.
 */
// Panel elements + deferred-render coordination (FBL-021). A full list
// rebuild replaces every row, wiping out an <input> that's currently in
// rename mode. Store mutations used to only originate from user actions that
// blur the input first — but PO-004's import loop adds pins in the background
// (~1/sec) while the panel stays interactive. So we suppress rebuilds while a
// rename is active (`renameActive`), remember that one was requested
// (`renderPending`), and let enterRenameMode's finalize flush the deferred
// rebuild once the edit resolves. See render() and enterRenameMode() below.
let panelEls = null;
let renderPending = false;
let renameActive = false;

function renderNow() {
  if (!panelEls) return;
  // Always re-pull the latest store state — a deferred rebuild must reflect
  // pins/groups added while a rename held the list, not a stale snapshot.
  render(panelEls.listEl, panelEls.emptyEl, listPins());
  renderPending = false;
}

// Store subscribers funnel through here. While a rename is active we can't
// rebuild without destroying the focused input, so we record the request and
// let finalize() flush it once the edit resolves.
function requestRender() {
  if (renameActive) {
    renderPending = true;
    return;
  }
  renderNow();
}

/**
 * Re-render the list from live state — the SAME entry point the pin/group
 * store subscriptions use (rename-safe deferral included), exposed for the
 * one input that changes what a row displays without touching either store:
 * the Design tab's default-pin COLOR, which is the final fallback of the
 * pin-color precedence and therefore the swatch/tile color of every
 * inherited row. No-op before initPinList().
 */
export function refreshPinList() {
  requestRender();
}

export function initPinList() {
  const listEl = document.getElementById("pin-list");
  const emptyEl = document.getElementById("pin-list-empty");

  if (!listEl || !emptyEl) {
    console.warn("pin-list elements missing; list will not render");
    return () => {};
  }

  panelEls = { listEl, emptyEl };

  const unsubPins = subscribe(requestRender);
  // Group changes (rename, recolor, delete) all alter what the row should
  // display — selector options, tile color — so re-render the whole list
  // from a fresh pin snapshot. Full re-render is fine at Core scale and
  // matches the strategy CORE-008 already uses for pin changes.
  const unsubGroups = subscribeGroups(requestRender);
  // Backfill the hydration notify() that fired before we subscribed.
  // See app.js for the same pattern around renderPins().
  renderNow();
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
  // ONE default-pin read per render, passed down to every row's
  // effectiveColor() call — mirroring js/map.js's pinsToFeatureCollection
  // hoist. Left to effectiveColor's own default it would be a localStorage
  // read (and, with a corrupt key, a console.error + banner reset) per ROW.
  const defaultColor = loadDefaultPin().color;

  // Full clear-and-rebuild is fine at Core scale (tens of pins). It replaces
  // every row, so it would wipe out a row that's in rename mode — callers
  // therefore never invoke this while a rename is active. Store notifications
  // route through requestRender(), which defers the rebuild until finalize()
  // resolves the edit (see enterRenameMode); the rebuild that a committed
  // rename triggers runs only after renameActive has been cleared.
  listEl.replaceChildren(
    ...sorted.map((pin) => buildRow(pin, groups, defaultColor))
  );
  emptyEl.hidden = sorted.length > 0;
}

function buildRow(pin, groups, defaultColor) {
  const row = document.createElement("li");
  row.className = "pin-list__row";
  row.dataset.pinId = pin.id;

  // A pin with a `group` id that no longer exists in the store is treated
  // as ungrouped — render defensively, do NOT mutate pin data here. The
  // cascade that clears stale references on group deletion lives in
  // group-panel.js. This branch protects against hand-edited storage and
  // any future race where a group is removed before this re-render runs.
  const groupAssigned = groups.find((g) => g.id === pin.group) ?? null;
  const tileColor = effectiveColor(pin, defaultColor);
  const tileIcon = effectiveIcon(pin);

  row.appendChild(buildAppearanceTile(pin, tileIcon, tileColor));

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

  // No "reset position" affordance: the pin itself is fixed in place and
  // can never be dragged, so pin.lat/lon can never drift from
  // originalLat/originalLon. That FBL-008 button is intentionally removed
  // — see originalLat/originalLon's doc comment in CLAUDE.md.

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
// 2026-08-11 pin-color-precedence flip: a grouped pin used to render this
// tile as read-only ("group owns appearance") because the group's color
// unconditionally overrode the pin's own. Now a pin's own CUSTOMIZED color
// always wins over its group's, so a grouped pin gets the exact same live
// icon tile + color swatch as an ungrouped one — this was the very action
// (recoloring a grouped pin and expecting it to show) that motivated the
// flip. `color` here is already the pin's RESOLVED effective color (see
// buildRow's `effectiveColor(pin, defaultColor)` call), so the swatch shows what
// the marker actually renders, whichever tier of the precedence supplied
// it. Picking a new color always writes a CONCRETE value onto the pin
// (a deliberate edit always counts as "customized") — there is no per-pin
// "reset to inherit" affordance in v1; the Design tab's "Apply to all
// pins" (default-pin group) is the documented bulk reset (see
// js/app.js's initDefaultPinOptions).
function buildAppearanceTile(pin, iconId, color) {
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

  tile.setAttribute("aria-label", `Change icon of pin ${pin.name}`);
  tile.setAttribute("aria-haspopup", "dialog");
  tile.addEventListener("click", () => openIconPicker(pin.id));
  wrapper.appendChild(tile);

  // Small native color swatch — sibling to the icon tile. Opens the
  // browser's native color picker on click. Value seeded from the RESOLVED
  // color (not the raw, possibly-null pin.color) so the swatch never shows a
  // blank/undefined color for an inherited pin.
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "pin-list__color-swatch";
  colorInput.value = color;
  colorInput.setAttribute("aria-label", `Change color of pin ${pin.name}`);

  // Inherited (pin.color === null) rows read differently from customized
  // ones: the swatch shows a color the pin doesn't own, and picking one
  // CHANGES that (it pins the shade permanently). A dotted border + tooltip
  // is the whole cue — no extra control, no layout change.
  const inherited = pin.color === null || pin.color === undefined;
  if (inherited) {
    colorInput.classList.add("pin-list__color-swatch--inherited");
    colorInput.title = "Following group/default color — pick to customize";
  }

  // `input` AND `change`: `input` fires while the native picker is live, so
  // a user who opens it on an INHERITED pin and re-commits the shade it's
  // already showing still ends up with a concrete (customized) color rather
  // than a silent no-op. The guard keeps that from becoming an updatePin
  // storm — each write re-renders the whole list — by writing only when the
  // value actually differs from the pin's STORED color. A null (inherited)
  // color is always "different", which is exactly what makes the pin-it-at-
  // its-current-shade case work.
  const commitColor = () => {
    if (pin.color === colorInput.value) return;
    updatePin(pin.id, { color: colorInput.value });
  };
  colorInput.addEventListener("input", commitColor);
  colorInput.addEventListener("change", commitColor);
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
    // Re-enable list rebuilds. Do this BEFORE updatePin so the commit's own
    // notify rebuilds the row immediately through requestRender() rather than
    // deferring it again (FBL-021).
    renameActive = false;

    if (mode === "commit") {
      const trimmed = input.value.trim();
      if (trimmed && trimmed !== pin.name) {
        // The store will fan out: list re-renders this row, map updates
        // the marker tooltip, storage subscriber persists. Done. That
        // rebuild also flushes any render deferred while we held focus.
        updatePin(pin.id, { name: trimmed });
        return;
      }
    }
    // Cancel, empty rejection, or no-op commit: revert the row in place.
    // Safe even if the input has already been detached by a re-render.
    if (input.isConnected) {
      input.replaceWith(nameEl);
    }
    // These paths don't mutate the store (no notify), so flush any rebuild a
    // background mutation deferred while the rename held focus. renderNow()
    // re-pulls the latest pins/groups, so newly-imported pins appear too.
    if (renderPending) {
      renderNow();
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

  // Mark the rename active BEFORE the input enters the DOM so any store
  // notify that lands between now and finalize() defers its rebuild instead
  // of ripping out this input (FBL-021).
  renameActive = true;
  nameEl.replaceWith(input);
  // .select() makes typing immediately replace the existing name —
  // matches the "I'm overwriting this" mental model better than a caret
  // at the end of the text.
  input.focus();
  input.select();
}
