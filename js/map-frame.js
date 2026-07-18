// Live WYSIWYG preview of the decorative export frame SET (PO-007, extended
// to two independently configured frames). An overlay div inside the
// MapLibre container renders the same frame(s) the export pipeline
// (js/export.js) paints onto the PNG, so toggling "Frame 1"/"Frame 2" (or
// scrubbing their px inputs) shows the result on the map itself instead of
// only after exporting.
//
// FLOATING MODEL: each frame is a coloured BAND that floats ON the map — the
// map shows through everywhere except the band itself. `margin` is the gap
// from the container edge to the band's outer edge (map shows there);
// `thickness` is the band width; `padding` is a gap just inside the band
// (also map). Only the band is opaque, so nothing here (or in export) grows
// the image or paints white over the map. This mirrors the export exactly:
// export draws each band onto the captured map at the same size, so the
// live preview and the PNG match 1:1 at current-view scale.
//
// Implementation: a DYNAMIC POOL of ring divs (class
// `map-frame-overlay__ring`), one per enabled frame element (enabled &&
// thickness>0). The pool grows lazily as needed and never shrinks — extra
// rings from a previous update are simply hidden — so repeated updates don't
// churn the DOM. Each ring is a plain border-box with only its `border`
// painted (background transparent), so the map shows through both its
// transparent centre AND the surrounding container. Radius is the band's
// OUTER corner radius; the inner corner follows from CSS's native
// border-radius/border-width interaction. Shadow is a `filter: drop-shadow`
// on that ring, which follows the band's actual painted shape (a raised
// frame casting onto the map along both edges) — set independently per
// element from that element's own `shadow` flag.
//
// Public surface:
//   init(map)      — create the overlay (idempotent) and return { update }.
//   update(frameSet) — given the normalized FRAME SET
//                      `{ frames: [frameElement, frameElement] }` (each
//                      frameElement: enabled, thickness, color, shadow,
//                      padding, margin, radius), show/hide and redraw one
//                      ring per drawable element. Coerces/clamps every field
//                      defensively so a partial or corrupt-looking object
//                      never throws. Also tolerates a bare single legacy
//                      frame object for safety.

const OVERLAY_ID = "map-frame-overlay";
const LENGTH_MIN = 0;
const LENGTH_MAX = 200;

let mapInstance = null;
let overlay = null;
// Pool of ring divs, one per drawable frame element. Grows lazily (see
// getOrCreateRing); never shrinks — unused rings are just hidden.
let ringPool = [];

/**
 * Wire the overlay to `map`. Idempotent: a second call reuses the existing
 * element rather than creating a duplicate node (mirrors js/map-title.js).
 */
export function init(map) {
  mapInstance = map;

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "map-frame-overlay";
    overlay.hidden = true;

    // Sibling of the canvas-container, like map-title.js's overlay, so it
    // paints above the tiles/markers without ever intercepting pointer
    // events (pointer-events:none is set in CSS on .map-frame-overlay).
    map.getContainer().appendChild(overlay);
  }

  return { update };
}

// Returns the ring div at `index` in the pool, creating it (and appending it
// to the overlay) the first time that index is needed. Growing lazily means
// a two-element frame set never allocates more than two rings, and a future
// larger set (unlikely per this task's fixed-two-slot contract, but the pool
// doesn't care) would grow the same way.
function getOrCreateRing(index) {
  if (!ringPool[index]) {
    const ring = document.createElement("div");
    ring.className = "map-frame-overlay__ring";
    overlay.appendChild(ring);
    ringPool[index] = ring;
  }
  return ringPool[index];
}

/**
 * Redraw the floating band(s) from the normalized FRAME SET. Every field is
 * re-coerced here (not just trusted from the caller) because app.js may
 * pass live `valueAsNumber` reads straight off the number inputs, which
 * can be NaN mid-edit (e.g. the field is briefly empty) — never let that
 * reach a CSS length and silently drop a frame. Tolerates a bare single
 * legacy frame object (not wrapped in `{ frames: [...] }`) as a defensive
 * fallback, mirroring js/export.js's wrapFrame.
 */
export function update(frameSet) {
  if (!overlay) return;

  const frames = Array.isArray(frameSet?.frames)
    ? frameSet.frames
    : frameSet
    ? [frameSet]
    : [];

  let drawnCount = 0;
  frames.forEach((f) => {
    const frameEl = f || {};
    const margin = clampLength(frameEl.margin);
    const thickness = clampLength(frameEl.thickness);
    const radius = clampLength(frameEl.radius);
    const color =
      typeof frameEl.color === "string" && frameEl.color ? frameEl.color : "#000000";
    const shadow = Boolean(frameEl.shadow);

    // Floating model: the band is the ONLY opaque part, so a frame element
    // with no band width has nothing to draw.
    if (!frameEl.enabled || thickness === 0) return;

    const ring = getOrCreateRing(drawnCount);
    ring.hidden = false;

    // Band: inset from the container edge by `margin`, `thickness` wide,
    // outer corner radius `radius` (the inner corner follows from CSS's
    // border-radius vs border-width interaction). Map shows through inside
    // and out.
    setRing(ring, { inset: margin, width: thickness, color, radius });

    // Shadow: drop-shadow follows the band's actual painted RING shape, so
    // it casts a soft shadow onto the map along both edges (the "raised
    // frame" look). Same thickness-based recipe the export uses, applied
    // independently per element.
    ring.style.filter = shadow
      ? `drop-shadow(0 ${Math.round(thickness * 0.15)}px ${Math.round(
          thickness * 0.4
        )}px rgba(0, 0, 0, 0.35))`
      : "none";

    drawnCount++;
  });

  // Hide any pool rings beyond the ones just drawn — leftovers from a
  // previous update with more drawable elements (not reachable with today's
  // fixed two-slot contract, but keeps the pool model correct in general).
  for (let i = drawnCount; i < ringPool.length; i++) {
    ringPool[i].hidden = true;
  }

  overlay.hidden = drawnCount === 0;
}

function setRing(el, { inset, width, color, radius }) {
  el.style.top = `${inset}px`;
  el.style.right = `${inset}px`;
  el.style.bottom = `${inset}px`;
  el.style.left = `${inset}px`;
  el.style.borderWidth = `${width}px`;
  el.style.borderColor = color;
  el.style.borderRadius = `${radius}px`;
}

// Missing/NaN/non-finite -> 0, else clamp to the shared 0-200 px range —
// same contract normalizeFrame in storage.js applies to thickness, reused
// here since this module can receive un-normalized live input reads too.
function clampLength(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(LENGTH_MIN, Math.min(LENGTH_MAX, Math.round(n)));
}
