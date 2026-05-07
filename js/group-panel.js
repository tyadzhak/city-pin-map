// Renders the group store into the side panel (NICE-004).
//
// Mirrors js/pin-list.js (CORE-008): one heading, one scrollable list,
// full clear-and-rebuild render on every store change, plus a one-shot
// initial render for hydration.
//
// Differences from the pin list:
// - The name input is always visible (no click-to-edit toggle), because
//   group names tend to need editing right after creation ("Group 4" →
//   "Italy 2024") and an extra rename step would feel like friction.
// - The color input is rendered directly (not the swatch + hidden-input
//   pattern from CORE-011) so the row reads as a small form, not a
//   read-only line. Native browser dialogs handle the color picker.

import {
  subscribe,
  listGroups,
  addGroup,
  updateGroup,
  removeGroup,
} from "./groups.js";
import { listPins, updatePin } from "./pins.js";

// Rotated through on each "Add group" click so successive defaults are
// visually distinct without forcing the user to pick a color first.
const DEFAULT_COLORS = [
  "#e63946",
  "#1d3557",
  "#2a9d8f",
  "#f4a261",
  "#264653",
  "#9d4edd",
];

export function initGroupPanel() {
  const listEl = document.getElementById("group-list");
  const emptyEl = document.getElementById("group-list-empty");
  const addBtn = document.getElementById("add-group");

  if (!listEl || !emptyEl || !addBtn) {
    console.warn("group-panel elements missing; panel will not render");
    return () => {};
  }

  // Wired once at init. Reads the current group count at click time so
  // the default name and color reflect the latest state, even after
  // deletes. The store's notify() then triggers a re-render that draws
  // the new row.
  addBtn.addEventListener("click", () => {
    const groups = listGroups();
    const n = groups.length + 1;
    addGroup({
      name: `Group ${n}`,
      color: DEFAULT_COLORS[groups.length % DEFAULT_COLORS.length],
    });
  });

  const unsubscribe = subscribe((groups) => render(listEl, emptyEl, groups));
  // Backfill the hydration notify() that fired before we subscribed —
  // same pattern as pin-list.js.
  render(listEl, emptyEl, listGroups());
  return unsubscribe;
}

function render(listEl, emptyEl, groups) {
  // Snapshot is already a fresh slice from the store; sort by createdAt
  // so newest rows always sit at the bottom regardless of update order.
  const sorted = groups.slice().sort((a, b) => a.createdAt - b.createdAt);
  listEl.replaceChildren(...sorted.map(buildRow));
  emptyEl.hidden = sorted.length > 0;
}

function buildRow(group) {
  const row = document.createElement("li");
  row.className = "group-list__row";
  row.dataset.groupId = group.id;

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.className = "group-list__color";
  colorInput.value = group.color;
  colorInput.setAttribute("aria-label", `Color for ${group.name || "group"}`);
  // `change` fires only when the user actually picks a color; cancelling
  // the dialog is silent, so no spurious commits.
  colorInput.addEventListener("change", () => {
    updateGroup(group.id, { color: colorInput.value });
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "group-list__name-input";
  nameInput.value = group.name;
  nameInput.setAttribute("aria-label", `Name of ${group.name || "group"}`);

  // Use the native `change` event to commit. It fires on blur if-and-only-if
  // the value differs from focus-time, which gives us the right semantics
  // for free: blur with a real edit commits, blur with no edit doesn't.
  // The keydown handlers below funnel Enter / Escape through the same path.
  nameInput.addEventListener("change", () => {
    const trimmed = nameInput.value.trim();
    if (!trimmed) {
      // Empty rejection: snap back to the persisted name, no notify.
      // Matches the rename-pin pattern from CORE-010 (revert in place).
      nameInput.value = group.name;
      return;
    }
    if (trimmed === group.name) return;
    updateGroup(group.id, { name: trimmed });
  });

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // blur → triggers `change` (if value differs) → commits via above.
      nameInput.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Restore BEFORE blurring; otherwise `change` would fire on blur
      // and commit the cancelled text.
      nameInput.value = group.name;
      nameInput.blur();
    }
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-group";
  remove.textContent = "✕";
  remove.setAttribute("aria-label", `Remove group ${group.name || ""}`);
  remove.addEventListener("click", () => {
    // NICE-005 cascade: clear `pin.group` on every pin pointing at this
    // group BEFORE removing the group itself. Order matters — if we
    // removed the group first, those pins would briefly hold a dangling
    // reference and any listener firing in between (storage, map render)
    // would see an inconsistent snapshot. Going pin-side first means each
    // updatePin notify() lands on a still-valid group store.
    for (const pin of listPins()) {
      if (pin.group === group.id) {
        updatePin(pin.id, { group: null });
      }
    }
    removeGroup(group.id);
  });

  row.appendChild(colorInput);
  row.appendChild(nameInput);
  row.appendChild(remove);
  return row;
}
