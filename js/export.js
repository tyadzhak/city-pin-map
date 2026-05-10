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

    // Both paths produce a canvas. The optional frame-wrap pass and the
    // single toDataURL conversion happen at the end so they share the
    // exact same code regardless of which capture path ran.
    let innerCanvas;
    if (!preset && !onMapTitleProjection) {
      // Fast path: live map, no resize, no overlay text. Capture the
      // canvas as-is. triggerRepaint + once('render') ensures the
      // framebuffer reflects the current state before we read it.
      await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS);
      mapInstance.triggerRepaint();
      await waitForRender(mapInstance);
      innerCanvas = mapInstance.getCanvas();
    } else {
      innerCanvas = await captureFramed(mapInstance, preset, onMapTitleProjection);
    }

    const finalCanvas = wrapFrame(innerCanvas, frame);
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

    return composite({
      mapCanvas: mapInstance.getCanvas(),
      mapWidthCss: frameWidth,
      mapHeightCss: frameHeight,
      outputWidth: frameWidth,
      outputHeight: frameHeight,
      onMapTitle,
      coeff,
    });
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

// Composite the map canvas + on-map title chip into one output canvas
// and return the canvas. The output canvas is sized in CSS pixels. The
// caller (exportMapAsPng) handles the optional PO-007 frame wrap and the
// final toDataURL conversion.
function composite({
  mapCanvas,
  mapWidthCss,
  mapHeightCss,
  outputWidth,
  outputHeight,
  onMapTitle,
  coeff,
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

  // Map canvas, scaled to CSS pixel dims. mapCanvas.width/.height are
  // device pixels (CSS × dpr); drawImage's 9-arg form rescales to the
  // destination rect.
  ctx.drawImage(
    mapCanvas,
    0,
    0,
    mapCanvas.width,
    mapCanvas.height,
    0,
    0,
    mapWidthCss,
    mapHeightCss
  );

  // PO-008/009 — draw the on-map title chip AFTER the map pixels (so it
  // floats on top of tiles + markers) and BEFORE wrapFrame (which runs
  // in the caller, so the decorative frame never paints over the title).
  // Pixel position scales the live-map ratio by the export's map area.
  if (onMapTitle) {
    drawOnMapTitle(ctx, {
      x: onMapTitle.xRatio * mapWidthCss,
      y: onMapTitle.yRatio * mapHeightCss,
      style: onMapTitle.style,
      text: onMapTitle.text,
      coeff,
    });
  }

  return out;
}

// PO-007 — Decorative frame composition. Allocates a larger canvas
// (inner + 2*thickness on each axis), fills it with the frame color, then
// drawImages the inner composite at offset (thickness, thickness). When
// `frame.shadow` is true, a soft drop shadow is cast by the inner image
// onto the frame area — like a printed photo on a card.
//
// Defensive: enabled=false OR thickness<=0 returns the inner canvas
// untouched, satisfying the acceptance criterion that thickness=0 with
// the toggle on produces the same output as the toggle off.
//
// Shadow recipe (tuned visually for the "soft Polaroid" look):
//   shadowColor   = "rgba(0,0,0,0.25)"
//   shadowBlur    = round(thickness * 0.4)
//   shadowOffsetY = round(thickness * 0.15)
// Expressing every shadow dimension as a fraction of `thickness` means
// at thickness=0 every dimension is also 0, so the disabled / thickness=0
// short-circuit isn't strictly required for shadow correctness — it's just
// there to skip the canvas allocation entirely.
//
// Implementation note (deliberate deviation from the task prompt): the
// task prompt described setting shadow → fillRect → reset → drawImage,
// but a fillRect that covers the entire canvas is fully self-occluding —
// its own shadow would only fall outside the canvas (clipped). To get the
// described "soft drop shadow within the frame area" effect, the shadow
// has to be active when the INNER composite is drawn so the inner image
// (the photo) casts onto the frame fill (the card).
function wrapFrame(innerCanvas, frame) {
  if (!frame || !frame.enabled) return innerCanvas;
  const thickness = Math.max(0, Math.round(Number(frame.thickness) || 0));
  if (thickness <= 0) return innerCanvas;

  const out = document.createElement("canvas");
  out.width = innerCanvas.width + 2 * thickness;
  out.height = innerCanvas.height + 2 * thickness;
  const ctx = out.getContext("2d");

  // Fill the frame card with no shadow set, so the fill itself doesn't
  // try (and fail) to cast a shadow.
  ctx.fillStyle = frame.color;
  ctx.fillRect(0, 0, out.width, out.height);

  if (frame.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
    ctx.shadowBlur = Math.round(thickness * 0.4);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(thickness * 0.15);
  }

  ctx.drawImage(innerCanvas, thickness, thickness);

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
