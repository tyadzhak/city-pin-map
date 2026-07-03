// PNG export via native HTML5 Canvas. Composites the MapLibre WebGL canvas
// into an off-screen 2D canvas, paints the on-map title overlay (PO-008)
// at its projected position, then optionally wraps the result in a
// decorative frame (PO-007), then toDataURL.
//
// Markers and the route line are layers inside the WebGL canvas (see
// js/map.js — Option B GeoJSONSource + circle/line layers), so they are
// captured automatically by getCanvas(). No post-composite step is needed.
//
// PO-009 retired the NICE-006 title strip path. The single on-map title
// (with user-driven font / bold / italic / color / size) is the only text
// pass on the composite — picked over the strip because a draggable
// labelled location does the same poster-header job and lets the user
// place the text wherever it complements the map best.
//
// PIXEL-SPACE CONTRACT (FBL-005). One rule, decided once:
//   • "Current view" exports are DEVICE resolution — the output canvas is
//     the WebGL framebuffer's own pixel size (CSS size × devicePixelRatio).
//     The fast path returns getCanvas() as-is; the composite path (title
//     present) allocates its output at mapCanvas.width/height. Both therefore
//     produce the SAME dimensions and sharpness for the same view, whether or
//     not a title/frame is present.
//   • Preset exports (EXPORT_PRESETS: 1080², A4 794×1123, …) are a UI
//     contract: their output is EXACTLY the documented CSS-pixel dimensions,
//     independent of the display's dpr. Scaling happens INSIDE the render
//     (the device-pixel map canvas is downscaled into the preset canvas), but
//     the final width/height never changes.
//   • Everything drawn onto the 2D canvas by us (the title chip) and the
//     frame thickness is expressed in CSS pixels and multiplied by that
//     canvas's effective CSS→output scale — `chipScale` for the title,
//     `innerScale` for the frame — so a given view / frame / chip reads at the
//     same visual proportion on both paths regardless of dpr. MapLibre-drawn
//     content (tiles, markers, pin labels) is scaled by the GL context's own
//     pixelRatio, so it needs no extra factor.

import { showError, loadExportFrame, loadOnMapTitle } from "./storage.js";
import { BASE_PIN_LABEL_SIZE, setPinLabelSize } from "./map.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// Same budgets the previous Leaflet impl used; MapLibre's `idle` event
// has slightly different semantics (it includes GPU painting) but the
// wall-clock budget translates cleanly enough.
const TILE_WAIT_TIMEOUT_MS = 8000;
const TILE_WAIT_TIMEOUT_MS_PRESET = 12000;

// CSS-pixel offset that pushes the export frame fully off any reasonable
// viewport. Same value the Leaflet pipeline used.
const OFFSCREEN_PX = -100000;

// Reference canvas dimension that the live-CSS sizes for the on-map title
// and the pins-labels layer were tuned against (PO-006). The export
// coefficient is the longest output side divided by this baseline,
// clamped to keep extreme presets readable. Tuning history: a 1280-px-
// wide capture is the "canonical" desktop browser viewport these
// constants were eyeballed at.
const REFERENCE_BASELINE = 1280;
const COEFF_MIN = 0.6;
const COEFF_MAX = 2.5;

// White canvas under the composite. Letterbox-coverage when a preset's
// aspect ratio doesn't match the live map's; otherwise the map fills the
// canvas edge-to-edge and this is invisible. Kept as a constant so a
// future "exported background color" task has one place to wire into.
const CANVAS_BACKGROUND = "#ffffff";

