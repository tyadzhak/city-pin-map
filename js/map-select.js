// Shift+drag "box select" on the MAIN map (this milestone). Clusters are
// geographic, so bulk-assigning many pins to a group is faster as a spatial
// rubber-band drag than one-by-one in the pin list.
//
// Interaction: holding Shift and dragging on the map draws a dashed
// rectangle overlay div that follows the cursor. On release, every pin whose
// PROJECTED screen position (map.project([lon, lat])) falls inside the
// rectangle is selected. With zero pins inside, the selection just dissolves
// (no panel). With one or more, a small floating popover appears near the
// release point offering bulk assignment: an existing group via <select>, or
// a "+ New group…" option that reveals a name input. The NAME is required
// from the user here (unlike js/group-panel.js's "Add group" button, which
// auto-names "Group N") — only the COLOR default is shared: the same fixed
// palette, rotated by group count. That palette is DUPLICATED here
// (js/group-panel.js keeps its own copy private) rather than importing a
// side-panel renderer module from a map overlay module, mirroring this
// codebase's existing preference for a small intentional duplication over an
// odd cross-layer import (see CLAUDE.md's default-pin bullet for the same
// call). Assignment applies in ONE batch via pins.replaceAll() — the same
// single-notify pattern js/app.js's default-pin "Apply to all pins" uses —
// preserving every other pin field. Escape or a click outside the popover
// cancels without assigning; so does drawing a box with nothing inside it.
//
// TRADE-OFF — box zoom is sacrificed for box select. MapLibre GL JS ships a
// built-in `boxZoom` interaction on Shift+drag; init() disables it
// (map.boxZoom.disable()) so it can't fight this feature. That removal has a
// side effect: boxZoom's own activation is what normally blocks MapLibre's
// dragPan handler from also claiming a Shift-held drag (dragPan has no
// Shift-key gate of its own — it only skips a gesture another handler has
// already claimed). With boxZoom disabled, nothing would claim it and a
// Shift+drag would silently pan the map instead of selecting. Rather than
// depend on that internal MapLibre coordination staying stable, this module
// pre-empts the gesture itself: onContainerPointerDown listens on the map's
// CONTAINER (an ancestor of MapLibre's own canvas listeners) in the CAPTURE
// phase, so it observes the Shift+pointerdown first.
//
// The load-bearing call there is preventDefault(), NOT stopPropagation():
// maplibre-gl@4.7.1 (the pinned dist) binds MOUSE events only — mousedown /
// mousemove / mouseup — and registers zero `pointerdown` listeners, so
// stopping propagation of a POINTER event never reaches them. What does reach
// them is the browser's COMPATIBILITY mouse event, synthesized from the same
// gesture right after the pointerdown; calling preventDefault() on the
// pointerdown suppresses that synthesized mousedown (and the trailing
// mouseup), so MapLibre's dragPan never sees a gesture to claim.
// stopPropagation() is kept as belt-and-braces — harmless, and it would cover
// a future MapLibre that does listen for pointer events.
//
// Pure geometry (normalizeRect / rectContainsPoint / pinsInRect) is exported
// separately so it's unit-testable without a DOM — see js/map-select.test.mjs.
// This module is otherwise DOM/MapLibre-heavy (like js/map-inset.js,
// js/map-frame.js, …) and is intentionally left off the `npm run coverage`
// gate's --include list for the same reason those are: see CLAUDE.md's
// Testing section.

import { listPins, replaceAll as replacePins } from "./pins.js";
import { listGroups, addGroup } from "./groups.js";

// Mirrors js/group-panel.js's own DEFAULT_COLORS verbatim (kept private
// there) so a group created from either entry point rotates through the
// same palette.
const DEFAULT_COLORS = [
  "#e63946",
  "#1d3557",
  "#2a9d8f",
  "#f4a261",
  "#264653",
  "#9d4edd",
];

const NEW_GROUP_VALUE = "__new-group__";
const HIGHLIGHT_CLASS = "map-select-highlighted";
// Popover offset from the release point / box corner, and the margin kept
// clear of the container edge when clamping — both CSS px.
const PANEL_OFFSET_PX = 8;
const PANEL_EDGE_MARGIN_PX = 8;

let initialized = false;
let mapInstance = null;
let containerEl = null;

// Active rubber-band drag. Null when idle.
let dragState = null; // { startX, startY, pointerId }
let rectEl = null; // the dashed rectangle overlay div

// Active assignment popover. Null when closed.
let panelEl = null;
let escHandler = null;
let outsideClickHandler = null;

