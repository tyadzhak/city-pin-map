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

import { MAP_STYLES } from "./map.js";
import * as settings from "./settings.js";

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
    return { setActive: () => {} };
  }

  onSelectCb = onSelect;
  onOpenSettingsCb = onOpenSettings;

  // Reveal the picker (it's hidden in markup until JS attaches handlers).
  pickerEl.hidden = false;

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

  return { setActive };
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
}

function onDocumentClick(e) {
  if (!isOpen) return;
  if (pickerEl.contains(e.target)) return;
  close();
}

function onDocumentKeydown(e) {
  if (!isOpen) return;
  if (e.key === "Escape") {
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
  if (locked) li.classList.add("is-locked");
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

  li.addEventListener("click", () => {
    if (locked) {
      close();
      if (onOpenSettingsCb) onOpenSettingsCb(entry.requiresToken);
      return;
    }
    setActive(entry.id);
    close();
    if (onSelectCb) onSelectCb(entry.id);
  });
  li.addEventListener("keydown", (e) => onRowKeydown(e, li));

  return li;
}

function onRowKeydown(e, li) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
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
