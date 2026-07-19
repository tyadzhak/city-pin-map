// Live WYSIWYG corner inset — an atlas-style magnifier. A small framed square
// box docked in a corner of the MAIN map, hosting a SECOND MapLibre map fitted
// to the pins of one chosen group at higher zoom, plus a thin "locator
// rectangle" drawn on the main map marking the inset's bounds. Solves the
// "10 pins clustered in one region + 3 far-flung ones, unreadable at
// continental zoom" problem by showing the cluster region zoomed-in alongside
// the wide view.
//
// Mirrors the overlay-module pattern of js/map-fade.js / js/map-frame.js: an
// overlay div appended inside the main map's container, an idempotent init(),
// and a single update(cfg) that shows/hides and redraws. js/export.js's
// paintInset() step mirrors this onto the export canvas 1:1 — it awaits
// getInsetMap()'s `idle` and drawImage's its canvas at the geometry
// getPlacement() reports (this module renders live; export composites it).
// The docking geometry (16px margin, sizePct% width) and the box styling
// (2px white border, 6px radius, soft drop shadow) live in .map-inset-overlay
// in css/styles.css; export.js's paintInset() re-derives the same values in
// canvas space, so any change here must be mirrored there and vice versa.
//
// So export.js can consume the LIVE overlay state without a handle plumbed
// through app.js (the FBL-009..023 convention: export reads live state, not
// snapshots), getInsetMap/getPlacement/getBoundsInUse are ALSO module-level
// exports reading the same module-scoped state — null-safe before init().
// init() still returns them bundled in its handle for app.js's own use.
//
// The inset's basemap is SEEDED from the main map's already-resolved style
// (mainMap.getStyle()), with the app-added sources/layers stripped by their
// "city-pin-map." prefix — so no style URL / API key is ever re-resolved. The
// pins/route are then re-added onto the inset via the SHARED helpers exported
// from js/map.js (addPinAndRouteLayers / renderPinsTo / renderRouteTo), which
// also re-register the SDF sprite images that getStyle() omits.
//
// Public surface:
//   init(mainMap) — create the overlay (idempotent), wire the live
//                   subscriptions, and return the handle below.
//   handle.update(insetCfg)   — apply a normalized inset config: show/hide,
//                               re-dock corner, resize, refit bounds, and
//                               update the main-map locator rectangle.
//   handle.getInsetMap()      — the second maplibregl.Map, or null when
//                               disabled/unresolvable (export drawImage's it).
//   handle.getPlacement()     — { corner, sizePct, marginPx } in effect (the
//                               export mirrors this geometry on its canvas).
//   handle.getBoundsInUse()   — the LngLatBounds currently fitted, or null.

import {
  addPinAndRouteLayers,
  renderPinsTo,
  renderRouteTo,
  renderLocator,
  onStyleRendered,
} from "./map.js";
import { listPins, subscribe as subscribePins } from "./pins.js";
import { subscribe as subscribeGroups } from "./groups.js";
import { loadRouteVisible } from "./storage.js";

// App-added sources/layers all live under this id prefix (pins fill/ring/
// labels, route, locator). Stripped from the seed style so we don't reference
// SDF sprite images that getStyle() doesn't carry — addPinAndRouteLayers
// re-adds them (and re-registers the images) on the inset instead.
const APP_PREFIX = "city-pin-map.";

// Fixed dock margin from the container edge, in CSS px. Exposed via
// getPlacement() so the export task mirrors the exact geometry.
const MARGIN_PX = 16;

// fitBounds tuning: ~40px padding so pins don't hug the box edge, maxZoom 10
// guards the single-pin case (a zero-area bounds would otherwise zoom to the
// max and show almost nothing).
const FIT_PADDING_PX = 40;
const FIT_MAX_ZOOM = 10;

let mainMap = null;
let overlay = null; // .map-inset-overlay (positioned, square, bordered)
let insetMapEl = null; // child div hosting the inset MapLibre map
let insetMap = null; // second maplibregl.Map, created LAZILY on first enable
let lastCfg = null; // last config passed to update()
let boundsInUse = null; // LngLatBounds currently fitted, or null when hidden
let resizeObserver = null;
let deferPending = false; // a one-shot "retry once the main map is ready" wait

/**
 * Wire the inset to the main map. Idempotent: a second call reuses the
 * existing overlay/observer rather than creating duplicates.
 */
