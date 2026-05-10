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
import { effectiveIcon, getMergedIcons } from "./icons.js";

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

// Renders the per-row appearance tile. For ungrouped pins the tile is
// interactive — clicking it opens the popover that hosts the icon grid
// and the native color input. For grouped pins it's a passive indicator
// of the group's color and icon: appearance is owned by the group's own
// row, mirroring the pre-PI-001 behaviour where the swatch was read-only.
function buildAppearanceTile(pin, iconId, color, groupAssigned) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pin-list__tile";
  tile.style.color = color;
  tile.appendChild(buildIconElement(iconId));

  if (groupAssigned) {
    tile.classList.add("pin-list__tile--readonly");
    tile.disabled = true;
    tile.setAttribute(
      "aria-label",
      `Appearance is controlled by group ${groupAssigned.name}`
    );
    return tile;
  }

  tile.setAttribute("aria-label", `Change icon and color of pin ${pin.name}`);
  tile.setAttribute("aria-haspopup", "dialog");
  tile.addEventListener("click", () => openAppearancePopover(pin, tile));
  return tile;
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

// ---- Appearance popover ----------------------------------------------

// Cached SVG templates, keyed by icon id. Populated lazily on the first
// popover open. The map module fetches the same files via Image() for
// MapLibre's image registry; the browser's HTTP cache makes this second
// fetch effectively free, and we keep responsibilities split (this
// module owns DOM rendering of icons, map.js owns the GL-side raster).
const iconTemplates = new Map();
let iconTemplatesPromise = null;
const svgParser = new DOMParser();

function loadIconTemplates() {
  if (iconTemplatesPromise) return iconTemplatesPromise;
  iconTemplatesPromise = Promise.all(
    getMergedIcons().map(async (icon) => {
      const res = await fetch(icon.src);
      const text = await res.text();
      // DOMParser in image/svg+xml mode is the safe parse path for
      // arbitrary SVG markup — no innerHTML, no script-execution surface.
      // The icons here are repo-controlled, but DOMParser is the cleaner
      // pattern regardless and disabling the security hook would be wrong.
      const doc = svgParser.parseFromString(text, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg && svg.tagName === "svg") {
        // fill="currentColor" on the <svg> cascades to descendant <path>
        // elements that have no fill of their own — Phosphor's icons fit
        // that profile. The wrapping element's CSS `color` then drives
        // the tint, mirroring how the GL layer's icon-color drives SDF
        // tinting for the marker on the map.
        svg.setAttribute("fill", "currentColor");
        // Strip Phosphor's invisible sizing rect; we set width/height on
        // the SVG directly so it's no longer needed.
        const rect = svg.querySelector("rect[fill='none']");
        if (rect) rect.remove();
        iconTemplates.set(icon.id, svg);
      }
    })
  );
  return iconTemplatesPromise;
}

// Returns a fresh SVG node for the given icon id, ready to be styled by
// its CSS color. Falls back to an empty span if templates haven't loaded
// yet — the caller updates the icon once loadIconTemplates resolves.
function buildIconElement(iconId) {
  const wrapper = document.createElement("span");
  wrapper.className = "pin-list__tile-icon";
  const template = iconTemplates.get(iconId);
  if (template) {
    wrapper.appendChild(template.cloneNode(true));
  } else {
    // Lazy first-load. Once templates resolve, replace the placeholder
    // contents in-place so the row updates without a re-render.
    loadIconTemplates().then(() => {
      const t = iconTemplates.get(iconId);
      if (t && wrapper.isConnected) wrapper.replaceChildren(t.cloneNode(true));
    });
  }
  return wrapper;
}

// Singleton popover state. Only one popover open at a time; opening for
// a different pin closes the previous one. Storing the teardown closure
// here makes close logic uniform regardless of how the popover dismisses
// (outside-click, Escape, store-deletes-the-pin, opening another popover).
let popoverState = null;

