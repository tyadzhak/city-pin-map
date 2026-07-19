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
// OUTSIDE-FRAME TREATMENT (this milestone): the region beyond the outer edge
// of the OUTERMOST ENABLED frame (smallest `margin` among enabled elements —
// its outer edge sits closest to the container edge) can be filled white or
// blurred, mirroring js/export.js's paintFrameOutside 1:1 so the live
// preview and the exported PNG agree. "Enabled" (not "drawable"/thickness>0)
// decides the outermost frame — its margin/radius still define the boundary
// even if that element's own band happens to be invisible at thickness 0.
// See applyOutside() below for the two treatments' implementation, and the
// module's public surface note for update()'s expanded contract.
//
// Public surface:
//   init(map)      — create the overlay (idempotent) and return { update }.
//   update(frameSet) — given the normalized FRAME SET
//                      `{ frames: [frameElement, frameElement], outside }`
//                      (each frameElement: enabled, thickness, color,
//                      shadow, padding, margin, radius; outside: mode,
//                      color, blur), show/hide and redraw one ring per
//                      drawable element PLUS the outside treatment (if any).
//                      Coerces/clamps every field defensively so a partial
//                      or corrupt-looking object never throws. Also
//                      tolerates a bare single legacy frame object (no
//                      `outside`, treated as mode "none") for safety.

const OVERLAY_ID = "map-frame-overlay";
const LENGTH_MIN = 0;
const LENGTH_MAX = 200;
const OUTSIDE_BLUR_MIN = 0;
const OUTSIDE_BLUR_MAX = 50;
const OUTSIDE_MODES = ["none", "white", "blur"];
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

let mapInstance = null;
let overlay = null;
// Pool of ring divs, one per drawable frame element. Grows lazily (see
// getOrCreateRing); never shrinks — unused rings are just hidden.
let ringPool = [];
// The two outside-treatment layers — only one is ever visible at a time
// (see applyOutside). Created once in init(), lazily shown/hidden/restyled.
let outsideWhiteEl = null;
let outsideBlurEl = null;
// Last config passed to update(), so the ResizeObserver callback (which
// fires with no arguments) can recompute the blur mask's pixel geometry
// without the caller having to re-push the same config on every resize.
let lastFrames = [];
let lastOutside = null;
let resizeObserver = null;

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

  if (!outsideWhiteEl) {
    outsideWhiteEl = document.createElement("div");
    outsideWhiteEl.className = "map-frame-overlay__outside map-frame-overlay__outside--white";
    outsideWhiteEl.hidden = true;
    overlay.appendChild(outsideWhiteEl);
  }
  if (!outsideBlurEl) {
    outsideBlurEl = document.createElement("div");
    outsideBlurEl.className = "map-frame-overlay__outside map-frame-overlay__outside--blur";
    outsideBlurEl.hidden = true;
    overlay.appendChild(outsideBlurEl);
  }

  // The "white" treatment is pure CSS box model (inset + box-shadow spread)
  // and tracks a container resize for free, same as the ring pool. The
  // "blur" treatment's mask bakes actual pixel dimensions into an SVG data
  // URI, so it needs an explicit recompute on resize — mirrors
  // js/map-viewport.js's ResizeObserver-on-container pattern for the exact
  // same "must track live pixel size" problem. Idempotent: only wired once.
  if (!resizeObserver && typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => applyOutside());
    resizeObserver.observe(map.getContainer());
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
  // A bare legacy frame object (no `outside` sibling) degrades to mode
  // "none" — same "tolerate the old shape" contract the frames array above
  // already has via the `frameSet ? [frameSet] : []` fallback.
  const outside = frameSet?.outside || null;

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

  // Stash for the ResizeObserver callback (fires with no arguments) and
  // apply immediately so a config change previews right away.
  lastFrames = frames;
  lastOutside = outside;
  const outsideVisible = applyOutside();

  overlay.hidden = drawnCount === 0 && !outsideVisible;
}

/**
 * The frame SET last passed to update(), as `{ frames, outside }`. Lets other
 * live overlays (js/map-inset.js) read the CURRENTLY-APPLIED frame geometry
 * — including edits that are applied-but-not-yet-persisted — without re-reading
 * localStorage. `frames` is the raw array update() received (each element may
 * carry un-clamped live number-input reads); the caller is expected to clamp
 * defensively, exactly as update() does. Returns empty defaults before the
 * first update().
 */