/**
 * Wire box-select to the MAIN map. Idempotent: a second call is a no-op.
 * Disables MapLibre's built-in boxZoom (see the trade-off note above) and
 * attaches the capture-phase pointerdown listener that starts a drag.
 */
export function init(map) {
  if (!map || initialized) return;
  initialized = true;
  mapInstance = map;
  containerEl = map.getContainer();

  if (map.boxZoom && typeof map.boxZoom.disable === "function") {
    map.boxZoom.disable();
  }

  // capture:true — see the module header's trade-off note for why this must
  // run before MapLibre's own (bubble-phase) canvas listeners.
  containerEl.addEventListener("pointerdown", onContainerPointerDown, true);
}

// ---- Pure geometry (unit-tested in js/map-select.test.mjs) -------------

/**
 * Canonicalizes two arbitrary corner points into a {left, top, right,
 * bottom} rectangle, so a drag in any direction (up-left, down-right, …)
 * produces the same shape. Pure — no DOM.
 */
export function normalizeRect(x1, y1, x2, y2) {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

/** True when (x, y) falls within `rect`, inclusive of its edges. Pure. */
export function rectContainsPoint(rect, x, y) {
  return (
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  );
}

/**
 * Returns the ids of every point in `points` ({id, x, y}) that falls inside
 * `rect`, preserving input order. Pure — `points` is caller-projected screen
 * coordinates (typically map.project() results), so this function itself has
 * no MapLibre/DOM dependency. Defensive against null/undefined entries.
 */
export function pinsInRect(points, rect) {
  const ids = [];
  for (const p of points) {
    if (p && rectContainsPoint(rect, p.x, p.y)) ids.push(p.id);
  }
  return ids;
}

// ---- Drag interaction ---------------------------------------------------

function onContainerPointerDown(ev) {
  if (!mapInstance || !containerEl) return;
  if (ev.button !== undefined && ev.button !== 0) return;
  if (!ev.shiftKey) return;
  // Let existing interactive descendants of #map keep their own gesture: a
  // pin label (drag), the corner inset box (drag), the on-map title (drag),
  // this module's OWN assignment popover (its buttons/select/input), and
  // MapLibre's attribution control (a real link). Ours is a CAPTURE-phase
  // listener on an ANCESTOR, so without this bail-out a Shift-held press on
  // any of them would be preventDefault()ed and swallowed into a new rubber
  // band before their own handler (or the browser's default click/navigation)
  // ever ran.
  if (
    ev.target &&
    ev.target.closest &&
    ev.target.closest(
      ".map-pin-labels__label, .map-inset-overlay, .export-on-map-title, .map-select-panel, .maplibregl-ctrl"
    )
  ) {
    return;
  }

  // See the module header's trade-off note: preventDefault() is what actually
  // keeps MapLibre's dragPan handler out of the Shift-held drag (it suppresses
  // the compatibility mousedown/mouseup MapLibre actually listens for) now
  // that boxZoom, its usual blocker, is disabled. stopPropagation() is
  // belt-and-braces for a future MapLibre that listens for pointer events.
  ev.preventDefault();
  ev.stopPropagation();

  // A stale drag can survive when a pointerup never arrives (setPointerCapture
  // threw AND the release happened outside the window) — its rectEl would
  // otherwise be orphaned in the DOM forever, permanently painted, once this
  // pointerdown overwrites `rectEl` with a fresh div.
  cancelDrag();
  // A new drag replaces any pending selection popover.
  closePanel();

  const rect = containerEl.getBoundingClientRect();
  const startX = ev.clientX - rect.left;
  const startY = ev.clientY - rect.top;
  dragState = { startX, startY, pointerId: ev.pointerId };

  rectEl = document.createElement("div");
  rectEl.className = "map-select-rect";
  containerEl.appendChild(rectEl);
  paintRect(startX, startY, startX, startY);

  try {
    containerEl.setPointerCapture(ev.pointerId);
  } catch (_err) {
    // Older browsers without pointer capture — the listeners below still
    // fire while the cursor stays over the container.
  }
  containerEl.addEventListener("pointermove", onContainerPointerMove);
  containerEl.addEventListener("pointerup", onContainerPointerUp);
  containerEl.addEventListener("pointercancel", onContainerPointerUp);
}

/**
 * Tears an in-flight drag all the way down: the move/up/cancel listeners, the
 * pointer capture, the rubber-band div, and `dragState`. Idempotent and safe
 * to call when idle, so it doubles as the "clean up whatever the last drag
 * left behind" guard at the top of onContainerPointerDown.
 */
function cancelDrag() {
  if (containerEl) {
    containerEl.removeEventListener("pointermove", onContainerPointerMove);
    containerEl.removeEventListener("pointerup", onContainerPointerUp);
    containerEl.removeEventListener("pointercancel", onContainerPointerUp);
    if (dragState) {
      try {
        containerEl.releasePointerCapture(dragState.pointerId);
      } catch (_err) {
        // no-op if capture was never taken, or already implicitly released
      }
    }
  }
  dragState = null;
  if (rectEl) {
    rectEl.remove();
    rectEl = null;
  }
}

function onContainerPointerMove(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId || !containerEl) {
    return;
  }
  const rect = containerEl.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  paintRect(dragState.startX, dragState.startY, x, y);
}

