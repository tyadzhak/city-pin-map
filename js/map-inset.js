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
//   handle.getPlacement()     — { corner, sizePct, heightPct, marginPx } in
//                               effect (the export mirrors this geometry).
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
import { loadRouteVisible, saveInset } from "./storage.js";
import { attachTo as attachLabelOverlay } from "./map-labels.js";
import { getFrameSetInUse } from "./map-frame.js";

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

// Shared 0-200 px clamp for a frame element's margin/thickness/padding, mirroring
// js/map-frame.js's clampLength and js/storage.js's normalizeFrame — reused here
// because getFrameSetInUse() can hand back un-normalized live number-input reads.
const FRAME_LENGTH_MIN = 0;
const FRAME_LENGTH_MAX = 200;

let mainMap = null;
let overlay = null; // .map-inset-overlay (positioned, square, bordered)
let insetMapEl = null; // child div hosting the inset MapLibre map
let insetMap = null; // second maplibregl.Map, created LAZILY on first enable
let insetLabels = null; // DOM label overlay for the inset (map-labels.js), draggable
let lastCfg = null; // last config passed to update()
let boundsInUse = null; // LngLatBounds currently fitted, or null when hidden
let resizeObserver = null;
let deferPending = false; // a one-shot "retry once the main map is ready" wait
// True when the main basemap (or its label visibility) changed while the inset
// was NOT live to re-seed from it — because the inset was disabled/hidden, or
// not yet lazily created. The next ensureInsetMap()/refreshStyle() rebuilds the
// seed style before showing, so re-enabling always picks up the CURRENT main
// basemap rather than the stale one captured at last creation.
let styleDirty = false;