export function init(map) {
  mainMap = map;

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "map-inset-overlay";
    // Hidden until update() enables it — display:none (not [hidden]) so the
    // inline corner/size styles the module writes stay authoritative.
    overlay.style.display = "none";

    insetMapEl = document.createElement("div");
    insetMapEl.className = "map-inset-overlay__map";
    overlay.appendChild(insetMapEl);

    // Same parent as the other overlays (fade/frame/title), so it lives
    // inside #map and travels with it during js/export.js's off-screen
    // capture reparent.
    map.getContainer().appendChild(overlay);
  }

  // Keep the inset MapLibre map sized to its (square) overlay box. Observing
  // the OVERLAY itself is safe across the export reparent: it lives inside
  // #map and moves with it, so — unlike js/map-viewport.js, which observes
  // .app-map and needs a parent-check guard — no guard is required here.
  if (!resizeObserver && typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      if (insetMap && overlay && overlay.style.display !== "none") {
        insetMap.resize();
      }
    });
    resizeObserver.observe(overlay);
  }

  // Rebuild the inset's basemap whenever the MAIN basemap actually RENDERS (a
  // successful swap or a post-failure revert). Uses map.js's style-render
  // pub/sub rather than the raw `styledata` event so we rebuild exactly once
  // per swap, not on every intermediate styledata tick. The inset's INITIAL
  // style is captured at lazy-creation time, by which point the main map has
  // already rendered — so we don't need a boot notification here.
  onStyleRendered(() => {
    if (insetMap && lastCfg && lastCfg.enabled) rebuildInsetStyle();
  });

  // Keep the inset live: any pin or group change re-resolves the group
  // bounds, re-sets the inset's source data, and refits. Guarded on lastCfg
  // so the hydration-time notify() (before app.js's first update() call) is a
  // no-op.
  subscribePins(() => {
    if (lastCfg) update(lastCfg);
  });
  subscribeGroups(() => {
    if (lastCfg) update(lastCfg);
  });

  return { update, getInsetMap, getPlacement, getBoundsInUse };
}

/**
 * Apply a normalized inset config. Re-resolves the chosen group's bounds,
 * shows/hides + re-docks + resizes the box, refits, and updates the main-map
 * locator. Safe to call repeatedly (it's the same path the live
 * subscriptions use on every pin/group change).
 */
function update(cfg) {
  const c = cfg || {};
  lastCfg = c;

  const resolved = resolveBounds(c);
  // Disabled, no group chosen, group deleted, or the group has zero pins →
  // hide the box AND the locator. Never crash on a stale/unresolvable id.
  if (!c.enabled || !resolved) {
    hideInset();
    return;
  }

  // Show + dock + size FIRST so the inset map's container has real dimensions
  // when (and if) it's lazily constructed just below.
  applyPlacement(c.corner, c.sizePct);

  const ready = ensureInsetMap();
  if (!ready) {
    // Main map's style isn't ready to snapshot yet (e.g. a boot where the
    // persisted config is enabled:true but the main map hasn't finished its
    // first load). Hide for now and retry once it's ready.
    hideInset();
    deferUntilMainReady();
    return;
  }

  boundsInUse = resolved.bounds;
  // The box may have just appeared or resized — re-measure before fitting so
  // the camera matches the real pixel box.
  insetMap.resize();
  renderInsetData(resolved.pins);
  fitInset(resolved.bounds);
  renderLocator(c.showLocator ? resolved.bounds : null);
}

/** The second MapLibre map, or null when disabled/unresolvable. */
export function getInsetMap() {
  // boundsInUse is set only on the enabled + resolvable path and cleared by
  // hideInset(), so it doubles as the "is the inset actually showing" gate —
  // the export task must not drawImage a hidden/stale inset.
  if (!insetMap || !boundsInUse) return null;
  return insetMap;
}

/** The docking geometry currently in effect (marginPx is the fixed 16px). */
export function getPlacement() {
  return {
    corner: lastCfg?.corner || "top-right",
    sizePct: lastCfg?.sizePct || 32,
    marginPx: MARGIN_PX,
  };
}

/** The LngLatBounds currently fitted, or null when the inset is hidden. */
export function getBoundsInUse() {
  return boundsInUse;
}

// ---- Internals --------------------------------------------------------

// Resolve the chosen group's pin bounds. Returns `{ bounds, pins }` where
// `bounds` is the group's pin extent (for fitting + the locator) and `pins`
// is EVERY pin (the inset renders the whole map like a magnifier — the group
// only drives the fit). Returns null when unresolvable: no group chosen, a
// stale/deleted group id (its pins were cascade-cleared to null, so the
// filter finds none), or a group with zero valid-coordinate pins.
function resolveBounds(cfg) {
  if (!cfg.groupId) return null;
  if (typeof maplibregl === "undefined") return null;

  const pins = listPins();
  const groupPins = pins.filter((p) => p && p.group === cfg.groupId);
  if (groupPins.length === 0) return null;

  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const p of groupPins) {
    if (Number.isFinite(p.lon) && Number.isFinite(p.lat)) {
      bounds.extend([p.lon, p.lat]);
      any = true;
    }
  }
  if (!any) return null;
  return { bounds, pins };
}

