// Modal icon picker. Replaces PI-001's popover with a richer surface that
// hosts: (a) a categorized icon grid with search, (b) the add-icon
// sub-flow (Task 13), (c) per-user-icon delete + attribution display.
//
// API:
//   openIconPicker(pinId) → mounts the modal, scoped to the given pin.
//                           Closes on ESC, click-outside, or icon-pick.
//   closeIconPicker()    → idempotent.
//
// State is module-singleton (only one open at a time); reopening for a
// different pin closes the prior instance first.

import { listPins, updatePin } from "./pins.js";
import {
  getMergedIcons,
  subscribe as subscribeIcons,
  effectiveIcon,
} from "./icons.js";
import * as userIconStore from "./user-icons.js";

const CATEGORY_ORDER = ["default", "pins", "travel", "places", "transport", "markers", "user"];
const CATEGORY_LABEL = {
  default: "Default",
  pins: "Pins",
  travel: "Travel",
  places: "Places",
  transport: "Transport",
  markers: "Markers",
  user: "My icons",
};

let activeState = null;

export function openIconPicker(pinId) {
  closeIconPicker();

  const overlay = document.createElement("div");
  overlay.className = "icon-picker-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "icon-picker-modal";
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const renderGrid = () => {
    const livePin = listPins().find((p) => p.id === pinId);
    if (!livePin) {
      closeIconPicker();
      return;
    }
    modal.replaceChildren(...buildGridView(livePin, modal));
  };
  renderGrid();

  // Re-render when icons change (user-icon add/delete).
  const unsubIcons = subscribeIcons(renderGrid);

  const onClickOutside = (e) => {
    if (e.target === overlay) closeIconPicker();
  };
  const onKey = (e) => {
    if (e.key === "Escape") closeIconPicker();
  };
  overlay.addEventListener("click", onClickOutside);
  document.addEventListener("keydown", onKey);

  activeState = {
    pinId,
    overlay,
    modal,
    teardown: () => {
      unsubIcons();
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    },
  };
}

export function closeIconPicker() {
  if (!activeState) return;
  activeState.teardown();
  activeState = null;
}

// Helper called from the sub-view's Back / Cancel to return to the grid.
export function showGridView(modal, pinId) {
  const livePin = listPins().find((p) => p.id === pinId);
  if (!livePin) {
    closeIconPicker();
    return;
  }
  modal.replaceChildren(...buildGridView(livePin, modal));
}

function buildGridView(pin, modal) {
  const nodes = [];

  const header = document.createElement("div");
  header.className = "icon-picker-modal__header";
  const title = document.createElement("span");
  title.textContent = "Pin icon";
  header.appendChild(title);
  const close = document.createElement("button");
  close.className = "icon-picker-modal__close";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeIconPicker);
  header.appendChild(close);
  nodes.push(header);

  const searchWrap = document.createElement("div");
  searchWrap.className = "icon-picker-modal__search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search icons…";
  searchInput.className = "icon-picker-modal__search-input";
  searchWrap.appendChild(searchInput);
  nodes.push(searchWrap);

  const body = document.createElement("div");
  body.className = "icon-picker-modal__body";
  nodes.push(body);

  const drawBody = (query) => {
    body.replaceChildren();
    const merged = getMergedIcons();
    const filtered = query
      ? merged.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
      : merged;
    const byCategory = new Map();
    for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
    for (const icon of filtered) {
      const arr = byCategory.get(icon.category) || [];
      arr.push(icon);
      byCategory.set(icon.category, arr);
    }
    for (const cat of CATEGORY_ORDER) {
      const items = byCategory.get(cat) || [];
      // Always show user category (so the +Add tile is reachable even
      // when the user has no icons yet); other categories collapse when
      // search filters them out.
      if (items.length === 0 && cat !== "user") continue;
      body.appendChild(buildCategorySection(pin, cat, items, modal));
    }
  };

  searchInput.addEventListener("input", () => drawBody(searchInput.value));
  drawBody("");

  const footer = document.createElement("div");
  footer.className = "icon-picker-modal__footer";
  footer.textContent =
    "Custom icons may include third-party artwork. Hover an icon for credit.";
  nodes.push(footer);

  return nodes;
}

