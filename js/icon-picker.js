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
import { ingestSvg } from "./svg-ingest.js";

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

// In-flight ingest result. The form's tintable radio + commit button read
// the sanitized markup from this without re-parsing on every interaction.
// Reset whenever the SVG input clears or the sub-view re-opens.
let pendingIngest = null;

export function showAddSubView(pin, modal) {
  pendingIngest = null;

  const sub = document.createElement("div");
  sub.className = "icon-picker-modal__sub";

  // Header with Back button and × close.
  const header = document.createElement("div");
  header.className = "icon-picker-modal__header";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "icon-picker-modal__close";
  back.textContent = "← Back";
  back.addEventListener("click", () => showGridView(modal, pin.id));
  header.appendChild(back);

  const titleSpan = document.createElement("span");
  titleSpan.textContent = "Add custom icon";
  header.appendChild(titleSpan);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-picker-modal__close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", closeIconPicker);
  header.appendChild(close);

  sub.appendChild(header);

  // Scrollable body.
  const body = document.createElement("div");
  body.className = "icon-picker-modal__sub-body";
  sub.appendChild(body);

  // Name field (required).
  const nameField = makeField("Name *", "text");
  body.appendChild(nameField.wrap);

  // SVG content: drop-zone + textarea, two paths into the same ingest
  // pipeline. URL field below is attribution-only — never fetched.
  const svgFieldWrap = document.createElement("div");
  svgFieldWrap.className = "icon-picker-modal__field";

  const svgLabel = document.createElement("label");
  svgLabel.textContent = "SVG content *";
  svgFieldWrap.appendChild(svgLabel);

  const dropZone = document.createElement("div");
  dropZone.className = "icon-picker-modal__drop-zone";
  dropZone.textContent = "Drop SVG file here";
  svgFieldWrap.appendChild(dropZone);

  const orRow = document.createElement("div");
  orRow.className = "icon-picker-modal__or";
  orRow.textContent = "or paste SVG markup";
  svgFieldWrap.appendChild(orRow);

  const textarea = document.createElement("textarea");
  textarea.rows = 4;
  textarea.placeholder = "<svg ...>";
  svgFieldWrap.appendChild(textarea);

  body.appendChild(svgFieldWrap);

  // Source URL — attribution metadata only. Hint text makes that explicit
  // so the user doesn't expect us to "go fetch the icon" from this URL.
  const urlField = makeField(
    "Source URL (optional, for credit)",
    "url",
    "Source link only — not downloaded"
  );
  body.appendChild(urlField.wrap);

  const artistField = makeField("Artist name (optional)", "text");
  body.appendChild(artistField.wrap);

  // Preview row: tinted vs as-is, side by side. Tinted preview uses CSS
  // `color` on the wrapper so SVGs that use `currentColor` reflect the
  // pin's color; SVGs with explicit fills ignore it (which is what
  // tintable=false expects anyway).
  const previewRow = document.createElement("div");
  previewRow.className = "icon-picker-modal__preview-row";
  const tintedCol = makePreviewColumn("Tinted", pin.color);
  const asIsCol = makePreviewColumn("As-is", null);
  previewRow.appendChild(tintedCol.wrap);
  previewRow.appendChild(asIsCol.wrap);
  body.appendChild(previewRow);

  // Tintable radio group. The "(recommended)" label tracks the heuristic
  // suggestion from svg-ingest.js — it switches between options based on
  // unique-fill count.
  const radioGroup = makeTintableRadioGroup();
  body.appendChild(radioGroup.wrap);

  const errorEl = document.createElement("div");
  errorEl.className = "icon-picker-modal__error";
  body.appendChild(errorEl);

  // Action buttons.
  const actions = document.createElement("div");
  actions.className = "icon-picker-modal__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => showGridView(modal, pin.id));
  actions.appendChild(cancelBtn);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "Add to my icons";
  addBtn.disabled = true;
  addBtn.addEventListener("click", () => {
    if (!pendingIngest || !pendingIngest.ok) return;
    const name = nameField.input.value.trim();
    if (!name) return;
    const sourceUrl = urlField.input.value.trim() || null;
    const artistName = artistField.input.value.trim() || null;
    userIconStore.add({
      name,
      tintable: radioGroup.getValue(),
      fillSvg: pendingIngest.sanitizedSvg,
      attribution:
        sourceUrl || artistName ? { sourceUrl, artistName } : null,
    });
    pendingIngest = null;
    showGridView(modal, pin.id);
  });
  actions.appendChild(addBtn);

  sub.appendChild(actions);

  // Wire ingestion. Every input event re-runs ingestSvg; the latest result
  // wins. This also fires when a dropped file is read into the textarea.
  const runIngest = (rawText) => {
    if (!rawText) {
      tintedCol.preview.replaceChildren();
      asIsCol.preview.replaceChildren();
      errorEl.textContent = "";
      addBtn.disabled = true;
      pendingIngest = null;
      return;
    }
    const result = ingestSvg(rawText);
    if (!result.ok) {
      errorEl.textContent = result.error;
      tintedCol.preview.replaceChildren();
      asIsCol.preview.replaceChildren();
      addBtn.disabled = true;
      pendingIngest = null;
      return;
    }
    errorEl.textContent = "";
    pendingIngest = result;
    radioGroup.setRecommendation(result.suggestedTintable);
    radioGroup.selectInitial(result.suggestedTintable);
    const dataUrl =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(result.sanitizedSvg);
    tintedCol.preview.replaceChildren(makePreviewImg(dataUrl));
    asIsCol.preview.replaceChildren(makePreviewImg(dataUrl));
    addBtn.disabled = nameField.input.value.trim().length === 0;
  };

  textarea.addEventListener("input", () => runIngest(textarea.value));

  nameField.input.addEventListener("input", () => {
    addBtn.disabled =
      !pendingIngest || nameField.input.value.trim().length === 0;
  });

  // Drag-and-drop SVG file. Only `.svg` and `image/svg+xml` accepted —
  // anything else surfaces a clear error rather than silently failing.
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("icon-picker-modal__drop-zone--active");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("icon-picker-modal__drop-zone--active");
  });
  dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("icon-picker-modal__drop-zone--active");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (
      !/svg/.test(file.type) &&
      !file.name.toLowerCase().endsWith(".svg")
    ) {
      errorEl.textContent = "Drop an .svg file.";
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      // The dropped file became unreadable between drop and read (moved,
      // deleted, permission-denied). Surface it instead of leaving the user
      // staring at an empty preview with no idea the drop failed.
      runIngest("");
      errorEl.textContent = "Could not read that file. Try again.";
      return;
    }
    textarea.value = text;
    runIngest(text);
  });

  modal.replaceChildren(sub);
}

