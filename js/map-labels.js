// DOM pin-label overlay. Pin labels used to be a MapLibre `symbol` layer
// (PINS_LABELS_LAYER_ID in js/map.js), which meant `text-font` could only
// reference the glyph stacks the active basemap served — so the only safe
// fonts were the Noto Sans Regular/Bold pair, and an arbitrary family would
// 404 the glyph fetch and blank the whole symbol bucket (pins included).
//
// This module moves labels OUT of WebGL into a DOM overlay — exactly like the
// on-map title (js/map-title.js) — so a label can use any system font family,
// italic, bold, color, and size with no glyph-endpoint dependency. Geometry is
// reproduced 1:1 from the old layer: the label's top-center sits
// PIN_LABEL_BASE_OFFSET_Y_EMS (1.0) ems of the configured label size below the
// pin's anchor point, plus the pin's per-pin `labelDx`/`labelDy` screen-px drag
// offset. The white halo (text-shadow) mirrors the removed layer's
// text-halo-color/-width/-blur so the migration is a near-visual-no-op.
//
// Two overlay flavors share one implementation:
//   - init(mainMap)                      — the MAIN map's overlay. Interactive:
//                                          labels are draggable (Pointer Events
//                                          + setPointerCapture, same px
//                                          semantics as the old layer's drag).
//   - attachTo(insetMap,{interactive:true}) — the corner inset's overlay
//                                          (js/map-inset.js). Also interactive:
//                                          a label dragged inside the inset
//                                          updates the same per-pin labelDx/
//                                          labelDy, so the main map's label
//                                          moves in lockstep.
//
// computeLabelSpecs(map[, {sizeMultiplier}]) is the SINGLE source of truth for
// label geometry + style — used by the live overlays here AND by js/export.js's
// paintPinLabels() so the exported PNG matches the screen exactly. It reads the
// pin store, the global pin style (js/map.js's live currentPinStyle via
// getPinStyle), and the target map's own projection. The optional
// sizeMultiplier reproduces the old PO-006 preset-capture size bump (see the
// function's own doc); it affects ONLY the returned specs, never the DOM.
//
// STACKING: the overlay container sits at CSS z-index 2 — above the map canvas
// (pins), below the bottom fade (3), corner inset (4), frame (5), and on-map
// title (6). Keeping labels UNDER the fade reproduces the old WebGL labels'
// behaviour (they were part of the canvas, which the fade overlay painted over)
// so a bottom fade dissolves the labels exactly as before. js/export.js's
// compositing order mirrors this: map → pin labels → fade → inset → title →
// frame-wrap. See the `.map-pin-labels` block in css/styles.css.

import { listPins, subscribe as subscribePins, updatePin } from "./pins.js";
import { subscribe as subscribeGroups } from "./groups.js";
import { getPinStyle } from "./map.js";

// Baseline vertical offset (ems of the configured label size) anchoring a
// label just below its pin — carried over verbatim from js/map.js's
// PIN_LABEL_BASE_OFFSET_Y_EMS so the DOM placement matches the old WebGL one.
const PIN_LABEL_BASE_OFFSET_Y_EMS = 1.0;

// White halo, mirroring the removed pins-labels layer's paint
// (text-halo-color #ffffff, text-halo-width 1.5, text-halo-blur 0.5). Rendered
// as a text-shadow outline in the live overlay.
const HALO_COLOR = "#ffffff";
const HALO_WIDTH_PX = 1.5;
const HALO_BLUR_PX = 0.5;

// Default font stack when the pin style's labelFont is empty. Chosen to sit
// visually closest to the old WebGL Noto Sans glyphs so the migration reads as
// a near-no-op until the user picks a family.
const DEFAULT_LABEL_FONT_STACK =
  '"Noto Sans", "Helvetica Neue", Arial, sans-serif';

// Every attached overlay (main + inset), so refreshAllLabelLayers() can fan a
// pin-style edit out to all of them at once. Overlay objects expose
// { render, reposition, destroy }.
const overlays = new Set();