function openAppearancePopover(pin, anchorEl) {
  closeAppearancePopover();

  const popoverEl = document.createElement("div");
  popoverEl.className = "appearance-popover";
  popoverEl.setAttribute("role", "dialog");
  popoverEl.setAttribute("aria-label", `Pin appearance for ${pin.name}`);
  document.body.appendChild(popoverEl);

  // Re-render contents whenever the pin store ticks. Three reasons it
  // can change while the popover is open: user picks a new icon, user
  // changes the color, or another path mutates the same pin (drag,
  // group reassignment from the selector below the tile). All three
  // need the popover's own selected-state and color value to stay
  // truthful.
  const renderContents = () => {
    const livePin = listPins().find((p) => p.id === pin.id);
    if (!livePin) {
      // Pin was removed (or its row went read-only via group assignment
      // — appearance editing then belongs to the group panel). Either
      // way, dismiss.
      closeAppearancePopover();
      return;
    }
    if (livePin.group) {
      closeAppearancePopover();
      return;
    }
    popoverEl.replaceChildren(...buildPopoverContent(livePin));
  };

  // Ensure the SVG templates are loaded before the first content render
  // so the icon-grid cells paint with their tinted previews on open.
  loadIconTemplates().then(() => {
    if (popoverState && popoverState.popoverEl === popoverEl) {
      renderContents();
    }
  });
  renderContents();
  positionPopover(popoverEl, anchorEl);

  const unsubscribe = subscribe(renderContents);

  // Outside-click on capture phase — fires before any inner handler can
  // stopPropagation. Anchor and popover both shielded so the user can
  // open and interact without an accidental dismiss.
  const onDocumentDown = (event) => {
    if (popoverEl.contains(event.target)) return;
    if (anchorEl.contains(event.target)) return;
    closeAppearancePopover();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeAppearancePopover();
  };
  document.addEventListener("pointerdown", onDocumentDown, true);
  document.addEventListener("keydown", onKey);

  popoverState = {
    pinId: pin.id,
    popoverEl,
    teardown: () => {
      unsubscribe();
      document.removeEventListener("pointerdown", onDocumentDown, true);
      document.removeEventListener("keydown", onKey);
      popoverEl.remove();
    },
  };
}

function closeAppearancePopover() {
  if (!popoverState) return;
  popoverState.teardown();
  popoverState = null;
}

function buildPopoverContent(pin) {
  const nodes = [];

  const grid = document.createElement("div");
  grid.className = "appearance-popover__grid";
  for (const icon of getMergedIcons()) {
    grid.appendChild(buildIconChoice(pin, icon));
  }
  nodes.push(grid);

  const colorRow = document.createElement("label");
  colorRow.className = "appearance-popover__color-row";
  const colorLabel = document.createElement("span");
  colorLabel.className = "appearance-popover__color-label";
  colorLabel.textContent = "Color";
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "appearance-popover__color-input";
  colorInput.value = pin.color;
  // `change` only fires when the user picks; cancelling the dialog is
  // silent. updatePin → notify() fans out: the row re-renders with the
  // new tile color (CORE-008) and the marker recolors (CORE-005).
  colorInput.addEventListener("change", () => {
    updatePin(pin.id, { color: colorInput.value });
  });
  colorRow.appendChild(colorLabel);
  colorRow.appendChild(colorInput);
  nodes.push(colorRow);

  return nodes;
}

function buildIconChoice(pin, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "appearance-popover__icon";
  // currentColor cascade: tinted preview shows what the marker will
  // actually look like with the pin's current color applied.
  button.style.color = pin.color;
  button.setAttribute("aria-label", icon.label);
  button.appendChild(buildIconElement(icon.id));

  const isSelected = effectiveIcon(pin) === icon.id;
  if (isSelected) {
    button.classList.add("appearance-popover__icon--selected");
    button.setAttribute("aria-pressed", "true");
  } else {
    button.setAttribute("aria-pressed", "false");
  }

  button.addEventListener("click", () => {
    // No-op when re-clicking the already-selected icon. updatePin would
    // still notify subscribers, but skipping the spurious tick keeps
    // the popover from re-rendering for nothing.
    if (isSelected) return;
    updatePin(pin.id, { icon: icon.id });
    // Don't close on selection — the user may want to iterate icon
    // and color in one popover session.
  });
  return button;
}

function positionPopover(popoverEl, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  // Estimated popover dimensions for viewport-clamping; the real values
  // depend on rendered content (3-column icon grid + color row), but
  // these match the CSS sizing in styles.css and only inform overflow
  // detection.
  const estWidth = 240;
  const estHeight = 180;
  const margin = 8;

  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 4;

  if (left + estWidth > window.innerWidth - margin) {
    left = window.innerWidth - estWidth - margin;
  }
  if (left < margin) {
    left = margin;
  }
  // Flip to above the anchor if the popover would overflow the bottom
  // of the viewport. The 4 px gap from the anchor matches the down
  // direction.
  if (top + estHeight > window.innerHeight - margin) {
    top = rect.top + window.scrollY - estHeight - 4;
  }

  popoverEl.style.position = "absolute";
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}
