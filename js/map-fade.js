// Live WYSIWYG preview of the "bottom fade" — a poster-style caption zone
// where the map dissolves into a solid color at the bottom edge. An overlay
// div inside the MapLibre container renders the same gradient band the
// export pipeline (js/export.js's paintBottomFade) paints onto the PNG, so
// the live map and the exported PNG always match 1:1 — mirrors
// js/map-frame.js's structure and public surface.
//
// MODEL: `height` is a PERCENTAGE (0-100) of the map container's own height
// — NOT a pixel count — so the band covers the same proportion of the view
// regardless of the live window's size or an export preset's dimensions
// (see storage.js's DEFAULT_BOTTOM_FADE comment for the full rationale).
// The band is bottom-anchored, full width, and painted with a CSS linear
// gradient: solid `color` at the very bottom, fading to transparent at the
// top of the band.
//
// Public surface:
//   init(map)   — create the overlay (idempotent) and return { update }.
//   update(fade) — given `{ enabled, height, color }` (any subset/partial,
//                  possibly straight off a live DOM read mid-edit), show/hide
//                  and redraw the band. Coerces/clamps every field
//                  defensively so a NaN height or a malformed color never
//                  throws or reaches a CSS value.

const OVERLAY_ID = "map-fade-overlay";

let overlay = null;

/**
 * Wire the overlay to `map`. Idempotent: a second call reuses the existing
 * element rather than creating a duplicate node (mirrors js/map-frame.js).
 */
export function init(map) {
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "map-fade-overlay";
    overlay.hidden = true;

    // Sibling of the canvas-container, like map-frame.js's overlay, so it
    // paints above the tiles/markers without ever intercepting pointer
    // events (pointer-events:none is set in CSS on .map-fade-overlay).
    map.getContainer().appendChild(overlay);
  }

  return { update };
}

/**
 * Redraw the band from `fade`. Every field is re-coerced here (not just
 * trusted from the caller) because app.js may pass a live DOM read straight
 * off the number input, which can be NaN mid-edit (e.g. the field is
 * briefly empty) — never let that reach a CSS value.
 */
export function update(fade) {
  if (!overlay) return;

  const f = fade || {};
  const pct = clampPercent(f.height);

  if (!f.enabled || pct === 0) {
    overlay.hidden = true;
    return;
  }

  const color = typeof f.color === "string" && f.color ? f.color : "#ffffff";

  overlay.hidden = false;
  overlay.style.height = `${pct}%`;
  // Solid at the bottom (0% of the gradient axis, "to top" runs bottom→top),
  // fading to transparent at the top of the band — matches
  // js/export.js's paintBottomFade gradient direction exactly.
  overlay.style.background = `linear-gradient(to top, ${color} 0%, transparent 100%)`;
  overlay.style.pointerEvents = "none";
}

// Missing/NaN/non-finite -> 0, else clamp to 0-100 — mirrors
// storage.js's normalizeBottomFade height clamp, reused here since this
// module can receive un-normalized live input reads too.
function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
