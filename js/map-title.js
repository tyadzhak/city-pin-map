// Draggable on-map title overlay (PO-008). A single positioned DOM element
// inside the MapLibre container that's positioned as a FRACTION of the map
// container's current pixel size (nx/ny, frame-relative) — NOT map
// geography — so the title stays put on-screen through pan/zoom and only
// moves when the container itself is resized (e.g. an export-size preset
// letterboxing #map).
//
// Drag mechanics: Pointer Events with setPointerCapture(). Unifies mouse,
// touch, and pen behind one handler — the task's "either is fine" trade-off
// in the implementation prompt. The CSS `touch-action: none` rule on the
// overlay tells the browser not to interpret a finger drag as scroll/zoom.
// Capture means pointermove / pointerup fire on the overlay regardless of
// where the cursor goes (over the side panel, off-window) so we don't need
// the document-level handlers the pin drag in map.js relies on.
//
// PER-LINE model (this milestone): the overlay is still ONE draggable block
// anchored at (nx, ny), but its content is now a STACK of independently
// styled lines rather than a single text run — see js/storage.js's
// normalizeOnMapTitle / normalizeTitleLine for the shape. Each line gets its
// own child element with its own inline font/weight/style/color/size, so two
// lines can look completely different (e.g. a bold serif headline over a
// small sans-serif subtitle) while still dragging as one unit.
//
// Public surface:
//   init(map, { onAnchorChange })   — wire the overlay to a map instance.
//                                     onAnchorChange fires whenever the
//                                     stored nx/ny changes (drag commit,
//                                     keyboard nudge, recenterX()).
//   update({ nx, ny, lines })       — replace the overlay's full state.
//                                     Omitting `lines` keeps the current
//                                     lines; the overlay hides whenever no
//                                     line has non-empty text. nx/ny default
//                                     to bottom-center (0.5, 0.85) when
//                                     absent.
//   getPosition()                   — read the live { nx, ny, lines }.
//   recenterX()                     — set nx back to 0.5 (horizontal
//                                     re-center only; ny is untouched) and
//                                     persist via onAnchorChange. Used when
//                                     the export-size preset changes.

import { normalizeTitleLine } from "./storage.js";

const OVERLAY_ID = "export-on-map-title-overlay";

let mapInstance = null;
let element = null;
let onAnchorChange = null;

// Full overlay state. Normalized frame-relative anchor (nx/ny, each in
// [0,1]) drives the transform whenever the map container is RESIZED;
// `lines` is an ordered array of { text, font, bold, italic, color, size }
// rendered top-to-bottom, each with its own formatting.
let position = {
  nx: 0.5,
  ny: 0.85,
  lines: [],
};

// Drag state. Set on pointerdown, cleared on pointerup. The pixel offset
// captures where the cursor grabbed relative to the overlay's center, so a
// drag that picks up the corner doesn't snap the corner to the cursor.
let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragPointerId = null;

/**
 * Wire the overlay to `map`. Idempotent: a second call rewires the existing
 * element to the new callback rather than creating a duplicate node.
 */
export function init(map, opts = {}) {
  mapInstance = map;
  onAnchorChange = opts.onAnchorChange ?? null;

  if (!element) {
    element = document.createElement("div");
    element.id = OVERLAY_ID;
    element.className = "export-on-map-title";
    element.tabIndex = 0;
    element.setAttribute("role", "textbox");
    element.setAttribute(
      "aria-label",
      "On-map title overlay; arrow keys to nudge, drag to reposition"
    );
    element.hidden = true;

    // Inside the map container so the overlay's transform-origin tracks the
    // map's; siblings of the canvas-container, NOT children of it, so a
    // pointerdown on us never bubbles into MapLibre's pan handlers.
    map.getContainer().appendChild(element);

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("keydown", onKeyDown);
  }

  // Subscribe once. MapLibre's listener registry is keyed by reference so a
  // second subscribe with the same handler would double-fire; the init
  // idempotence above ensures we only get here on first call.
  //
  // Deliberately "resize", NOT "move" — the anchor is frame-relative, not
  // geographic, so panning/zooming the map must NOT move the title.
  // map.resize() (called by js/map-viewport.js's letterbox and by MapLibre
  // itself on container size changes) fires "resize", which is exactly
  // when a normalized fraction needs to be re-applied against the new
  // pixel dimensions.
  map.on("resize", reproject);

  return { update, getPosition, recenterX };
}

