// Draggable on-map title overlay (PO-008). A single positioned DOM element
// inside the MapLibre container that's re-projected from a stored lon/lat
// on every camera change, so it sticks to a city through pan/zoom and
// across basemap swaps.
//
// Drag mechanics: Pointer Events with setPointerCapture(). Unifies mouse,
// touch, and pen behind one handler — the task's "either is fine" trade-off
// in the implementation prompt. The CSS `touch-action: none` rule on the
// overlay tells the browser not to interpret a finger drag as scroll/zoom.
// Capture means pointermove / pointerup fire on the overlay regardless of
// where the cursor goes (over the side panel, off-window) so we don't need
// the document-level handlers the pin drag in map.js relies on.
//
// Public surface:
//   init(map, { onAnchorChange })   — wire the overlay to a map instance.
//                                     onAnchorChange fires whenever the
//                                     stored lon/lat changes (drag commit,
//                                     keyboard nudge, fill-from-center).
//   update({ text, lon, lat })      — replace the overlay's full state.
//                                     Empty text hides the overlay without
//                                     dropping its position; missing lon/lat
//                                     fall back to the current map center.
//   getPosition()                   — read the live { text, lon, lat }.

const OVERLAY_ID = "export-on-map-title-overlay";

let mapInstance = null;
let element = null;
let onAnchorChange = null;

let position = { text: "", lon: null, lat: null };

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
  map.on("move", reproject);

  return { update, getPosition };
}

/**
 * Replace the overlay's stored state. Empty `text` hides the overlay
 * without forgetting lon/lat — re-typing brings it back at the same place,
 * which is the contract the task spells out for the input clearing flow.
 *
 * If `lon`/`lat` are null (initial state with no anchor yet), seeds them
 * from the current map center and emits onAnchorChange so the caller can
 * persist the resolved coordinates.
 */
export function update({ text, lon, lat }) {
  position = {
    text: typeof text === "string" ? text : "",
    lon: Number.isFinite(lon) ? lon : null,
    lat: Number.isFinite(lat) ? lat : null,
  };

  if (!element || !mapInstance) return;

  if (!position.text) {
    element.hidden = true;
    element.textContent = "";
    return;
  }

  // Seed from map center on first reveal. Done lazily here (not at init)
  // so the seed reflects wherever the map is when the user starts typing,
  // not the initialMap center hard-coded at boot.
  if (position.lon === null || position.lat === null) {
    const center = mapInstance.getCenter();
    position.lon = center.lng;
    position.lat = center.lat;
    if (onAnchorChange) onAnchorChange({ ...position });
  }

  element.textContent = position.text;
  element.hidden = false;
  reproject();
}

/** Read the live { text, lon, lat }. Returns a fresh copy so callers can mutate freely. */
export function getPosition() {
  return { ...position };
}

// Re-runs on every map "move" event (pan/zoom/rotate, basemap swap re-emits
// move once tiles paint). Bails during drag so the cursor stays the source
// of truth until pointerup — see module header.
function reproject() {
  if (!element || !mapInstance) return;
  if (element.hidden) return;
  if (position.lon === null || position.lat === null) return;
  if (dragging) return;

  const pt = mapInstance.project([position.lon, position.lat]);
  applyTransform(pt.x, pt.y);
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
  if (position.lon === null || position.lat === null) return;

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

  // Where is the overlay's center right now?  Re-project from the stored
  // lon/lat; equivalent to reading the overlay's own bounding rect, but
  // doesn't depend on layout having been read this frame.
  const pt = mapInstance.project([position.lon, position.lat]);
  dragOffsetX = cursorX - pt.x;
  dragOffsetY = cursorY - pt.y;

  dragging = true;
  document.body.classList.add("dragging-on-map-title");
}

function onPointerMove(ev) {
  if (!dragging || !mapInstance || ev.pointerId !== dragPointerId) return;

  const containerRect = mapInstance.getContainer().getBoundingClientRect();
  const cursorX = ev.clientX - containerRect.left;
  const cursorY = ev.clientY - containerRect.top;

  // Pixel-based update during the drag; lon/lat is committed on release.
  // Keeping the transform pixel-driven means a fast drag never has to
  // round-trip through unproject() per frame.
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

  // Round-trip pixel → lon/lat once on commit. The next reproject (on the
  // very next move event, or now if no move ever fires) will read the
  // committed lon/lat and re-pin the overlay at the same pixel — so this
  // is a closed loop with no jitter on release.
  const lngLat = mapInstance.unproject([newCenterX, newCenterY]);
  position = { ...position, lon: lngLat.lng, lat: lngLat.lat };

  applyTransform(newCenterX, newCenterY);

  if (onAnchorChange) onAnchorChange({ ...position });
}

function onKeyDown(ev) {
  if (!mapInstance || !element || element.hidden) return;
  if (position.lon === null || position.lat === null) return;

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

  const pt = mapInstance.project([position.lon, position.lat]);
  const newX = pt.x + dx;
  const newY = pt.y + dy;
  const lngLat = mapInstance.unproject([newX, newY]);
  position = { ...position, lon: lngLat.lng, lat: lngLat.lat };
  applyTransform(newX, newY);

  if (onAnchorChange) onAnchorChange({ ...position });
}
