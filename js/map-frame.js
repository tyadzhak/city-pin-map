// Live WYSIWYG preview of the decorative export frame (PO-007, extended).
// A single overlay div inside the MapLibre container renders the same
// margin / band / padding-mat geometry the export pipeline (js/export.js)
// bakes into the PNG, so toggling "Frame" (or scrubbing its px inputs)
// shows the result on the map itself instead of only after exporting.
//
// WYSIWYG NOTE: the export pipeline ADDS the frame OUTSIDE the captured
// map pixels — the output PNG is (map size) + (2 * total frame depth)
// bigger than the map. This overlay, on the other hand, is drawn ON TOP
// of the live map's outermost pixels (inset from the container edges,
// which never resize to make room). So the export always shows a sliver
// more of the map than this preview does at the same zoom/pan. That's an
// accepted, standard preview approximation, not a bug — matching it
// exactly would require shrinking the map's own canvas, which would
// change the view the user is composing.
//
// Geometry (outside in): margin (white) -> thickness (frame color) ->
// padding (white mat) -> map. Implemented as three sibling ring divs, each
// a plain box with background:transparent and only its `border` painted
// (border-box sizing), stacked at increasing insets so later siblings
// paint over earlier ones. Because every ring's own content-box is
// transparent, the very center is never painted by any of the three
// divs — the actual map canvas (an earlier sibling in the DOM) shows
// through natively, no clip-path or z-index tricks needed.
//
// Radius is the BAND's outer corner radius (matches export.js's contract).
// Every ring is rounded concentrically so each ring's INNER corner (outer
// radius − its border-width) equals the next ring's OUTER radius — the same
// concentric-radius math CSS's native border-radius/border-width interaction
// does for a single ring, applied by hand across the three divs. That leaves
// no gap between rings; the ONLY corner where the map still shows through is
// the extreme outer one (the margin ring's outer radius is radius + margin,
// but the container corner is square), which is the same outer-sliver
// difference disclaimed above — the export fills that corner white instead.
//
// Public surface:
//   init(map)          — create the overlay (idempotent) and return { update }.
//   update(frame)       — given the normalized FRAME OBJECT (enabled, thickness,
//                         color, shadow, padding, margin, radius), show/hide and
//                         redraw the three rings. Coerces/clamps defensively so
//                         a partial or corrupt-looking object never throws.

const OVERLAY_ID = "map-frame-overlay";
const WHITE = "#ffffff";
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
 * Redraw the three rings from the normalized FRAME OBJECT. Every field is
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
  const padding = clampLength(f.padding);
  const radius = clampLength(f.radius);
  const color = typeof f.color === "string" && f.color ? f.color : "#000000";
  const shadow = Boolean(f.shadow);

  if (!f.enabled || (margin === 0 && thickness === 0 && padding === 0)) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;

  // Concentric radii: the band's outer radius is exactly `radius`; each
  // ring further in is reduced by the ring(s) outside it, floored at 0 so
  // a thick band/mat on a small radius never goes negative.
  const bandRadius = radius;
  const matRadius = Math.max(0, radius - thickness);
  const mapRadius = Math.max(0, radius - thickness - padding);
  const mapInset = margin + thickness + padding;

  // The margin ring is rounded concentrically (outer = radius + margin, so
  // its INNER corner = outer − border-width = radius) so it meets the band's
  // rounded outer corner with no gap. Without this the map bleeds through a
  // triangular notch between the square margin ring and the rounded band —
  // the export fills that white. Only the extreme OUTER corner now rounds,
  // which is the outer-sliver difference already disclaimed in the header.
  // When radius is 0 every ring is square and there is nothing to round.
  setRing(marginRing, {
    inset: 0,
    width: margin,
    color: WHITE,
    radius: radius > 0 ? radius + margin : 0,
  });
  setRing(bandRing, { inset: margin, width: thickness, color, radius: bandRadius });
  setRing(matRing, {
    inset: margin + thickness,
    width: padding,
    color: WHITE,
    radius: matRadius,
  });

  // Shadow window: transparent box over the map, casting the SAME soft drop
  // shadow onto the mat that export.js bakes in (thickness-based recipe:
  // blur = thickness*0.4, offsetY = thickness*0.15). Zero-thickness frames
  // have no shadow in export either, so gate on thickness > 0.
  shadowWindow.style.top = `${mapInset}px`;
  shadowWindow.style.right = `${mapInset}px`;
  shadowWindow.style.bottom = `${mapInset}px`;
  shadowWindow.style.left = `${mapInset}px`;
  shadowWindow.style.borderRadius = `${mapRadius}px`;
  shadowWindow.style.boxShadow =
    shadow && thickness > 0
      ? `0 ${Math.round(thickness * 0.15)}px ${Math.round(thickness * 0.4)}px rgba(0, 0, 0, 0.25)`
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