// Preset id → { width, height } in CSS pixels for the exported PNG.
// `null` means "Current view — capture the live map at its on-screen size".
// 96 dpi for A-series; see NICE-007 notes. The 10×15 cm photo-print preset
// (PO-005) is 300 dpi to meet consumer photo-lab requirements:
// 10 cm × 300 dpi ÷ 2.54 ≈ 1181, 15 cm × 300 dpi ÷ 2.54 ≈ 1772.
export const EXPORT_PRESETS = {
  current: null,
  square: { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
  "a3-portrait": { width: 1191, height: 1684 },
  "a3-landscape": { width: 1684, height: 1191 },
  "photo-10x15-portrait": { width: 1181, height: 1772 },
};

// PO-008/009 — on-map title chip. Typography (font, weight, italic, color,
// size) comes from the user's picks in storage; the chip's box geometry
// is fixed here so backdrops still read as one design family across font
// changes. Every box dimension multiplies by `coeff` (PO-006) at draw
// time, so the chip grows proportionally with the export canvas.
const ON_MAP_TITLE_BOX = {
  background: "rgba(255, 255, 255, 0.85)",
  borderColor: "rgba(0, 0, 0, 0.06)",
  borderWidth: 1,
  paddingX: 14,
  paddingY: 8,
  borderRadius: 6,
  // Approximate glyph-box → line-height ratio. Used to size the backdrop
  // around the user's text. Same 1.2 the live CSS uses, so live and
  // exported renders read at the same visual weight.
  lineHeightMultiplier: 1.2,
};

/**
 * Capture the current map view and trigger a PNG download.
 * On any failure, surfaces a user-visible message via showError() and keeps
 * the app usable (no re-throw).
 */
export async function exportMapAsPng(mapInstance) {
  try {
    if (!mapInstance) throw new Error("map instance not provided");

    const formatSelect = document.getElementById("export-format");
    const presetId = formatSelect ? formatSelect.value : "current";
    const preset = EXPORT_PRESETS[presetId] ?? null;

    // PO-007 frame settings live in localStorage; app.js owns the input
    // wiring. Reading at click time mirrors how preset is resolved above
    // — the export pipeline doesn't need a subscription.
    const frame = loadExportFrame();

    // PO-008/009 — on-map title. Captured on the live map BEFORE
    // captureFramed resizes anything (approach (1) in the task brief):
    // we record the projected pixel position as a ratio of the live
    // container's CSS dimensions, then composite() multiplies that ratio
    // by the export canvas's map area. Resizing for a preset reprojects
    // Mercator at a different aspect, so the ratio approximation can
    // drift sub-pixel on extreme presets — invisible at A4/16:9; bump to
    // approach (2) if the drift becomes observable on A3 / 10×15.
    const onMapTitleRaw = loadOnMapTitle();
    const onMapTitleProjection = projectOnMapTitle(mapInstance, onMapTitleRaw);

    // Both paths produce a canvas plus its CSS→canvas-pixel scale (so
    // wrapFrame can express a CSS-pixel thickness in the inner canvas's own
    // pixel space). The optional frame-wrap pass and the single toDataURL
    // conversion happen at the end so they share the exact same code
    // regardless of which capture path ran.
    let innerCanvas;
    let innerScale;
    if (!preset && !onMapTitleProjection) {
      // Fast path: live map, no resize, no overlay text, no extra canvas.
      // Capture the framebuffer as-is (device resolution). triggerRepaint +
      // once('render') ensures it reflects the current state before we read
      // it. The frame wrap only allocates a canvas if a frame is enabled.
      await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS);
      mapInstance.triggerRepaint();
      await waitForRender(mapInstance);
      innerCanvas = mapInstance.getCanvas();
      innerScale = deviceScale(mapInstance);
    } else {
      const captured = await captureFramed(
        mapInstance,
        preset,
        onMapTitleProjection
      );
      innerCanvas = captured.canvas;
      innerScale = captured.scale;
    }

    const finalCanvas = wrapFrame(innerCanvas, frame, innerScale);
    const dataUrl = finalCanvas.toDataURL("image/png");

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
}

// Single off-screen wrapper that handles the preset resize. One
// try/finally so any failure unwinds the DOM and the MapLibre container
// atomically.
async function captureFramed(mapInstance, preset, onMapTitle) {
  const mapEl = mapInstance.getContainer();

  const originalParent = mapEl.parentNode;
  const originalNextSibling = mapEl.nextSibling;
  const rect = mapEl.getBoundingClientRect();
  const savedInline = {
    position: mapEl.style.position,
    top: mapEl.style.top,
    right: mapEl.style.right,
    bottom: mapEl.style.bottom,
    left: mapEl.style.left,
    width: mapEl.style.width,
    height: mapEl.style.height,
  };

  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = `${OFFSCREEN_PX}px`;
  wrapper.style.top = "0";
  wrapper.style.background = CANVAS_BACKGROUND;

  const frameWidth = preset ? preset.width : rect.width;
  const frameHeight = preset ? preset.height : rect.height;

  // PO-006: the typography coefficient is a function of the export's
  // longest side. For preset captures we use the preset dimensions
  // directly; for "current view" we use the live map's CSS rect, so
  // ~1.0 for a typical 1280-px-wide window keeps the on-map title at
  // the visual weight the user picked in the live overlay.
  const coeff = computeCoeff(frameWidth, frameHeight);

  wrapper.style.width = `${frameWidth}px`;
  wrapper.style.height = `${frameHeight}px`;

  // Strip .app-map's inset:0 positioning so the map sits as a normal
  // child of the off-screen wrapper.
  mapEl.style.position = "relative";
  mapEl.style.top = "auto";
  mapEl.style.right = "auto";
  mapEl.style.bottom = "auto";
  mapEl.style.left = "auto";
  mapEl.style.width = `${frameWidth}px`;
  mapEl.style.height = `${frameHeight}px`;

  wrapper.appendChild(mapEl);
  document.body.appendChild(wrapper);

  try {
    // Tell MapLibre the container is a different size. animate:false is
    // implicit — `resize()` doesn't animate.
    mapInstance.resize();
    await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS_PRESET);

    // PO-006: bump pin label size to match the export canvas, AFTER the
    // resize+idle settle but BEFORE the final repaint. The change goes
    // through MapLibre's symbol layer, so the next render frame picks up
    // the new size; setLayoutProperty itself queues a repaint, the
    // explicit triggerRepaint+waitForRender below is belt-and-suspenders.
    setPinLabelSize(BASE_PIN_LABEL_SIZE * coeff);

    mapInstance.triggerRepaint();
    await waitForRender(mapInstance);

    // FBL-005 pixel-space contract:
    //   • Preset → output is EXACTLY the contractual CSS-pixel dims; the
    //     device-pixel map canvas downscales into it. scale = 1.
    //   • Current view (no preset) → output is the framebuffer's device
    //     resolution, matching the fast path bit-for-bit. scale = dpr.
    // `scale` (= outputWidth / frameWidth) is 1 for presets and dpr for
    // current view, and drives both the title-chip typography and, back in
    // the caller, the frame thickness.
    const mapCanvas = mapInstance.getCanvas();
    const outputWidth = preset ? frameWidth : mapCanvas.width;
    const outputHeight = preset ? frameHeight : mapCanvas.height;
    const scale = frameWidth > 0 ? outputWidth / frameWidth : 1;

    return {
      canvas: composite({
        mapCanvas,
        outputWidth,
        outputHeight,
        onMapTitle,
        coeff,
        chipScale: scale,
      }),
      scale,
    };
  } finally {
    // Restore live pin-label size first — independent of DOM state, so
    // even if any re-attach step throws, the live UI returns to default.
    setPinLabelSize(null);

    if (originalNextSibling) {
      originalParent.insertBefore(mapEl, originalNextSibling);
    } else {
      originalParent.appendChild(mapEl);
    }
    mapEl.style.position = savedInline.position;
    mapEl.style.top = savedInline.top;
    mapEl.style.right = savedInline.right;
    mapEl.style.bottom = savedInline.bottom;
    mapEl.style.left = savedInline.left;
    mapEl.style.width = savedInline.width;
    mapEl.style.height = savedInline.height;
    mapInstance.resize();
    wrapper.remove();
  }
}