/**
 * Replace the overlay's stored state. Merges over existing fields so a
 * partial caller (e.g. "just move the anchor") doesn't have to know about
 * every field: `nx`/`ny` fall back to the current value when absent, and
 * `lines` is kept as-is when not provided (defensively re-normalized via
 * normalizeTitleLine when it IS provided, so a hand-built array from the
 * editor UI can never poison the overlay).
 *
 * The overlay hides whenever no line has non-empty text — re-typing brings
 * it back at the same place with the same per-line look, which is the
 * contract the previous single-string version had.
 */
export function update(next) {
  const lines = Array.isArray(next.lines)
    ? next.lines.map(normalizeTitleLine)
    : position.lines;

  position = {
    nx: Number.isFinite(next.nx) ? clamp01(next.nx) : position.nx,
    ny: Number.isFinite(next.ny) ? clamp01(next.ny) : position.ny,
    lines,
  };

  if (!element || !mapInstance) return;

  renderLines();

  if (!hasRenderableText(position.lines)) {
    element.hidden = true;
    return;
  }

  element.hidden = false;
  reproject();
}

function hasRenderableText(lines) {
  return lines.some((line) => typeof line.text === "string" && line.text.length > 0);
}

// Rebuilds the overlay's child elements — one per line, each carrying its
// own inline formatting — from the current `position.lines`. Cheap full
// teardown/rebuild rather than a diff: line counts stay in the single
// digits, so there's no perf case for anything fancier.
function renderLines() {
  if (!element) return;
  element.innerHTML = "";
  position.lines.forEach((line) => {
    const lineEl = document.createElement("div");
    lineEl.className = "export-on-map-title__line";
    lineEl.textContent = line.text;
    lineEl.style.fontFamily = line.font;
    lineEl.style.fontWeight = line.bold ? "700" : "400";
    lineEl.style.fontStyle = line.italic ? "italic" : "normal";
    lineEl.style.color = line.color;
    lineEl.style.fontSize = `${line.size}px`;
    element.appendChild(lineEl);
  });
}

/**
 * Re-center the title BLOCK horizontally (nx = 0.5), leaving ny untouched.
 * Used when the export-size preset changes so the title doesn't end up
 * off-center against the newly letterboxed crop. Fires onAnchorChange so
 * the new anchor persists, even if the overlay is currently hidden (an
 * empty title should still remember to reappear centered).
 */
export function recenterX() {
  position = { ...position, nx: 0.5 };
  reproject();
  if (onAnchorChange) onAnchorChange(getPosition());
}

/** Read the live { nx, ny, lines }. Returns a fresh copy so callers can mutate freely. */
export function getPosition() {
  return { nx: position.nx, ny: position.ny, lines: position.lines.map((l) => ({ ...l })) };
}

// Clamp a fraction into [0, 1] — shared by every path that derives nx/ny
// from a pixel position (drag commit, keyboard nudge).
function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

// Re-runs on every map "resize" event (container size change — e.g.
// js/map-viewport.js's export-preset letterbox, or a window resize).
// Deliberately NOT on "move": the anchor is a frame-relative fraction, so
// panning/zooming the map must never move the title. Bails during drag so
// the cursor stays the source of truth until pointerup — see module header.
function reproject() {
  if (!element || !mapInstance) return;
  if (element.hidden) return;
  if (dragging) return;

  const c = mapInstance.getContainer();
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (w <= 0 || h <= 0) return;

  applyTransform(position.nx * w, position.ny * h);
}

// Two-step transform: outer translate3d positions the overlay's top-left
// corner at the projected pixel; inner translate(-50%, -50%) shifts the
// overlay so its CENTER lines up with the projection. Splitting the two
// keeps the math at the call site about pixel coords only — text width
// changes don't need to feed back into the position calc.
function applyTransform(x, y) {
  element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
}

