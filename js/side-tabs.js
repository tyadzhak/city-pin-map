// Side-panel tab controller (Design | Pins | Groups). The side-tabs
// restructuring moved export/title/frame config out of the header and into
// its own tab alongside the existing Pins and Groups sections; this module
// is the thin ARIA-tabs glue that shows/hides the three panels and
// remembers which one was last open. It knows nothing about what's inside
// each panel — other modules (app.js, pin-list.js, group-panel.js) keep
// finding their controls by id exactly as before, regardless of which
// panel currently contains them.
import { loadActiveSideTab, saveActiveSideTab } from "./storage.js";

export function initSideTabs() {
  const tablist = document.querySelector(".side-tabs");
  const tabs = Array.from(document.querySelectorAll(".side-tab"));
  if (!tablist || tabs.length === 0) return;

  // Resolve each tab's panel via its own aria-controls attribute rather
  // than hardcoding the pairing — keeps this module correct even if the
  // panel order in the DOM changes.
  const panelsByTabId = new Map();
  for (const tab of tabs) {
    const panelId = tab.getAttribute("aria-controls");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return; // A tab with no matching panel means the markup is
    // broken in a way this module can't safely paper over — bail rather
    // than half-wire a tablist that would silently do nothing on click.
    panelsByTabId.set(tab.id, panel);
  }

  function activate(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    for (const t of tabs) {
      const isActive = t === tab;
      t.setAttribute("aria-selected", isActive ? "true" : "false");
      t.tabIndex = isActive ? 0 : -1;
      const panel = panelsByTabId.get(t.id);
      if (panel) panel.hidden = !isActive;
    }
    saveActiveSideTab(idFromTabElementId(tabId));
  }

  // Tab element ids are "side-tab-<name>"; storage keys are the bare
  // "<name>" (design/pins/groups) — this maps between the two so
  // storage.js doesn't need to know about DOM id conventions.
  function idFromTabElementId(tabId) {
    return tabId.replace(/^side-tab-/, "");
  }
  function tabElementIdFromId(id) {
    return `side-tab-${id}`;
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.id));
  }

  // Roving-tabindex keyboard nav — standard ARIA tabs pattern. Left/Right
  // wrap around the ends; Home/End jump straight to the first/last tab.
  // Selection follows focus (activating on arrow move, not just Enter/
  // Space) since that's the expected behaviour for this small, cheap-to-
  // switch tab set.
  tablist.addEventListener("keydown", (event) => {
    const currentIndex = tabs.findIndex(
      (t) => t.getAttribute("aria-selected") === "true"
    );
    let nextIndex = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    activate(nextTab.id);
    nextTab.focus();
  });

  const saved = loadActiveSideTab();
  activate(tabElementIdFromId(saved));
}
