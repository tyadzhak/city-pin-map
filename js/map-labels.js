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
import { projectNearCenter } from "./geo-wrap.js";
import { layoutLabels } from "./label-layout.js";

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

// Must match PINS_LAYER_ID in js/map.js (not exported there).
const PINS_LAYER_ID = "city-pin-map.pins-fill";
const REVEAL_FALLBACK_MS = 4000;

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
 * events — the corner inset passes true (its labels ARE draggable — see the
 * inset-polish history in CLAUDE.md). `pinsProvider`, when given, is called
 * with no arguments to get the pin LIST this overlay should render instead of
 * every pin in the store — js/map-inset.js passes `() => pinsForInset(lastCfg)`
 * so the inset's labels stay in lockstep with its group-filtered markers/fit
 * (see that module's header for why routing every consumer through one filter
 * matters). Omitted (the default), the overlay renders every pin, same as the
 * main map's. Returns `{ refresh, destroy }`; destroy tears the overlay down
 * and unregisters it.
 */
export function attachTo(map, { interactive = false, pinsProvider } = {}) {
  if (!map) return { refresh() {}, destroy() {} };
  const overlay = createOverlay(map, { interactive, pinsProvider });
  return { refresh: overlay.render, destroy: overlay.destroy };
}

// UXR-002: pinId -> expiry timestamp of the "just added" pulse. Kept at module
// scope (not on the element) so a render() that rebuilds the DOM mid-pulse —
// any store tick — re-applies the cue instead of silently dropping it.
const PULSE_MS = 1800;
const pulses = new Map();

/** Briefly pulse a pin's label on every overlay so a new pin is easy to spot. */
export function pulsePin(pinId) {
  pulses.set(pinId, Date.now() + PULSE_MS);
  for (const overlay of overlays) overlay.render();
  setTimeout(() => {
    if ((pulses.get(pinId) ?? 0) <= Date.now()) pulses.delete(pinId);
  }, PULSE_MS + 50);
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
 *            the pin projected on the world copy nearest the map center
 *            (see js/geo-wrap.js) + the base below-pin offset + the pin's
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
 *
 * `pins` (optional) overrides the pin LIST to build labels from — omitted, it
 * defaults to every pin in the store (listPins()), the main map's behaviour.
 * js/map-inset.js's corner inset passes its group-filtered pin list here (both
 * live, via its pinsProvider-driven overlay, and from js/export.js's
 * paintInset via getInsetPins()) so the inset's labels never show a pin its
 * markers don't.
 */
export function computeLabelSpecs(map, { sizeMultiplier = 1, pins } = {}) {
  const m =
    Number.isFinite(sizeMultiplier) && sizeMultiplier > 0 ? sizeMultiplier : 1;
  const style = computeStyle();
  // Bake the multiplier into the returned size so the painter's font AND the
  // ems-derived offset below both read the scaled value from one place.
  style.sizePx *= m;
  const labels = [];
  if (!map || typeof map.project !== "function") return { style, labels };

  const labelSize = style.sizePx;
  const source = Array.isArray(pins) ? pins : listPins();
  for (const pin of source) {
    if (!pin) continue;
    if (!Number.isFinite(pin.lon) || !Number.isFinite(pin.lat)) continue;
    if (typeof pin.name !== "string" || pin.name.length === 0) continue;

    const p = projectNearCenter(map, pin.lon, pin.lat);
    const rawDx = Number.isFinite(pin.labelDx) ? pin.labelDx : 0;
    const rawDy = Number.isFinite(pin.labelDy) ? pin.labelDy : 0;
    const dx = rawDx * m;
    const dy = rawDy * m;
    labels.push({
      id: pin.id,
      text: pin.name,
      // ems x label-size collapses to a fixed px value at every zoom, exactly
      // like the old layer's `text-offset` expression, so the label keeps a
      // constant pixel gap from its pin. labelSize already carries the
      // multiplier, so the base offset scales with it.
      x: p.x + dx,
      y: p.y + PIN_LABEL_BASE_OFFSET_Y_EMS * labelSize + dy,
      // Collision-avoidance inputs (UXR-019), stripped before returning.
      _ax: p.x,
      _ay: p.y,
      _manual: rawDx !== 0 || rawDy !== 0,
      _createdAt: Number.isFinite(pin.createdAt) ? pin.createdAt : 0,
    });
  }
  applyCollisionAvoidance(labels, style, m);
  for (const l of labels) {
    delete l._ax;
    delete l._ay;
    delete l._manual;
    delete l._createdAt;
  }
  return { style, labels };
}

