// Pins-tab "Tips" disclosure (UXR-017): explains gestures that have no visible
// affordance. Add a gesture by appending one string to TIPS — only list
// gestures that actually exist.
import { loadTipsOpen, saveTipsOpen } from "./storage.js";

const TIPS = [
  "Shift + drag on the map to select several pins and assign them to a group.",
  "Drag a pin's name on the map to move its label.",
  "Drag the on-map title or the inset map to reposition it.",
  "Double-click a pin's name in this list to rename it.",
];

function initTips() {
  const details = document.getElementById("pin-tips");
  const list = document.getElementById("pin-tips-list");
  if (!details || !list) return;

  for (const text of TIPS) {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  }

  details.open = loadTipsOpen();
  details.addEventListener("toggle", () => saveTipsOpen(details.open));
}

initTips();