// Clamp(longestSide / REFERENCE_BASELINE, [COEFF_MIN, COEFF_MAX]). Used
// by both the on-map title chip and the pin-labels override. See PO-006
// notes: the clamp guards against unreadable extremes from custom or
// future preset dimensions sitting far outside the tuned-for-1280 sweet
// spot.
function computeCoeff(width, height) {
  const longest = Math.max(width, height);
  const raw = longest / REFERENCE_BASELINE;
  return Math.min(COEFF_MAX, Math.max(COEFF_MIN, raw));
}

// Composite the map canvas + on-map title chip into one output canvas and
// return the canvas. The output canvas is sized in whatever pixel space the
// caller chose (device resolution for current view, contractual CSS pixels
// for a preset — see the FBL-005 contract at the top of this file). The
// caller (exportMapAsPng) handles the optional PO-007 frame wrap and the
// final toDataURL conversion.
function composite({
  mapCanvas,
  outputWidth,
  outputHeight,
  onMapTitle,
  coeff,
  chipScale,
}) {
  const out = document.createElement("canvas");
  out.width = outputWidth;
  out.height = outputHeight;
  const ctx = out.getContext("2d");

  // Solid background — covers any margin if the preset's aspect ratio
  // exceeds the live map's. With matched aspect ratios the map canvas
  // covers it edge-to-edge.
  ctx.fillStyle = CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  // Map framebuffer → output. mapCanvas.width/.height are device pixels
  // (CSS × dpr). For current view the destination equals those dims (1:1,
  // crisp); for a preset drawImage's 9-arg form downscales into the smaller
  // contractual canvas.
  ctx.drawImage(
    mapCanvas,
    0,
    0,
    mapCanvas.width,
    mapCanvas.height,
    0,
    0,
    outputWidth,
    outputHeight
  );

  // PO-008/009 — draw the on-map title chip AFTER the map pixels (so it
  // floats on top of tiles + markers) and BEFORE wrapFrame (which runs in
  // the caller, so the decorative frame never paints over the title). The
  // position ratio multiplies the ACTUAL output dims (device or CSS), and
  // the chip typography multiplies `coeff` by `chipScale` (dpr for current
  // view, 1 for a preset) so the pill keeps the same visual proportion in
  // both pixel spaces.
  if (onMapTitle) {
    drawOnMapTitle(ctx, {
      x: onMapTitle.xRatio * outputWidth,
      y: onMapTitle.yRatio * outputHeight,
      style: onMapTitle.style,
      text: onMapTitle.text,
      coeff: coeff * chipScale,
    });
  }

  return out;
}