function onPointerDown(ev) {
  if (!mapInstance || !element || element.hidden) return;
  // Left button only on mouse; pen and touch report button=0 too.
  if (ev.button !== undefined && ev.button !== 0) return;

  ev.preventDefault();
  ev.stopPropagation();

  // Capture so pointermove/pointerup fire on the overlay even when the
  // cursor strays off the element (or off-window entirely).
  try {
    element.setPointerCapture(ev.pointerId);
  } catch (_err) {
    // Older browsers without pointer capture — drag still works because
    // the listeners on `element` will fire as long as the cursor is over it.
  }
  dragPointerId = ev.pointerId;

  const containerRect = mapInstance.getContainer().getBoundingClientRect();
  const cursorX = ev.clientX - containerRect.left;
  const cursorY = ev.clientY - containerRect.top;

  // Where is the overlay's center right now?  Derived from the stored
  // nx/ny fraction against the current container size; equivalent to
  // reading the overlay's own bounding rect, but doesn't depend on layout
  // having been read this frame.
  const w = containerRect.width;
  const h = containerRect.height;
  const centerX = position.nx * w;
  const centerY = position.ny * h;
  dragOffsetX = cursorX - centerX;
  dragOffsetY = cursorY - centerY;

  dragging = true;
  document.body.classList.add("dragging-on-map-title");
}

function onPointerMove(ev) {
  if (!dragging || !mapInstance || ev.pointerId !== dragPointerId) return;

  const containerRect = mapInstance.getContainer().getBoundingClientRect();
  const cursorX = ev.clientX - containerRect.left;
  const cursorY = ev.clientY - containerRect.top;

  // Pixel-based update during the drag; nx/ny is committed on release.
  // Keeping the transform pixel-driven means a fast drag never has to
  // round-trip through the normalized fraction per frame.
  applyTransform(cursorX - dragOffsetX, cursorY - dragOffsetY);
}

function onPointerUp(ev) {
  if (!dragging || !mapInstance || ev.pointerId !== dragPointerId) return;

  dragging = false;
  dragPointerId = null;
  document.body.classList.remove("dragging-on-map-title");

  const containerRect = mapInstance.getContainer().getBoundingClientRect();
  const cursorX = ev.clientX - containerRect.left;
  const cursorY = ev.clientY - containerRect.top;
  const newCenterX = cursorX - dragOffsetX;
  const newCenterY = cursorY - dragOffsetY;

  // Round-trip pixel → normalized fraction once on commit. The next
  // reproject (on the next "resize" event, or now if the element is
  // re-shown) will read the committed nx/ny and re-pin the overlay at the
  // same pixel — so this is a closed loop with no jitter on release.
  const w = containerRect.width;
  const h = containerRect.height;
  position = {
    ...position,
    nx: w > 0 ? clamp01(newCenterX / w) : position.nx,
    ny: h > 0 ? clamp01(newCenterY / h) : position.ny,
  };

  applyTransform(newCenterX, newCenterY);

  if (onAnchorChange) onAnchorChange(getPosition());
}

function onKeyDown(ev) {
  if (!mapInstance || !element || element.hidden) return;

  // 1 px per arrow press, 10 with shift — the task's literal spec. Any
  // other key passes through so Tab/Enter/etc. behave normally.
  const step = ev.shiftKey ? 10 : 1;
  let dx = 0;
  let dy = 0;
  switch (ev.key) {
    case "ArrowUp":
      dy = -step;
      break;
    case "ArrowDown":
      dy = step;
      break;
    case "ArrowLeft":
      dx = -step;
      break;
    case "ArrowRight":
      dx = step;
      break;
    default:
      return;
  }
  ev.preventDefault();

  const c = mapInstance.getContainer();
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (w <= 0 || h <= 0) return;

  const newX = position.nx * w + dx;
  const newY = position.ny * h + dy;
  position = {
    ...position,
    nx: clamp01(newX / w),
    ny: clamp01(newY / h),
  };
  applyTransform(newX, newY);

  if (onAnchorChange) onAnchorChange(getPosition());
}