// UXR-019: nudge un-dragged labels off each other / off pin icons. Placement
// order is createdAt (stable), so a pin's label doesn't hop when another is
// added later. Everything scales with `m` (via the pre-multiplied sizePx and
// the icon size below) so export arranges labels exactly like the live view.
function applyCollisionAvoidance(labels, style, m) {
  if (labels.length < 2) return;
  const iconBase = Number(getPinStyle()?.size);
  const font = `${style.italic ? "italic " : ""}${style.bold ? "700" : "400"} ${style.sizePx}px ${style.fontFamily}`;
  const order = labels
    .map((l, i) => ({ l, i }))
    .sort((a, b) => a.l._createdAt - b.l._createdAt || a.i - b.i)
    .map(({ l }) => l);
  const placed = layoutLabels({
    items: order.map((l) => ({
      id: l.id,
      ax: l._ax,
      ay: l._ay,
      text: l.text,
      manual: l._manual,
      x: l.x,
      y: l.y,
    })),
    labelSize: style.sizePx,
    iconSize: (Number.isFinite(iconBase) ? iconBase : 32) * m,
    font,
    measure: measureText,
  });
  for (const l of labels) {
    const pos = placed.get(l.id);
    if (pos) {
      l.x = pos.x;
      l.y = pos.y;
    }
  }
}

let measureCtx;
function measureText(text, font) {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
    } catch (_err) {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * 0.6 * (parseFloat(font.match(/([\d.]+)px/)?.[1]) || 13);
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
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
// the interactive main map) the drag state. `pinsProvider`, when given, is
// called fresh on every render()/reposition() to get the pin LIST this
// overlay should draw labels for (js/map-inset.js's group filter); omitted,
// computeLabelSpecs falls back to every pin in the store.
function createOverlay(map, { interactive, pinsProvider }) {
  const container = document.createElement("div");
  container.className = "map-pin-labels";
  map.getContainer().appendChild(container);

  // UXR-023: stay invisible (opacity only, so layout/geometry is untouched and
  // export's computeLabelSpecs is unaffected) until the map has rendered its
  // pins layer, so names never float without their dots after a reload. The
  // timeout is a safety net so a style failure can't hide labels forever.
  let revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    map.off("render", maybeReveal);
    clearTimeout(revealTimer);
    container.classList.add("map-pin-labels--ready");
  }
  function maybeReveal() {
    // Layer presence (not isStyleLoaded/idle): those also wait on basemap
    // tiles, which can take seconds while the pin dots are already drawn.
    if (map.getLayer(PINS_LAYER_ID)) reveal();
  }
  const revealTimer = setTimeout(reveal, REVEAL_FALLBACK_MS);
  map.on("render", maybeReveal);

  // pinId -> label element, so reposition() can move existing nodes on a map
  // pan/zoom without a full teardown (cheaper than render()).
  let labelEls = new Map();

  // In-progress drag (interactive overlays only). Null when idle. While set,
  // render() bails so a store tick can't yank the element out from under an
  // active pointer capture, and reposition() leaves the dragged label under
  // cursor control.
  let dragging = null;

  function currentPins() {
    return typeof pinsProvider === "function" ? pinsProvider() : undefined;
  }

  function render() {
    if (dragging) return;
    const { style, labels } = computeLabelSpecs(map, { pins: currentPins() });
    container.innerHTML = "";
    labelEls = new Map();
    for (const label of labels) {
      const el = document.createElement("div");
      el.className = "map-pin-labels__label";
      el.textContent = label.text;
      applyStyle(el, style);
      position(el, label.x, label.y);
      if ((pulses.get(label.id) ?? 0) > Date.now()) {
        el.classList.add("map-pin-labels__label--new");
      }
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
    const { labels } = computeLabelSpecs(map, { pins: currentPins() });
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
    // Same wrapped projection as computeLabelSpecs: labelDx/labelDy are
    // offsets from THAT anchor, so the live drag must not use the raw copy.
    const p = projectNearCenter(map, pin.lon, pin.lat);
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
    map.off("render", maybeReveal);
    clearTimeout(revealTimer);
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