// CSS→device-pixel scale of the live map framebuffer (the GL context's
// pixelRatio, typically window.devicePixelRatio). Used to express a
// CSS-pixel frame thickness in the fast path's device-resolution canvas.
function deviceScale(mapInstance) {
  const canvas = mapInstance.getCanvas();
  const cssWidth = mapInstance.getContainer().getBoundingClientRect().width;
  if (cssWidth > 0) return canvas.width / cssWidth;
  return window.devicePixelRatio || 1;
}

// PO-007 (+ this milestone's live-preview parity work) — Decorative frame
// composition. Layers from OUTSIDE in: margin (white) → thickness (frame
// band, frame.color) → padding (white mat) → map. This is the same
// geometry the live on-map overlay draws, documented once here and in that
// module's header; the two differ only in WHERE the frame sits relative to
// the captured map pixels (see that module's WYSIWYG note).
//
// Allocates a canvas sized innerCanvas + 2*(margin+thickness+padding) on
// each axis, fills it white (the margin ring), paints the band and mat as
// concentric rounded rects, then draws the map image inset by all three,
// clipped to its own concentric radius. When `frame.shadow` is true, a
// soft drop shadow is cast by the map's shape onto the mat — like a
// printed photo on a card.
//
// Defensive: enabled=false, or margin/thickness/padding all <= 0, returns
// the inner canvas untouched — same "thickness=0 with the toggle on ==
// toggle off" acceptance criterion PO-007 established, extended to the two
// new outer layers (a margin-only or padding-only setup is still nothing
// to draw if the band itself has no width).
//
// Shadow recipe (tuned visually for the "soft Polaroid" look, unchanged
// from PO-007 — padding/margin/radius don't affect it):
//   shadowColor   = "rgba(0,0,0,0.25)"
//   shadowBlur    = round(thickness * 0.4)
//   shadowOffsetY = round(thickness * 0.15)
//
// Implementation note on shadow + rounded corners: PO-007 could draw the
// map image directly with the shadow active because that image was a
// plain rectangle — the shadow naturally spilled past its edges onto the
// frame fill underneath. Once the map itself is clipped to a rounded rect
// (radius > 0), clipping-then-drawing would also clip the shadow to that
// same shape, erasing the very spill onto the mat the effect needs. So
// when frame.shadow is on, an opaque stand-in of the map's rounded-rect
// shape is painted first (shadow active, unclipped, so the blur spills
// outward onto the mat), then the real map is drawn on top clipped to the
// identical shape — fully covering the stand-in, leaving only its shadow
// visible.
function wrapFrame(innerCanvas, frame, scale = 1) {
  if (!frame || !frame.enabled) return innerCanvas;

  // Every dimension is stored/clamped (storage.js: 0–200) in CSS pixels.
  // Multiply by the inner canvas's CSS→pixel scale (dpr for a device-res
  // current-view canvas, 1 for a preset canvas) so the same stored values
  // read at the same visual proportion on every path (FBL-005).
  const margin = Math.round(Math.max(0, Number(frame.margin) || 0) * scale);
  const thickness = Math.round(Math.max(0, Number(frame.thickness) || 0) * scale);
  const padding = Math.round(Math.max(0, Number(frame.padding) || 0) * scale);
  const radius = Math.round(Math.max(0, Number(frame.radius) || 0) * scale);

  if (margin <= 0 && thickness <= 0 && padding <= 0) return innerCanvas;

  const inset = margin + thickness + padding;
  const out = document.createElement("canvas");
  out.width = innerCanvas.width + 2 * inset;
  out.height = innerCanvas.height + 2 * inset;
  const ctx = out.getContext("2d");

  // Margin ring: plain white background. The band (next) is inset by
  // `margin`, so whatever it doesn't cover shows through as the margin.
  ctx.fillStyle = CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, out.width, out.height);

  // Frame band: frame.color, inset by margin, outer corner radius `radius`.
  ctx.fillStyle = frame.color;
  drawRoundedRect(ctx, margin, margin, out.width - 2 * margin, out.height - 2 * margin, radius);
  ctx.fill();

  // White mat: inset by margin+thickness, concentric radius (radius minus
  // the band's own width) so the corners nest visually inside the band.
  const matInset = margin + thickness;
  const matRadius = Math.max(0, radius - thickness);
  ctx.fillStyle = CANVAS_BACKGROUND;
  drawRoundedRect(
    ctx,
    matInset,
    matInset,
    out.width - 2 * matInset,
    out.height - 2 * matInset,
    matRadius
  );
  ctx.fill();

  // Map placement: inset by margin+thickness+padding, concentric radius
  // (radius minus band width minus padding width) for the same nesting.
  const mapRadius = Math.max(0, radius - thickness - padding);

  if (frame.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = Math.round(thickness * 0.4);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(thickness * 0.15);
    ctx.fillStyle = "#000";
    drawRoundedRect(ctx, inset, inset, innerCanvas.width, innerCanvas.height, mapRadius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  drawRoundedRect(ctx, inset, inset, innerCanvas.width, innerCanvas.height, mapRadius);
  ctx.clip();
  ctx.drawImage(innerCanvas, inset, inset);
  ctx.restore();

  return out;
}

// PO-008/009. Projects the on-map title's stored lon/lat onto the LIVE
// map container's pixel space and returns the position as a ratio of the
// container's CSS dimensions, plus the user's formatting state pulled
// straight off the storage object. composite() multiplies the ratio by
// the export's map area so the chip lands at the same on-screen position
// the user saw before clicking Export.
function projectOnMapTitle(mapInstance, raw) {
  if (!raw || !raw.text) return null;
  if (!Number.isFinite(raw.lon) || !Number.isFinite(raw.lat)) return null;

  const rect = mapInstance.getContainer().getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const pt = mapInstance.project([raw.lon, raw.lat]);
  return {
    text: raw.text,
    xRatio: pt.x / rect.width,
    yRatio: pt.y / rect.height,
    style: {
      font: raw.font,
      bold: Boolean(raw.bold),
      italic: Boolean(raw.italic),
      color: raw.color,
      size: raw.size,
    },
  };
}

// PO-008/009. Paints the chip at (x, y) — interpreted as the chip's
// CENTER, mirroring the live overlay's translate(-50%, -50%) trick.
// `style` carries the user's font/bold/italic/color/size picks; the box
// constants (background, border, padding, radius) come from
// ON_MAP_TITLE_BOX. Every dimension scales by `coeff` so a 1080² preset
// gets a slightly smaller pill than a 1920×1080 one — same proportional-
// sizing contract the pin labels follow.
function drawOnMapTitle(ctx, { x, y, style, text, coeff }) {
  const fontSize = style.size * coeff;
  const padX = ON_MAP_TITLE_BOX.paddingX * coeff;
  const padY = ON_MAP_TITLE_BOX.paddingY * coeff;
  const radius = ON_MAP_TITLE_BOX.borderRadius * coeff;
  const borderWidth = ON_MAP_TITLE_BOX.borderWidth * coeff;

  ctx.save();

  // ctx.font shorthand: "italic 700 32px Georgia, serif". Order matters:
  // style → weight → size → family. Skipping italic when off keeps the
  // string short; weight=400 is the implicit normal default.
  const weight = style.bold ? "700" : "400";
  const styleToken = style.italic ? "italic " : "";
  ctx.font = `${styleToken}${weight} ${fontSize}px ${style.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize * ON_MAP_TITLE_BOX.lineHeightMultiplier;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = textHeight + padY * 2;
  const boxX = x - boxWidth / 2;
  const boxY = y - boxHeight / 2;

  // Translucent backdrop with rounded corners. Canvas2D's roundRect
  // landed in 2022 and is supported by every browser in this app's
  // target list, but a defensive fallback to a square fillRect keeps
  // older engines from throwing.
  ctx.fillStyle = ON_MAP_TITLE_BOX.background;
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, radius);
  ctx.fill();

  if (borderWidth > 0) {
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = ON_MAP_TITLE_BOX.borderColor;
    drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, radius);
    ctx.stroke();
  }

  ctx.fillStyle = style.color;
  ctx.fillText(text, x, y);

  ctx.restore();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Resolves when MapLibre fires `idle` (all tiles loaded + nothing pending
// to render) or after the timeout, whichever comes first. If the map is
// already idle, `once('idle')` resolves on the next tick.
function waitForIdle(mapInstance, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      mapInstance.off("idle", finish);
      clearTimeout(timer);
      resolve();
    };
    mapInstance.once("idle", finish);
    const timer = setTimeout(finish, timeoutMs);
  });
}

// Resolves on the next render frame. Used after triggerRepaint() so that
// getCanvas().toDataURL() reads pixels that match the current state, not
// the previous frame's framebuffer.
function waitForRender(mapInstance) {
  return new Promise((resolve) => mapInstance.once("render", resolve));
}

function triggerDownload(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
