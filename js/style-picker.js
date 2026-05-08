// js/style-picker.js — Searchable, grouped popover for selecting a basemap.
//
// Replaces the native <select id="map-style-select">. Built from MAP_STYLES;
// groups by .provider; locked rows (token-required, no key set) route the
// click to the settings modal scrolled to that provider's section.
//
// Public API:
//   initStylePicker({ getCurrentStyleId, onSelect, onOpenSettings })
//     → returns { setActive(styleId) } so the caller can update the
//       trigger label + active row when a style is set externally
//       (boot, failed-swap revert, etc).
//
// Keyboard nav: Arrows traverse rows; Enter selects; Tab focuses search;
// Escape closes; click-outside closes.

import { MAP_STYLES, isRasterStyleEntry } from "./map.js";
import * as settings from "./settings.js";
import { loadHideLabels } from "./storage.js";

const DISABLED_POPUP_MESSAGE =
  "Labels can't be hidden on raster basemaps because they're baked into the tile image. Pick a vector style to hide labels.";

const PROVIDER_ORDER = [
  "openfreemap",
  "stadia",
  "maptiler",
  "thunderforest",
  "wikimedia",
  "opentopomap",
  "esri",
];

const PROVIDER_LABEL = {
  openfreemap: "OpenFreeMap (vector)",
  stadia: "Stadia",
  maptiler: "MapTiler",
  thunderforest: "Thunderforest",
  wikimedia: "Wikimedia (raster)",
  opentopomap: "OpenTopoMap (raster)",
  esri: "Esri (raster)",
};

const PROVIDER_COLOR = {
  openfreemap: "#22c55e",
  stadia: "#0f172a",
  maptiler: "#2563eb",
  thunderforest: "#16a34a",
  wikimedia: "#a855f7",
  opentopomap: "#f97316",
  esri: "#0ea5e9",
};

const SEARCH_DEBOUNCE_MS = 100;

let pickerEl = null;
let triggerEl = null;
let triggerLabelEl = null;
let popoverEl = null;
let searchEl = null;
let listEl = null;
let manageKeysBtn = null;

let currentSearch = "";
let searchTimer = null;
let activeStyleId = null;
let onSelectCb = null;
let onOpenSettingsCb = null;
let isOpen = false;

// PO-001: when true, every entry that fails isRasterStyleEntry() renders
// disabled and routes its activation to the info popup instead of selecting.
// Read once at init time, refreshed by the picker handle's setHideLabels.
let hideLabelsActive = false;

// Single floating element reused across rows. Lazily created on first show
// to keep the DOM clean at rest. Anchored to whichever row triggered it
// (hover, focus, click, Enter on a disabled row); dismissed on Escape,
// click-outside, blur, or pointer leaving the row.
let popupEl = null;
let popupAnchorRow = null;

export function initStylePicker({
  getCurrentStyleId,
  onSelect,
  onOpenSettings,
}) {
  pickerEl = document.getElementById("map-style-picker");
  triggerEl = document.getElementById("map-style-trigger");
  triggerLabelEl = document.getElementById("map-style-trigger-label");
  popoverEl = document.getElementById("map-style-popover");
  searchEl = document.getElementById("map-style-search");
  listEl = document.getElementById("map-style-list");
  manageKeysBtn = document.getElementById("picker-manage-keys");

  if (
    !pickerEl ||
    !triggerEl ||
    !triggerLabelEl ||
    !popoverEl ||
    !searchEl ||
    !listEl ||
    !manageKeysBtn
  ) {
    return { setActive: () => {}, setHideLabels: () => {} };
  }

  onSelectCb = onSelect;
  onOpenSettingsCb = onOpenSettings;

  // Reveal the picker (it's hidden in markup until JS attaches handlers).
  pickerEl.hidden = false;

  // Hydrate the disabled-row state from storage so a reload paints the
  // picker correctly on first open without waiting for app.js to push the
  // value through setHideLabels.
  hideLabelsActive = loadHideLabels();

  // Initial active id + trigger label.
  setActive(getCurrentStyleId());

  // Wire interactions.
  triggerEl.addEventListener("click", toggle);
  searchEl.addEventListener("input", onSearchInput);
  searchEl.addEventListener("keydown", onSearchKeydown);
  manageKeysBtn.addEventListener("click", () => {
    close();
    if (onOpenSettingsCb) onOpenSettingsCb(null);
  });
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown);

  // Re-render rows whenever the settings store changes — locked rows
  // unlock when their key is set, and vice-versa.
  settings.subscribe(() => {
    if (isOpen) renderRows();
  });

  return { setActive, setHideLabels };
}