// Lazily construct the inset MapLibre map, seeded from the main map's current
// (already-resolved) style. Returns the instance, or null when the main
// style can't be snapshotted yet (caller defers).
function ensureInsetMap() {
  if (insetMap) return insetMap;
  if (typeof maplibregl === "undefined") return null;

  const style = buildInsetStyle();
  if (!style) return null;

  insetMap = new maplibregl.Map({
    container: insetMapEl,
    style,
    interactive: false, // decorative — no pan/zoom/rotate handlers
    attributionControl: false,
    // Required so the export task's getCanvas().drawImage reads real pixels
    // rather than a blank buffer (same rationale as the main map in map.js).
    preserveDrawingBuffer: true,
    center: mainMap.getCenter(),
    zoom: mainMap.getZoom(),
    fadeDuration: 0, // crisp labels immediately, no cross-fade on (re)style
  });

  // Re-add pins/route (+ re-register sprite images) once the seed style is
  // parsed. once() — re-armed after each setStyle in rebuildInsetStyle.
  insetMap.once("styledata", onInsetStyleData);
  return insetMap;
}

// Snapshot the main map's resolved style, stripped of the app-added
// sources/layers (see APP_PREFIX). Returns null if the main style isn't
// loaded yet (getStyle throws) so the caller can defer.
function buildInsetStyle() {
  if (!mainMap || typeof mainMap.getStyle !== "function") return null;
  let style;
  try {
    style = mainMap.getStyle();
  } catch (err) {
    // "Style is not done loading" — main map hasn't finished its first load.
    return null;
  }
  if (!style || !Array.isArray(style.layers)) return null;

  const clone = JSON.parse(JSON.stringify(style));
  clone.layers = clone.layers.filter(
    (l) => !(l && typeof l.id === "string" && l.id.startsWith(APP_PREFIX))
  );
  if (clone.sources && typeof clone.sources === "object") {
    for (const id of Object.keys(clone.sources)) {
      if (id.startsWith(APP_PREFIX)) delete clone.sources[id];
    }
  }
  return clone;
}

// Re-seed the inset's basemap after the MAIN basemap changed. Re-arms the
// once() styledata handler so pins/route re-add on the new style.
function rebuildInsetStyle() {
  if (!insetMap) return;
  const style = buildInsetStyle();
  if (!style) return;
  insetMap.setStyle(style, { diff: false });
  insetMap.once("styledata", onInsetStyleData);
}

// Fires once after the inset's (re)seeded style parses. Re-adds the pin/route
// layers (locator suppressed — it belongs on the main map only; failure
// reporting suppressed — the main map already owns that banner), renders the
// current data, and refits to the bounds in use.
async function onInsetStyleData() {
  if (!insetMap) return;
  await addPinAndRouteLayers(insetMap, { locator: false, reportFailures: false });
  if (!insetMap) return;
  renderInsetData();
  if (boundsInUse) fitInset(boundsInUse);
}

// Push the current pins + route into the inset's own sources. Route is
// included iff the main app's route toggle is on (read from storage at render
// time — see the module's known-limitations note re: reactivity to the
// toggle). No-op until the inset's style has the sources (renderPinsTo /
// renderRouteTo guard on that).
function renderInsetData(pins = listPins()) {
  if (!insetMap) return;
  renderPinsTo(insetMap, pins);
  renderRouteTo(insetMap, pins, { visible: loadRouteVisible() });
}

function fitInset(bounds) {
  if (!insetMap || !bounds) return;
  insetMap.fitBounds(bounds, {
    padding: FIT_PADDING_PX,
    maxZoom: FIT_MAX_ZOOM,
    animate: false,
  });
}

function applyPlacement(corner, sizePct) {
  if (!overlay) return;
  overlay.style.display = "block";
  // Width is a percentage of the map container; the box is kept SQUARE via
  // the CSS aspect-ratio (height tracks width automatically, including on a
  // container resize).
  overlay.style.width = `${sizePct}%`;
  overlay.style.top = corner.startsWith("top") ? `${MARGIN_PX}px` : "";
  overlay.style.bottom = corner.startsWith("bottom") ? `${MARGIN_PX}px` : "";
  overlay.style.left = corner.endsWith("left") ? `${MARGIN_PX}px` : "";
  overlay.style.right = corner.endsWith("right") ? `${MARGIN_PX}px` : "";
}

function hideInset() {
  boundsInUse = null;
  if (overlay) overlay.style.display = "none";
  // Also clear the locator on the main map — it must never linger after the
  // inset is disabled/unresolvable.
  renderLocator(null);
}

// One-shot deferral: when update() runs before the main map can be snapshotted
// (boot with a persisted enabled:true), retry the moment the main map next
// goes idle (fires shortly after its first load — more robust than `load`,
// which may already have passed by the time we get here).
function deferUntilMainReady() {
  if (deferPending || !mainMap) return;
  deferPending = true;
  mainMap.once("idle", () => {
    deferPending = false;
    if (lastCfg) update(lastCfg);
  });
}