function onContainerPointerUp(ev) {
  if (!dragState || ev.pointerId !== dragState.pointerId || !containerEl) {
    return;
  }
  // pointercancel is NOT a release — the OS aborted the gesture (a system
  // gesture took over, the pointer device was removed, …). The rectangle on
  // screen at that moment is a partial one the user never confirmed, so tear
  // the drag down without selecting anything or opening the assign popover.
  if (ev.type === "pointercancel") {
    cancelDrag();
    return;
  }

  const rect = containerEl.getBoundingClientRect();
  const endX = ev.clientX - rect.left;
  const endY = ev.clientY - rect.top;
  const selRect = normalizeRect(dragState.startX, dragState.startY, endX, endY);

  cancelDrag();

  const points = listPins()
    .filter((p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat))
    .map((p) => {
      const projected = mapInstance.project([p.lon, p.lat]);
      return { id: p.id, x: projected.x, y: projected.y };
    });
  const ids = pinsInRect(points, selRect);
  if (ids.length === 0) return; // nothing inside — selection dissolves silently

  openPanel(ids, { x: endX, y: endY });
}

function paintRect(x1, y1, x2, y2) {
  if (!rectEl) return;
  const r = normalizeRect(x1, y1, x2, y2);
  rectEl.style.left = `${r.left}px`;
  rectEl.style.top = `${r.top}px`;
  rectEl.style.width = `${r.right - r.left}px`;
  rectEl.style.height = `${r.bottom - r.top}px`;
}

// ---- Assignment popover ---------------------------------------------------

function openPanel(selectedIds, anchor) {
  setHighlight(selectedIds);

  panelEl = document.createElement("div");
  panelEl.className = "map-select-panel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-label", "Assign selected pins to a group");

  const count = document.createElement("p");
  count.className = "map-select-panel__count";
  count.textContent = `${selectedIds.length} pin${selectedIds.length === 1 ? "" : "s"} selected`;
  panelEl.appendChild(count);

  const groups = listGroups();
  const select = document.createElement("select");
  select.className = "map-select-panel__select";
  select.setAttribute("aria-label", "Group");
  for (const g of groups) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  }
  const newOpt = document.createElement("option");
  newOpt.value = NEW_GROUP_VALUE;
  newOpt.textContent = "+ New group…";
  select.appendChild(newOpt);
  panelEl.appendChild(select);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "map-select-panel__name";
  nameInput.placeholder = "New group name";
  nameInput.setAttribute("aria-label", "New group name");
  panelEl.appendChild(nameInput);

  // No existing groups to pick from — skip straight to "new group" mode
  // rather than showing a dropdown with only the "+ New group…" entry.
  if (groups.length === 0) select.value = NEW_GROUP_VALUE;

  // Also gates the Assign button: "+ New group…" with a blank name has
  // nothing to assign TO, so the button is disabled rather than being
  // clickable into a silent no-op (CLAUDE.md: never swallow without feedback).
  // Declared before `assignBtn` but never CALLED before it exists — the first
  // call is after the actions row is built below.
  const syncNameVisibility = () => {
    nameInput.hidden = select.value !== NEW_GROUP_VALUE;
    assignBtn.disabled = !nameInput.hidden && !nameInput.value.trim();
  };
  select.addEventListener("change", () => {
    syncNameVisibility();
    if (!nameInput.hidden) nameInput.focus();
  });
  nameInput.addEventListener("input", syncNameVisibility);

  const actions = document.createElement("div");
  actions.className = "map-select-panel__actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "map-select-panel__cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => closePanel());
  const assignBtn = document.createElement("button");
  assignBtn.type = "button";
  assignBtn.className = "map-select-panel__assign";
  assignBtn.textContent = "Assign";
  assignBtn.addEventListener("click", () => assign(selectedIds, select, nameInput));
  actions.append(cancelBtn, assignBtn);
  panelEl.appendChild(actions);
  syncNameVisibility();

  containerEl.appendChild(panelEl);
  positionPanel(anchor);

  if (nameInput.hidden) {
    select.focus();
  } else {
    nameInput.focus();
  }

  escHandler = (ev) => {
    if (ev.key === "Escape") closePanel();
  };
  outsideClickHandler = (ev) => {
    if (panelEl && !panelEl.contains(ev.target)) closePanel();
  };
  document.addEventListener("keydown", escHandler);
  // capture:true — js/map-labels.js (label drag), js/map-inset.js (box drag)
  // and js/map-title.js (title drag) all stopPropagation() from their own
  // pointerdown, so a bubble-phase listener here would never fire when the
  // user starts one of those drags and the popover would stay open (still
  // claiming N selected while the label rebuild silently drops the highlight
  // cue). Capture runs before those handlers, so "click anywhere outside"
  // means it.
  document.addEventListener("pointerdown", outsideClickHandler, true);
}