function buildCategorySection(pin, category, icons, modal) {
  const section = document.createElement("div");
  section.className = "icon-picker-modal__category";

  const titleRow = document.createElement("div");
  titleRow.className = "icon-picker-modal__category-title";
  const titleSpan = document.createElement("span");
  titleSpan.textContent = CATEGORY_LABEL[category] || category;
  titleRow.appendChild(titleSpan);

  if (category === "user") {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+ Add";
    addBtn.style.cssText =
      "background: none; border: 0; cursor: pointer; color: #1d3557; font-weight: 600;";
    addBtn.addEventListener("click", () => showAddSubView(pin, modal));
    titleRow.appendChild(addBtn);
  }
  section.appendChild(titleRow);

  const grid = document.createElement("div");
  grid.className = "icon-picker-modal__grid";
  for (const icon of icons) {
    grid.appendChild(buildTile(pin, icon));
  }
  if (category === "user") {
    grid.appendChild(buildAddTile(pin, modal));
  }
  section.appendChild(grid);
  return section;
}

function buildTile(pin, icon) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "icon-picker-modal__tile";
  tile.style.color = pin.color;

  const iconEl = document.createElement("span");
  iconEl.className = "icon-picker-modal__tile-icon";
  iconEl.appendChild(buildIconNode(icon));
  tile.appendChild(iconEl);

  const isSelected = effectiveIcon(pin) === icon.id;
  if (isSelected) {
    tile.classList.add("icon-picker-modal__tile--selected");
  }

  if (icon.category === "user") {
    tile.title = formatCredit(icon);
    // Trash button: cascade-clear pin.icon=null on referenced pins, then
    // remove from the user-icon store.
    const trash = document.createElement("span");
    trash.className = "icon-picker-modal__tile-trash";
    trash.textContent = "🗑";
    trash.setAttribute("role", "button");
    trash.setAttribute("aria-label", `Delete ${icon.label}`);
    trash.addEventListener("click", (e) => {
      e.stopPropagation();
      if (
        !confirm(
          `Delete "${icon.label}"? Pins using it will reset to the default icon.`
        )
      ) {
        return;
      }
      for (const p of listPins()) {
        if (p.icon === icon.id) updatePin(p.id, { icon: null });
      }
      userIconStore.remove(icon.id);
    });
    tile.appendChild(trash);
  } else {
    tile.title = icon.label;
  }

  tile.addEventListener("click", () => {
    if (!isSelected) updatePin(pin.id, { icon: icon.id });
    closeIconPicker();
  });
  return tile;
}

function buildAddTile(pin, modal) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "icon-picker-modal__add-tile";
  tile.textContent = "+ Add";
  tile.addEventListener("click", () => showAddSubView(pin, modal));
  return tile;
}

function formatCredit(icon) {
  const parts = [icon.label];
  if (icon.attribution?.artistName) parts.push(`by ${icon.attribution.artistName}`);
  if (icon.attribution?.sourceUrl) parts.push(icon.attribution.sourceUrl);
  return parts.join(" — ");
}

// Renders an SVG element from either a `src` URL (built-in) or an inline
// `svg` markup string (user icon). Both render via <img> for simplicity;
// the browser caches built-in src paths and decodes data: URLs natively.
function buildIconNode(icon) {
  const img = document.createElement("img");
  img.alt = icon.label;
  img.src = icon.svg
    ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(icon.svg)
    : icon.src;
  return img;
}

// showAddSubView is implemented in Task 13. Placeholder so Task 11's
// commit compiles cleanly. Replace the body in Task 13.
export function showAddSubView(_pin, _modal) {
  console.info("Add-icon flow lands in the next task.");
}
