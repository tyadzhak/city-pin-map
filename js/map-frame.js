// Live WYSIWYG preview of the decorative export frame (PO-007, extended).
// An overlay div inside the MapLibre container renders the same frame the
// export pipeline (js/export.js) paints onto the PNG, so toggling "Frame"
// (or scrubbing its px inputs) shows the result on the map itself instead
// of only after exporting.
//
// FLOATING MODEL: the frame is a coloured BAND that floats ON the map — the
// map shows through everywhere except the band itself. `margin` is the gap
// from the container edge to the band's outer edge (map shows there);
// `thickness` is the band width; `padding` is a gap just inside the band
// (also map). Only the band is opaque, so nothing here (or in export) grows
// the image or paints white over the map. This mirrors the export exactly:
// export draws the band onto the captured map at the same size, so the live
// preview and the PNG match 1:1 at current-view scale.
//
// Implementation: the band is a single ring div — a plain border-box with
// only its `border` painted (background transparent), so the map shows
// through both its transparent centre AND the surrounding container. Radius
// is the band's OUTER corner radius; the inner corner follows from CSS's
// native border-radius/border-width interaction. The two other ring divs
// (marginRing/matRing) are legacy from the earlier mat model and paint
// nothing now — kept only for DOM stability. Shadow is a `filter:
// drop-shadow` on the band ring, which follows the band's actual painted
// shape (a raised frame casting onto the map along both edges).
//
// Public surface:
//   init(map)          — create the overlay (idempotent) and return { update }.
//   update(frame)       — given the normalized FRAME OBJECT (enabled, thickness,
//                         color, shadow, padding, margin, radius), show/hide and
//                         redraw the band. Coerces/clamps defensively so a
//                         partial or corrupt-looking object never throws.

const OVERLAY_ID = "map-frame-overlay";
const LENGTH_MIN = 0;
const LENGTH_MAX = 200;

let mapInstance = null;
let overlay = null;
let marginRing = null;
let bandRing = null;
let matRing = null;
// Transparent element sitting exactly over the map window; carries the drop
// shadow (when enabled) so the preview reflects frame.shadow too — a border
// ring can't cast a shadow onto the mat the way export.js's stand-in does.
let shadowWindow = null;

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

    marginRing = document.createElement("div");
    marginRing.className = "map-frame-overlay__ring";
    bandRing = document.createElement("div");
    bandRing.className = "map-frame-overlay__ring";
    matRing = document.createElement("div");
    matRing.className = "map-frame-overlay__ring";
    shadowWindow = document.createElement("div");
    shadowWindow.className = "map-frame-overlay__window";
    overlay.appendChild(marginRing);
    overlay.appendChild(bandRing);
    overlay.appendChild(matRing);
    // Last child so its drop shadow paints over the mat ring, matching the
    // export where the shadow lands on the mat.
    overlay.appendChild(shadowWindow);

    // Sibling of the canvas-container, like map-title.js's overlay, so it
    // paints above the tiles/markers without ever intercepting pointer
    // events (pointer-events:none is set in CSS on .map-frame-overlay).
    map.getContainer().appendChild(overlay);
  }

  return { update };
}

/**
 * Redraw the floating band from the normalized FRAME OBJECT. Every field is
 * re-coerced here (not just trusted from the caller) because app.js may
 * pass live `valueAsNumber` reads straight off the number inputs, which
 * can be NaN mid-edit (e.g. the field is briefly empty) — never let that
 * reach a CSS length and silently drop the frame.
 */
export function update(frame) {
  if (!overlay || !marginRing || !bandRing || !matRing || !shadowWindow) return;

  const f = frame || {};
  const margin = clampLength(f.margin);
  const thickness = clampLength(f.thickness);
  const radius = clampLength(f.radius);
  const color = typeof f.color === "string" && f.color ? f.color : "#000000";
  const shadow = Boolean(f.shadow);

  // Floating model: the band is the ONLY opaque part, so a frame with no band
  // width has nothing to draw — the map already fills the container.
  if (!f.enabled || thickness === 0) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;

  // The margin (outside the band) and padding (inside the band) gaps are just
  // map, so these two legacy rings paint nothing now — keep them out of the
  // way. Only the band ring is coloured.
  marginRing.style.borderWidth = "0px";
  matRing.style.borderWidth = "0px";
  shadowWindow.style.boxShadow = "none";

  // Band: inset from the container edge by `margin`, `thickness` wide, outer
  // corner radius `radius` (the inner corner follows from CSS's border-radius
  // vs border-width interaction). Map shows through inside and out.
  setRing(bandRing, { inset: margin, width: thickness, color, radius });

  // Shadow: drop-shadow follows the band's actual painted RING shape, so it
  // casts a soft shadow onto the map along both edges (the "raised frame"
  // look). Same thickness-based recipe the export uses.
  bandRing.style.filter = shadow
    ? `drop-shadow(0 ${Math.round(thickness * 0.15)}px ${Math.round(
        thickness * 0.4
      )}px rgba(0, 0, 0, 0.35))`
    : "none";
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