// Places the popover near `anchor` (the release point, in container-relative
// CSS px), clamped so it never overflows the container's edges.
function positionPanel(anchor) {
  if (!panelEl || !containerEl) return;
  const containerRect = containerEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  const maxX = Math.max(
    PANEL_EDGE_MARGIN_PX,
    containerRect.width - panelRect.width - PANEL_EDGE_MARGIN_PX
  );
  const maxY = Math.max(
    PANEL_EDGE_MARGIN_PX,
    containerRect.height - panelRect.height - PANEL_EDGE_MARGIN_PX
  );
  const x = Math.min(
    Math.max(PANEL_EDGE_MARGIN_PX, anchor.x + PANEL_OFFSET_PX),
    maxX
  );
  const y = Math.min(
    Math.max(PANEL_EDGE_MARGIN_PX, anchor.y + PANEL_OFFSET_PX),
    maxY
  );
  panelEl.style.left = `${x}px`;
  panelEl.style.top = `${y}px`;
}

function assign(selectedIds, select, nameInput) {
  let groupId = select.value;
  if (groupId === NEW_GROUP_VALUE) {
    const name = nameInput.value.trim();
    if (!name) {
      // Unreachable in practice — syncNameVisibility() disables the Assign
      // button while the name is blank, which is where the user-visible
      // feedback lives. Kept as a defensive guard so a programmatic call can
      // never create an unnamed group.
      nameInput.focus();
      return;
    }
    const groups = listGroups();
    const group = addGroup({
      name,
      color: DEFAULT_COLORS[groups.length % DEFAULT_COLORS.length],
    });
    groupId = group.id;
  }

  const idSet = new Set(selectedIds);
  // Single-notify batch (mirrors js/app.js's default-pin "Apply to all
  // pins"): every OTHER field (color, icon, labelDx/labelDy, createdAt, …)
  // is preserved via the spread.
  replacePins(
    listPins().map((p) => (idSet.has(p.id) ? { ...p, group: groupId } : p))
  );
  closePanel();
}

function closePanel() {
  if (escHandler) {
    document.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  if (outsideClickHandler) {
    // Matching capture flag — a removeEventListener without it wouldn't
    // unregister the capture-phase listener added in openPanel().
    document.removeEventListener("pointerdown", outsideClickHandler, true);
    outsideClickHandler = null;
  }
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  clearHighlight();
}

// ---- Selection cue (cheap: a CSS class on the pin's DOM label) ----------
//
// Only pins with a rendered label (js/map-labels.js — non-empty name) get a
// visible cue; an unlabeled pin has no DOM element to outline. The panel's
// own count is the fallback source of truth, per this feature's spec. A
// concurrent pin/group store change while the popover is open would rebuild
// the label overlay's DOM (map-labels.js's render() does a full teardown)
// and silently drop the cue — cosmetic only, since `selectedIds` itself is a
// plain array captured by closure, unaffected by that rebuild.

function setHighlight(ids) {
  if (!containerEl) return;
  const idSet = new Set(ids);
  // `:scope >` restricts this to the MAIN map's own label overlay. Both
  // overlays use the same classes, and the inset's (js/map-inset.js) lives
  // deeper inside this same container
  // (#map > .map-inset-overlay > .map-inset-overlay__map > .map-pin-labels),
  // so an unscoped query would also outline the selected pins INSIDE the
  // corner inset — noise, since the selection is a main-map gesture.
  const labels = containerEl.querySelectorAll(
    ":scope > .map-pin-labels .map-pin-labels__label[data-pin-id]"
  );
  labels.forEach((el) => {
    el.classList.toggle(HIGHLIGHT_CLASS, idSet.has(el.dataset.pinId));
  });
}

function clearHighlight() {
  if (!containerEl) return;
  const labels = containerEl.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  labels.forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
}