// The main map's overlay handle, kept for init() idempotence.
let mainOverlay = null;

/**
 * Wire the main map's (interactive) label overlay. Idempotent: a second call
 * returns the existing handle rather than creating a duplicate overlay.
 * Returns `{ refresh }` — refresh re-reads pins/groups/pin-style and
 * re-renders.
 */
export function init(mainMap) {
  if (!mainMap) return { refresh() {} };
  if (mainOverlay) return { refresh: mainOverlay.render };
  mainOverlay = createOverlay(mainMap, { interactive: true });
  return { refresh: mainOverlay.render };
}

/**
 * Attach an additional label overlay to `map` (used by js/map-inset.js for the
 * corner inset). `interactive` controls whether labels accept drag/pointer
 * events — the inset passes false so its labels are display-only. Returns
 * `{ refresh, destroy }`; destroy tears the overlay down and unregisters it.
 */
export function attachTo(map, { interactive = false } = {}) {
  if (!map) return { refresh() {}, destroy() {} };
  const overlay = createOverlay(map, { interactive });
  return { refresh: overlay.render, destroy: overlay.destroy };
}

/**
 * Refresh every attached overlay (main + inset). js/map.js's setPinStyle()
 * calls this so a live Design-tab pin-style edit (label size/color/bold/font)
 * updates the DOM labels instantly, without waiting for a pin-store change.
 */
export function refreshAllLabelLayers() {
  for (const overlay of overlays) overlay.render();
}

/**
 * SINGLE source of truth for label geometry + style on `map`. Used by the live
 * overlays here and by js/export.js's label painting so the exported PNG
 * matches the screen exactly.
 *
 * Returns `{ style, labels }`:
 *   style  — { fontFamily, sizePx, color, bold, italic, halo:{color, blurPx} }
 *   labels — [{ id, text, x, y }] where x/y are CSS px in `map`'s viewport:
 *            map.project([lon,lat]) + the base below-pin offset + the pin's
 *            labelDx/labelDy. x is the label's horizontal CENTER, y its TOP
 *            edge (the old layer used text-anchor:top with a centered
 *            justification — the overlay applies translate(-50%,0) to match).
 *
 * `id` is an extra field beyond the {text,x,y} the export contract names — the
 * live overlay needs it to key drag interactions to a pin; a painter can ignore
 * it.
 *
 * `sizeMultiplier` (default 1) reproduces the old PO-006 export behaviour: for a
 * preset PNG capture js/export.js used to bump the WebGL label `text-size` by
 * the typography `coeff`, which — because the offset was an ems expression of
 * that size — proportionally scaled the label's distance from its pin too. With
 * labels now a DOM/canvas concern that WebGL bump is gone, so export passes the
 * `coeff` here instead: it multiplies the returned `style.sizePx`, the base
 * below-pin offset, AND the per-pin labelDx/labelDy, so both the font and the
 * whole offset-from-anchor grow together exactly as before. The pin ANCHOR
 * (map.project) is never multiplied — only the offset off it. Default 1 leaves
 * the live overlays' geometry untouched.
 */
export function computeLabelSpecs(map, { sizeMultiplier = 1 } = {}) {
  const m =
    Number.isFinite(sizeMultiplier) && sizeMultiplier > 0 ? sizeMultiplier : 1;
  const style = computeStyle();
  // Bake the multiplier into the returned size so the painter's font AND the
  // ems-derived offset below both read the scaled value from one place.
  style.sizePx *= m;
  const labels = [];
  if (!map || typeof map.project !== "function") return { style, labels };

  const labelSize = style.sizePx;
  for (const pin of listPins()) {
    if (!pin) continue;
    if (!Number.isFinite(pin.lon) || !Number.isFinite(pin.lat)) continue;
    if (typeof pin.name !== "string" || pin.name.length === 0) continue;

    const p = map.project([pin.lon, pin.lat]);
    const dx = (Number.isFinite(pin.labelDx) ? pin.labelDx : 0) * m;
    const dy = (Number.isFinite(pin.labelDy) ? pin.labelDy : 0) * m;
    labels.push({
      id: pin.id,
      text: pin.name,
      // ems × label-size collapses to a fixed px value at every zoom, exactly
      // like the old layer's `text-offset` expression, so the label keeps a
      // constant pixel gap from its pin. labelSize already carries the
      // multiplier, so the base offset scales with it.
      x: p.x + dx,
      y: p.y + PIN_LABEL_BASE_OFFSET_Y_EMS * labelSize + dy,
    });
  }
  return { style, labels };
}