function makeField(labelText, inputType, hint) {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__field";

  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);

  const input = document.createElement("input");
  input.type = inputType;
  wrap.appendChild(input);

  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "icon-picker-modal__hint";
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }
  return { wrap, input };
}

function makePreviewColumn(labelText, color) {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__preview-col";

  const label = document.createElement("span");
  label.className = "icon-picker-modal__preview-label";
  label.textContent = labelText;
  wrap.appendChild(label);

  const preview = document.createElement("div");
  preview.className = "icon-picker-modal__preview";
  if (color) preview.style.color = color;
  wrap.appendChild(preview);

  return { wrap, preview };
}

function makePreviewImg(dataUrl) {
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Preview";
  return img;
}

// Builds the Tinting radio group. Two options + a "(recommended)" label
// that tracks the heuristic. All DOM via createElement — no innerHTML.
function makeTintableRadioGroup() {
  const wrap = document.createElement("div");
  wrap.className = "icon-picker-modal__field icon-picker-modal__radio-group";

  const titleLabel = document.createElement("label");
  titleLabel.textContent = "Tinting";
  wrap.appendChild(titleLabel);

  // Tint option.
  const tintLabel = document.createElement("label");
  const tintInput = document.createElement("input");
  tintInput.type = "radio";
  tintInput.name = "tintable";
  tintInput.value = "true";
  tintLabel.appendChild(tintInput);
  tintLabel.appendChild(document.createTextNode(" Tint with pin color"));

  const tintRecommend = document.createElement("span");
  tintRecommend.className =
    "icon-picker-modal__recommend icon-picker-modal__recommend--hidden";
  tintRecommend.textContent = " (recommended)";
  tintLabel.appendChild(tintRecommend);
  wrap.appendChild(tintLabel);

  // As-is option.
  const asisLabel = document.createElement("label");
  const asisInput = document.createElement("input");
  asisInput.type = "radio";
  asisInput.name = "tintable";
  asisInput.value = "false";
  asisInput.checked = true;
  asisLabel.appendChild(asisInput);
  asisLabel.appendChild(document.createTextNode(" Use as-is"));

  const asisRecommend = document.createElement("span");
  asisRecommend.className = "icon-picker-modal__recommend";
  asisRecommend.textContent = " (recommended)";
  asisLabel.appendChild(asisRecommend);
  wrap.appendChild(asisLabel);

  return {
    wrap,
    setRecommendation(suggestTintable) {
      tintRecommend.classList.toggle(
        "icon-picker-modal__recommend--hidden",
        !suggestTintable
      );
      asisRecommend.classList.toggle(
        "icon-picker-modal__recommend--hidden",
        suggestTintable
      );
    },
    selectInitial(suggestTintable) {
      if (suggestTintable) tintInput.checked = true;
      else asisInput.checked = true;
    },
    getValue() {
      return tintInput.checked;
    },
  };
}