// Box-drag state (Pointer Events + setPointerCapture on the overlay, mirroring
// js/map-title.js). Null/false when idle. `boxDragLast` caches the final clamped
// top-left + the container size it was clamped against, so pointerup can derive
// the persisted freePos fractions from exactly the pixels last drawn.
let boxDragging = false;
let boxDragPointerId = null;
let boxDragOffsetX = 0;
let boxDragOffsetY = 0;
let boxDragLast = null;

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

    // The box is draggable: Pointer Events + setPointerCapture on the overlay
    // itself (same mechanics as js/map-title.js). CSS gives the box
    // pointer-events:auto so a pointerdown on it starts a drag; the map beneath
    // still pans when the pointer is OUTSIDE the (small) box. A pointerdown that
    // lands on an inset LABEL never reaches here — the label's own handler
    // stopPropagation()s first (js/map-labels.js) — so label drag and box drag
    // never fight.
    overlay.addEventListener("pointerdown", onBoxPointerDown);
    overlay.addEventListener("pointermove", onBoxPointerMove);
    overlay.addEventListener("pointerup", onBoxPointerUp);
    overlay.addEventListener("pointercancel", onBoxPointerUp);
  }

  // Keep the inset MapLibre map sized to its (square) overlay box AND re-run
  // the dock/clamp math on every container resize (window resize, side-panel
  // toggle, export-preset letterbox, and — critically — js/export.js's
  // capture-time resize to the preset dims, which getResolvedPlacement() must
  // read fresh). Observing the OVERLAY is safe across the export reparent: it
  // lives inside #map and moves with it, and applyPlacement only writes the
  // overlay's OWN inline geometry (never #map's), so — unlike
  // js/map-viewport.js, which observes .app-map and mutates #map, needing a
  // parent-check guard — no guard is required here.
  if (!resizeObserver && typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      if (insetMap && overlay && overlay.style.display !== "none") {
        // Don't fight an in-flight box drag: the pointer is the source of
        // truth until pointerup commits.
        if (!boxDragging) applyPlacement(lastCfg);
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
    // The main basemap changed while the inset can't re-seed right now (it's
    // disabled/hidden, or not yet created). Mark the seed stale so the next
    // enable rebuilds it — otherwise a swap made while hidden would leave the
    // inset showing the OLD basemap when re-enabled.
    else styleDirty = true;
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

  return {
    update,
    getInsetMap,
    getPlacement,
    getBoundsInUse,
    getResolvedPlacement,
    refreshPlacement,
    refreshStyle,
  };
}

/**
 * Re-seed the inset's basemap from the CURRENT main-map style. Called by
 * app.js's "Hide map labels" toggle so a live inset re-syncs its label
 * visibility immediately (the toggle mutates the main map's layout visibility,
 * which buildInsetStyle re-reads via getStyle()). When the inset isn't live to
 * rebuild right now (disabled/hidden/uncreated), just marks the seed stale so
 * the next enable picks up the change — mirroring the onStyleRendered path.
 * No-op-safe before init() and when the inset was never created.
 */
export function refreshStyle() {
  if (insetMap && lastCfg && lastCfg.enabled) rebuildInsetStyle();
  else styleDirty = true;
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

  // Show + place + size FIRST so the inset map's container has real dimensions
  // when (and if) it's lazily constructed just below. Placement honors freePos
  // (custom drag position, clamped) or docks to the frame-aware corner.
  applyPlacement(c);

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

/** The docking geometry currently in effect (marginPx is the fixed 16px).
 *  heightPct falls back to sizePct so a pre-heightPct config reads as square. */
export function getPlacement() {
  return {
    corner: lastCfg?.corner || "top-right",
    sizePct: lastCfg?.sizePct || 32,
    heightPct: lastCfg?.heightPct || lastCfg?.sizePct || 32,
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
  if (insetMap) {
    // The main basemap (or its label visibility) changed while the inset was
    // hidden — re-seed from the CURRENT main style before showing again.
    if (styleDirty) rebuildInsetStyle();
    return insetMap;
  }
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

  // Pin-label overlay for the inset. interactive:true → each label div is a
  // drag target (Pointer Events, same labelDx/labelDy store path as the main
  // map), so dragging a label INSIDE the inset moves it on the main map in
  // lockstep (both overlays subscribe to the pins store). A label pointerdown
  // stopPropagation()s (js/map-labels.js), so it never starts a box drag; a
  // pointerdown on the bare inset map area falls through to the box drag
  // instead. Created once with the inset map; it lives inside the inset's
  // container (insetMapEl) so the .map-inset-overlay's overflow:hidden clips
  // labels at the box edge. It survives a basemap swap (setStyle only touches
  // WebGL layers, not this sibling DOM), so we just refresh it after re-styles
  // rather than tearing it down — see onInsetStyleData.
  insetLabels = attachLabelOverlay(insetMap, { interactive: true });

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
  // Style not snapshottable yet (main map mid-load) — stay dirty and retry on
  // the next render/enable rather than clearing the flag prematurely.
  if (!style) return;
  styleDirty = false;
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
  // The DOM label overlay isn't wiped by setStyle, but the pin set / group
  // colors may have changed while a swap was in flight — re-render it here so
  // the inset's labels match the freshly re-added pins.
  if (insetLabels) insetLabels.refresh();
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
  // Keep the inset's display-only DOM labels in step with the pins/route on
  // every pin/group re-sync (the overlay also subscribes to the stores itself,
  // but this covers the same call path the pins use so they never diverge).
  if (insetLabels) insetLabels.refresh();
}

function fitInset(bounds) {
  if (!insetMap || !bounds) return;
  insetMap.fitBounds(bounds, {
    padding: FIT_PADDING_PX,
    maxZoom: FIT_MAX_ZOOM,
    animate: false,
  });
}

// Show the overlay and position/size it from the resolved placement. Writes
// explicit px left/top/width/height (not the old corner-anchored
// top/right/bottom/left + percentage width) so a freePos drag and a corner
// dock share ONE geometry path — the exact px getResolvedPlacement() reports.
function applyPlacement(cfg) {
  if (!overlay) return;
  const { x, y, width, height } = resolvePlacement(cfg);
  overlay.style.display = "block";
  overlay.style.left = `${x}px`;
  overlay.style.top = `${y}px`;
  overlay.style.right = "";
  overlay.style.bottom = "";
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
}

/**
 * The inset box's ACTUAL top-left (x, y) + outer (border-box) width/height in
 * CSS px for the CURRENT container size, in whatever mode (docked or free).
 * Recomputed live on every call, so it stays correct after the ResizeObserver
 * fires AND after js/export.js resizes the container to a preset's dims at
 * capture time (the export follow-up multiplies this by its CSS→output scale).
 * Returns zeros defensively when there's no map/config yet.
 */
export function getResolvedPlacement() {
  return resolvePlacement(lastCfg);
}

/**
 * Re-run the dock/clamp math against the CURRENT frame + container state and
 * repaint the box. Called by app.js's frame wiring whenever a frame control
 * changes, so enabling/scrubbing a frame re-docks the corner-anchored inset
 * inside the innermost band immediately (and re-clamps a free-dragged box into
 * the new inner rect). No-op while hidden or mid-drag.
 */
export function refreshPlacement() {
  if (!overlay || overlay.style.display === "none") return;
  if (boxDragging) return;
  applyPlacement(lastCfg);
  if (insetMap) insetMap.resize();
}

// Resolve the box's outer top-left (x, y) + outer width/height, all CSS px, for
// the live container size. Width comes from sizePct, height from heightPct —
// BOTH percentages of the container WIDTH (so heightPct === sizePct is square).
// Free mode positions the box at (nx·W, ny·H) clamped into the allowed inner
// rect; docked mode pins it to `corner` with the frame-aware offset. The
// allowed rect is inset from the container edges by `offset` = 16px + the
// deepest enabled frame band (margin+thickness+padding), so a docked box sits
// INSIDE the innermost frame and a free box can never overlap it. If the box is
// LARGER than that inner rect on an axis (a big size under a deep frame), that
// axis's clamp gracefully falls back to the container bounds instead of
// producing a negative/NaN range.
function resolvePlacement(cfg) {
  const c = cfg || {};
  const container =
    mainMap && typeof mainMap.getContainer === "function"
      ? mainMap.getContainer()
      : null;
  const W = container ? container.clientWidth : 0;
  const H = container ? container.clientHeight : 0;

  const sizePct = clampSizePct(c.sizePct);
  // heightPct shares sizePct's unit — a percentage of the container WIDTH — so
  // heightPct === sizePct is a perfect square. Falls back to sizePct when
  // absent (a pre-heightPct config renders square, unchanged).
  const heightPct = clampSizePct(c.heightPct, sizePct);
  const width = (sizePct / 100) * W;
  const height = (heightPct / 100) * W;
  const offset = MARGIN_PX + maxFrameInset();

  // Allowed range for the box's outer top-left corner (box fully inside the
  // inner rect), computed per-axis against the box's own width/height. When the
  // box overflows the inner rect on an axis, fall back to clamping that axis
  // against the container so the value is always a finite, non-negative px.
  let xMin = offset;
  let xMax = W - offset - width;
  if (xMax < xMin) {
    xMin = 0;
    xMax = Math.max(0, W - width);
  }
  let yMin = offset;
  let yMax = H - offset - height;
  if (yMax < yMin) {
    yMin = 0;
    yMax = Math.max(0, H - height);
  }

  const free = normalizeFreePos(c.freePos);
  let x;
  let y;
  if (free) {
    x = clamp(free.nx * W, xMin, xMax);
    y = clamp(free.ny * H, yMin, yMax);
  } else {
    const corner =
      typeof c.corner === "string" ? c.corner : "top-right";
    x = corner.endsWith("left") ? xMin : xMax;
    y = corner.startsWith("top") ? yMin : yMax;
  }
  return { x, y, width, height };
}

// The deepest enabled frame band, in CSS px: max over ENABLED frame elements of
// (margin + thickness + padding). Read LIVE from js/map-frame.js so an applied-
// but-unsaved frame edit re-docks the inset too. 0 when no frame is enabled.
function maxFrameInset() {
  const set = getFrameSetInUse();
  const frames = Array.isArray(set && set.frames) ? set.frames : [];
  let deepest = 0;
  for (const f of frames) {
    if (!f || !f.enabled) continue;
    const inset =
      clampFrameLen(f.margin) + clampFrameLen(f.thickness) + clampFrameLen(f.padding);
    if (inset > deepest) deepest = inset;
  }
  return deepest;
}

function clampFrameLen(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(FRAME_LENGTH_MIN, Math.min(FRAME_LENGTH_MAX, Math.round(n)));
}

function clampSizePct(value, fallback = 32) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Defensive re-read of a freePos coming off lastCfg / a live drag: fractions in
// [0,1] or null. Mirrors js/storage.js's normalizeInsetFreePos so the module
// never trusts an unclamped value even if one slips in mid-drag.
function normalizeFreePos(value) {
  if (!value || typeof value !== "object") return null;
  const nx = Number(value.nx);
  const ny = Number(value.ny);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  return { nx: clamp(nx, 0, 1), ny: clamp(ny, 0, 1) };
}

// ---- Box drag ---------------------------------------------------------

function onBoxPointerDown(ev) {
  if (!mainMap || !overlay || overlay.style.display === "none") return;
  if (ev.button !== undefined && ev.button !== 0) return;
  // A drag that started on an inset label is the label's, not the box's — the
  // label handler already stopPropagation()s, so this guard is belt-and-braces.
  if (ev.target && ev.target.closest && ev.target.closest(".map-pin-labels__label")) {
    return;
  }

  ev.preventDefault();
  ev.stopPropagation();

  try {
    overlay.setPointerCapture(ev.pointerId);
  } catch (_err) {
    // Older browsers without pointer capture — listeners on `overlay` still
    // fire while the cursor is over the box.
  }
  boxDragPointerId = ev.pointerId;

  const rect = mainMap.getContainer().getBoundingClientRect();
  const { x, y } = resolvePlacement(lastCfg);
  // Offset from the box's top-left to the grab point, so the box doesn't snap
  // its corner to the cursor.
  boxDragOffsetX = ev.clientX - rect.left - x;
  boxDragOffsetY = ev.clientY - rect.top - y;

  boxDragging = true;
  overlay.classList.add("is-dragging");
  document.body.classList.add("dragging-inset");
}

function onBoxPointerMove(ev) {
  if (!boxDragging || !mainMap || ev.pointerId !== boxDragPointerId) return;

  const rect = mainMap.getContainer().getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  const desiredX = ev.clientX - rect.left - boxDragOffsetX;
  const desiredY = ev.clientY - rect.top - boxDragOffsetY;

  // Reuse resolvePlacement's free-mode clamping by feeding it a tentative
  // freePos derived from the cursor — so the box respects the exact same inner
  // rect the dock/persist paths use.
  const tentative = {
    ...(lastCfg || {}),
    freePos: { nx: W > 0 ? desiredX / W : 0, ny: H > 0 ? desiredY / H : 0 },
  };
  const { x, y, width, height } = resolvePlacement(tentative);
  overlay.style.left = `${x}px`;
  overlay.style.top = `${y}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  boxDragLast = { x, y, W, H };
}

function onBoxPointerUp(ev) {
  if (!boxDragging || ev.pointerId !== boxDragPointerId) return;

  boxDragging = false;
  boxDragPointerId = null;
  overlay.classList.remove("is-dragging");
  document.body.classList.remove("dragging-inset");
  try {
    overlay.releasePointerCapture(ev.pointerId);
  } catch (_err) {
    // no-op if capture was never taken
  }

  // Derive the persisted fractions from the CLAMPED top-left last drawn, so the
  // stored freePos round-trips cleanly (re-resolving it lands on the same px).
  const last = boxDragLast;
  boxDragLast = null;
  if (!last || last.W <= 0 || last.H <= 0) return;

  const freePos = { nx: last.x / last.W, ny: last.y / last.H };
  lastCfg = { ...(lastCfg || {}), freePos };
  // Persist directly: this module owns freePos writes. app.js's UI persist
  // preserves it (readInset reads it back via loadInset) and clears it only on
  // an explicit corner pick — so there's one writer per intent, no clobber.
  saveInset(lastCfg);
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