// Reads the global pin style (js/map.js's live currentPinStyle) into the
// label spec's style block. labelFont/labelItalic are read defensively — the
// current normalize doesn't emit labelItalic yet (a follow-up adds it), and an
// empty labelFont falls back to the default stack.
function computeStyle() {
  const ps = getPinStyle() || {};
  const font =
    typeof ps.labelFont === "string" && ps.labelFont.trim()
      ? ps.labelFont
      : DEFAULT_LABEL_FONT_STACK;
  const sizeNum = Number(ps.labelSize);
  return {
    fontFamily: font,
    sizePx: Number.isFinite(sizeNum) ? sizeNum : 13,
    color: typeof ps.labelColor === "string" ? ps.labelColor : "#1f2937",
    bold: ps.labelBold === true,
    italic: ps.labelItalic === true,
    halo: { color: HALO_COLOR, blurPx: HALO_WIDTH_PX },
  };
}

// One overlay instance bound to one map. Owns its container div, its child
// label divs, the map move/resize listeners, the store subscriptions, and (for
// the interactive main map) the drag state.
function createOverlay(map, { interactive }) {
  const container = document.createElement("div");
  container.className = "map-pin-labels";
  map.getContainer().appendChild(container);

  // pinId -> label element, so reposition() can move existing nodes on a map
  // pan/zoom without a full teardown (cheaper than render()).
  let labelEls = new Map();

  // In-progress drag (interactive overlays only). Null when idle. While set,
  // render() bails so a store tick can't yank the element out from under an
  // active pointer capture, and reposition() leaves the dragged label under
  // cursor control.
  let dragging = null;

  function render() {
    if (dragging) return;
    const { style, labels } = computeLabelSpecs(map);
    container.innerHTML = "";
    labelEls = new Map();
    for (const label of labels) {
      const el = document.createElement("div");
      el.className = "map-pin-labels__label";
      el.textContent = label.text;
      applyStyle(el, style);
      position(el, label.x, label.y);
      if (interactive) {
        el.dataset.pinId = label.id;
        el.style.pointerEvents = "auto";
        el.addEventListener("pointerdown", (ev) => onPointerDown(ev, label.id, el));
      }
      container.appendChild(el);
      labelEls.set(label.id, el);
    }
  }

  // Cheap position-only pass for map pan/zoom: recompute projected coords but
  // reuse the existing nodes. If the pin set changed since the last render()
  // (labelEls out of sync), the missing-node guard just skips — the store
  // subscription's render() will have already rebuilt in that case.
  function reposition() {
    const { labels } = computeLabelSpecs(map);
    for (const label of labels) {
      if (dragging && dragging.pinId === label.id) continue;
      const el = labelEls.get(label.id);
      if (el) position(el, label.x, label.y);
    }
  }

  function onPointerDown(ev, pinId, el) {
    // Left button only (pen/touch report button 0 too). Stop propagation so
    // the pointerdown never reaches the map canvas and starts a pan — same
    // guard js/map-title.js uses for the title overlay.
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    try {
      el.setPointerCapture(ev.pointerId);
    } catch (_err) {
      // Older browsers without pointer capture — the listeners on `el` below
      // still fire while the cursor is over it.
    }

    const pin = listPins().find((p) => p.id === pinId);
    const startDx = pin && Number.isFinite(pin.labelDx) ? pin.labelDx : 0;
    const startDy = pin && Number.isFinite(pin.labelDy) ? pin.labelDy : 0;
    dragging = {
      pinId,
      el,
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startDx,
      startDy,
      lastDx: startDx,
      lastDy: startDy,
    };

    document.body.classList.add("dragging-pin");
    el.style.cursor = "grabbing";
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(ev) {
    if (!dragging || ev.pointerId !== dragging.pointerId) return;
    // Constant-offset drag: the label moves by exactly the pointer's screen
    // delta from pointerdown, added on top of the offset it already had —
    // identical px semantics to the old WebGL label drag (js/map.js onDocMove).
    const dx = dragging.startDx + (ev.clientX - dragging.startClientX);
    const dy = dragging.startDy + (ev.clientY - dragging.startClientY);
    dragging.lastDx = dx;
    dragging.lastDy = dy;

    const pin = listPins().find((p) => p.id === dragging.pinId);
    if (!pin) return;
    const size = computeStyle().sizePx;
    const p = map.project([pin.lon, pin.lat]);
    position(dragging.el, p.x + dx, p.y + PIN_LABEL_BASE_OFFSET_Y_EMS * size + dy);
  }

  function onPointerUp(ev) {
    if (!dragging || ev.pointerId !== dragging.pointerId) return;
    const { pinId, el, lastDx, lastDy } = dragging;

    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    try {
      el.releasePointerCapture(ev.pointerId);
    } catch (_err) {
      // no-op if capture was never taken
    }
    el.style.cursor = "";
    document.body.classList.remove("dragging-pin");
    dragging = null;

    // Commit through the pin store so persistence + the pin list stay in sync.
    // The resulting notify() → render() repaints this label at the same offset
    // we just drew, so it's effectively a no-op reposition.
    updatePin(pinId, { labelDx: lastDx, labelDy: lastDy });
  }

  function destroy() {
    map.off("move", reposition);
    map.off("resize", reposition);
    unsubPins();
    unsubGroups();
    if (container.parentNode) container.parentNode.removeChild(container);
    overlays.delete(overlay);
  }

  // Reposition on pan/zoom (move) and container resize; re-render on any pin or
  // group store change (add/remove/rename/drag-commit; groups can change the
  // pin set the overlay should reflect). Tens of pins — no virtualization.
  map.on("move", reposition);
  map.on("resize", reposition);
  const unsubPins = subscribePins(render);
  const unsubGroups = subscribeGroups(render);

  const overlay = { render, reposition, destroy };
  overlays.add(overlay);
  render();
  return overlay;
}

function applyStyle(el, style) {
  el.style.fontFamily = style.fontFamily;
  el.style.fontSize = `${style.sizePx}px`;
  el.style.color = style.color;
  el.style.fontWeight = style.bold ? "700" : "400";
  el.style.fontStyle = style.italic ? "italic" : "normal";
  el.style.textShadow = haloTextShadow(style.halo);
}

// White outline via a ring of offset text-shadows at the halo width, each
// softened by HALO_BLUR_PX — approximates the removed layer's SDF text-halo
// (width 1.5, blur 0.5) closely enough to read as the same treatment.
function haloTextShadow(halo) {
  const c = halo.color;
  const w = halo.blurPx; // halo WIDTH carried in the spec's blurPx field
  const b = HALO_BLUR_PX;
  return [
    `${-w}px ${-w}px ${b}px ${c}`,
    `${w}px ${-w}px ${b}px ${c}`,
    `${-w}px ${w}px ${b}px ${c}`,
    `${w}px ${w}px ${b}px ${c}`,
    `${-w}px 0 ${b}px ${c}`,
    `${w}px 0 ${b}px ${c}`,
    `0 ${-w}px ${b}px ${c}`,
    `0 ${w}px ${b}px ${c}`,
  ].join(", ");
}

// translate3d positions the label's top-left at the projected pixel;
// translate(-50%,0) then shifts it so the top-CENTER lands there — matching the
// old layer's text-anchor:top + centered justification.
function position(el, x, y) {
  el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, 0)`;
}