// Called by app.js whenever the hide-labels toggle flips. We re-render
// only when the popover is open — the next open() will pick up the new
// value via renderRows() on its own otherwise.
function setHideLabels(value) {
  hideLabelsActive = Boolean(value);
  if (!hideLabelsActive) hideDisabledPopup();
  if (isOpen) renderRows();
}

function setActive(styleId) {
  activeStyleId = styleId;
  const entry = MAP_STYLES.find((s) => s.id === styleId);
  if (triggerLabelEl) {
    triggerLabelEl.textContent = entry ? entry.label : "—";
  }
  if (isOpen) renderRows();
}

function toggle() {
  if (isOpen) close();
  else open();
}

function open() {
  if (isOpen) return;
  isOpen = true;
  popoverEl.hidden = false;
  triggerEl.setAttribute("aria-expanded", "true");
  pickerEl.dataset.pickerState = "open";
  renderRows();
  // Focus the search field for instant typing.
  searchEl.focus();
}

function close() {
  if (!isOpen) return;
  isOpen = false;
  popoverEl.hidden = true;
  triggerEl.setAttribute("aria-expanded", "false");
  pickerEl.dataset.pickerState = "closed";
  searchEl.value = "";
  currentSearch = "";
  hideDisabledPopup();
}

function onDocumentClick(e) {
  if (!isOpen) return;
  if (pickerEl.contains(e.target)) return;
  close();
}

function onDocumentKeydown(e) {
  if (!isOpen) return;
  if (e.key === "Escape") {
    // Two-stage Escape: if the disabled-row popup is showing, dismiss it
    // first and leave the picker open; second Escape closes the picker.
    // Matches the behaviour of nested popovers in macOS / Windows menus.
    if (popupEl && !popupEl.hidden) {
      hideDisabledPopup();
      return;
    }
    close();
    triggerEl.focus();
  }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentSearch = searchEl.value.trim().toLowerCase();
    renderRows();
  }, SEARCH_DEBOUNCE_MS);
}

function onSearchKeydown(e) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const firstRow = listEl.querySelector(".picker__row");
    if (firstRow) firstRow.focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const firstRow = listEl.querySelector(".picker__row");
    if (firstRow) firstRow.click();
  }
}

function renderRows() {
  if (!listEl) return;

  // Build a fresh DocumentFragment, then atomically swap children.
  // Avoids assigning innerHTML (and any XSS surface) and avoids the
  // visible reflow churn of clearing + appending one node at a time.
  const frag = document.createDocumentFragment();
  const filtered = MAP_STYLES.filter((entry) => matches(entry, currentSearch));

  // Group by provider, in PROVIDER_ORDER. Unknown providers fall to a
  // trailing bucket so a typo in MAP_STYLES still renders the row.
  const groups = new Map();
  for (const provider of PROVIDER_ORDER) groups.set(provider, []);
  for (const entry of filtered) {
    if (!groups.has(entry.provider)) groups.set(entry.provider, []);
    groups.get(entry.provider).push(entry);
  }

  for (const [provider, entries] of groups) {
    if (entries.length === 0) continue;
    frag.appendChild(renderGroupHeader(provider));
    for (const entry of entries) {
      frag.appendChild(renderRow(entry));
    }
  }

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "picker__empty";
    empty.textContent = "No styles match.";
    frag.appendChild(empty);
  }

  // Atomic swap. replaceChildren() removes existing children and inserts
  // the fragment in one go — no innerHTML, no incremental flicker.
  listEl.replaceChildren(frag);
}

function matches(entry, query) {
  if (!query) return true;
  return (
    entry.label.toLowerCase().includes(query) ||
    (entry.provider && entry.provider.toLowerCase().includes(query))
  );
}

function renderGroupHeader(provider) {
  const li = document.createElement("li");
  li.className = "picker__group-header";
  li.setAttribute("role", "presentation");
  li.textContent = PROVIDER_LABEL[provider] ?? provider;
  return li;
}