export function getFrameSetInUse() {
  return { frames: lastFrames, outside: lastOutside };
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

function clampBlur(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(OUTSIDE_BLUR_MIN, Math.min(OUTSIDE_BLUR_MAX, Math.round(n)));
}

// Among ENABLED frame elements (not "drawable" — a frame with thickness 0
// still defines a boundary via its margin/radius even though it paints no
// band of its own), the one with the smallest margin: its outer edge sits
// closest to the container edge, i.e. the largest outer rounded-rect.
// Mirrors js/export.js's identical helper so the live preview and the
// exported PNG agree on which frame the outside treatment bounds against.
function outermostEnabledFrame(frames) {
  let best = null;
  let bestMargin = Infinity;
  for (const f of frames) {
    if (!f || !f.enabled) continue;
    const margin = clampLength(f.margin);
    if (margin < bestMargin) {
      bestMargin = margin;
      best = f;
    }
  }
  return best;
}

// Redraws the outside-frame treatment from the last config update() stored
// (lastFrames/lastOutside), using the current live pixel size of the
// overlay. Returns whether anything is now visible, so update() can fold
// that into the overlay's own hidden state (a frame with thickness 0 draws
// no ring but can still have an outside boundary to show). Called both from
// update() (config changed) and the ResizeObserver (container resized) —
// same function, so the two triggers can never draw it differently.
function applyOutside() {
  if (!outsideWhiteEl || !outsideBlurEl || !overlay) return false;

  const outermost = outermostEnabledFrame(lastFrames);
  const mode =
    outermost && lastOutside && OUTSIDE_MODES.includes(lastOutside.mode)
      ? lastOutside.mode
      : "none";

  if (!outermost || mode === "none") {
    outsideWhiteEl.hidden = true;
    outsideBlurEl.hidden = true;
    return false;
  }

  const margin = clampLength(outermost.margin);
  const radius = clampLength(outermost.radius);
  const blurSupported = mode === "blur" && supportsBackdropFilter();

  if (mode === "white" || (mode === "blur" && !blurSupported)) {
    // "white" — or a defensive fallback to it when backdrop-filter isn't
    // supported (BATCH-SPEC.md: never silently do nothing). Pure CSS box
    // model: the box IS the outer rect (inset by margin, radius'd), and its
    // box-shadow spread paints everywhere OUTSIDE that box. No JS pixel
    // measurement needed, so this stays correct across any resize for free.
    const color =
      mode === "white" && typeof lastOutside.color === "string" && HEX_COLOR_RE.test(lastOutside.color)
        ? lastOutside.color
        : "#ffffff";
    outsideBlurEl.hidden = true;
    outsideWhiteEl.hidden = false;
    outsideWhiteEl.style.top = `${margin}px`;
    outsideWhiteEl.style.right = `${margin}px`;
    outsideWhiteEl.style.bottom = `${margin}px`;
    outsideWhiteEl.style.left = `${margin}px`;
    outsideWhiteEl.style.borderRadius = `${radius}px`;
    outsideWhiteEl.style.boxShadow = `0 0 0 9999px ${color}`;
    return true;
  }

  // "blur", supported. Un-hide first so getBoundingClientRect below reads
  // the overlay's real live size, not a hidden (0×0) box.
  outsideWhiteEl.hidden = true;
  outsideBlurEl.hidden = false;
  overlay.hidden = false;

  const blurPx = clampBlur(lastOutside.blur);
  outsideBlurEl.style.backdropFilter = `blur(${blurPx}px)`;
  outsideBlurEl.style.webkitBackdropFilter = `blur(${blurPx}px)`;

  const rect = overlay.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const maskUrl = buildOutsideMaskUrl(width, height, margin, radius);
  outsideBlurEl.style.webkitMaskImage = `url("${maskUrl}")`;
  outsideBlurEl.style.maskImage = `url("${maskUrl}")`;

  return true;
}

// True when the browser actually honors backdrop-filter — a stale/older
// engine would otherwise silently render outsideBlurEl as an inert
// full-cover div (no blur, no visible boundary), which reads as "the
// feature does nothing" rather than a legible fallback.
function supportsBackdropFilter() {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  return (
    CSS.supports("backdrop-filter", "blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(1px)")
  );
}

// Builds a data: URI SVG mask: opaque (visible) everywhere EXCEPT the inner
// rounded rect (inset by `margin`, corner radius `radius`), which stays
// transparent (mask-hidden). Applied to outsideBlurEl so its
// backdrop-filter only blurs the region outside that rect — the exact
// geometry js/export.js's paintFrameOutside paints with a canvas path, here
// expressed as an SVG path (full-canvas rect minus the same rounded rect,
// evenodd) since CSS mask-image needs an image, not a 2D-context path.
function buildOutsideMaskUrl(width, height, margin, radius) {
  const innerW = Math.max(0, width - 2 * margin);
  const innerH = Math.max(0, height - 2 * margin);
  const r = Math.max(0, Math.min(radius, Math.min(innerW, innerH) / 2));

  const outerPath = `M0,0 H${width} V${height} H0 Z`;
  let innerPath = "";
  if (innerW > 0 && innerH > 0) {
    if (r <= 0) {
      innerPath = `M${margin},${margin} H${margin + innerW} V${margin + innerH} H${margin} Z`;
    } else {
      innerPath = [
        `M${margin + r},${margin}`,
        `H${margin + innerW - r}`,
        `A${r},${r} 0 0 1 ${margin + innerW},${margin + r}`,
        `V${margin + innerH - r}`,
        `A${r},${r} 0 0 1 ${margin + innerW - r},${margin + innerH}`,
        `H${margin + r}`,
        `A${r},${r} 0 0 1 ${margin},${margin + innerH - r}`,
        `V${margin + r}`,
        `A${r},${r} 0 0 1 ${margin + r},${margin}`,
        "Z",
      ].join(" ");
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><path fill="#fff" fill-rule="evenodd" ` +
    `d="${outerPath} ${innerPath}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