function renderRow(entry) {
  const li = document.createElement("li");
  li.className = "picker__row";
  li.setAttribute("role", "option");
  li.setAttribute("tabindex", "0");
  li.dataset.styleId = entry.id;

  const locked =
    entry.requiresToken && !settings.isProviderUnlocked(entry.requiresToken);
  // PO-001: rows mapping to raster entries are disabled when the toggle is
  // ON. Disabled and locked are independent flags; locked still wins on
  // visuals (the lock icon) so the user sees that swap is blocked AND
  // (if applicable) why labels can't be hidden on it.
  const disabled = hideLabelsActive && isRasterStyleEntry(entry);
  if (locked) li.classList.add("is-locked");
  if (disabled) {
    li.classList.add("is-disabled");
    li.setAttribute("aria-disabled", "true");
  }
  if (entry.id === activeStyleId) {
    li.classList.add("is-active-key");
    li.setAttribute("aria-selected", "true");
  }

  const dot = document.createElement("span");
  dot.className = "picker__row-dot";
  dot.style.background = PROVIDER_COLOR[entry.provider] ?? "#94a3b8";
  li.appendChild(dot);

  const label = document.createElement("span");
  label.className = "picker__row-label";
  label.textContent = entry.label;
  li.appendChild(label);

  li.addEventListener("click", (e) => {
    if (disabled) {
      // Stop propagation so onDocumentClick (capture-phase) doesn't close
      // the picker as a "click outside the popup" — the popup IS the
      // intended outcome of clicking the disabled row.
      e.stopPropagation();
      showDisabledPopup(li);
      return;
    }
    if (locked) {
      close();
      if (onOpenSettingsCb) onOpenSettingsCb(entry.requiresToken);
      return;
    }
    setActive(entry.id);
    close();
    if (onSelectCb) onSelectCb(entry.id);
  });
  li.addEventListener("mouseenter", () => {
    if (disabled) showDisabledPopup(li);
  });
  li.addEventListener("mouseleave", (e) => {
    if (!disabled) return;
    // Don't dismiss if the cursor moved into the popup itself — letting
    // the user mouse over to read the message comfortably.
    if (popupEl && popupEl.contains(e.relatedTarget)) return;
    hideDisabledPopup();
  });
  li.addEventListener("focus", () => {
    if (disabled) showDisabledPopup(li);
  });
  li.addEventListener("blur", () => {
    if (disabled) hideDisabledPopup();
  });
  li.addEventListener("keydown", (e) => onRowKeydown(e, li, disabled));

  return li;
}

function onRowKeydown(e, li, disabled = false) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (disabled) {
      showDisabledPopup(li);
      return;
    }
    li.click();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = li.nextElementSibling;
    if (!next) return;
    if (next.classList.contains("picker__group-header")) {
      const nextRow = next.nextElementSibling;
      if (nextRow) nextRow.focus();
    } else {
      next.focus();
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = li.previousElementSibling;
    if (!prev) {
      searchEl.focus();
      return;
    }
    if (prev.classList.contains("picker__group-header")) {
      const prevRow = prev.previousElementSibling;
      if (prevRow) prevRow.focus();
      else searchEl.focus();
    } else {
      prev.focus();
    }
  }
}

// ---- Disabled-row info popup ------------------------------------------

function ensurePopup() {
  if (popupEl) return popupEl;
  popupEl = document.createElement("div");
  popupEl.className = "picker__disabled-popup";
  popupEl.setAttribute("role", "tooltip");
  popupEl.setAttribute("aria-live", "polite");
  popupEl.hidden = true;
  popupEl.textContent = DISABLED_POPUP_MESSAGE;
  // Living inside .picker keeps the popup absolutely-positioned relative
  // to the picker's coordinate system, so the row's offset math below
  // doesn't have to compensate for arbitrary ancestor positioning.
  pickerEl.appendChild(popupEl);
  return popupEl;
}

function showDisabledPopup(rowEl) {
  const el = ensurePopup();
  // No-op if the same row is already showing the popup — avoids flicker
  // from rapid mouseenter/focus pairs on the same row.
  if (popupAnchorRow === rowEl && !el.hidden) return;
  popupAnchorRow = rowEl;
  el.hidden = false;

  // Anchor via bounding rects so the math is immune to the list's
  // internal scroll position. Computing offsets via offsetTop/offsetLeft
  // would yield the row's position in the un-scrolled list, which can
  // be hundreds of pixels off after the user scrolls down to a raster
  // entry deep in the list. The popup is absolutely-positioned inside
  // .picker (the closest positioned ancestor), so subtracting picker
  // rect from row rect gives the right local-space coordinates.
  const rowRect = rowEl.getBoundingClientRect();
  const pickerRect = pickerEl.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();
  el.style.top = `${rowRect.top - pickerRect.top}px`;
  el.style.left = `${popoverRect.right - pickerRect.left + 8}px`;
}

function hideDisabledPopup() {
  if (!popupEl) return;
  popupEl.hidden = true;
  popupAnchorRow = null;
}
