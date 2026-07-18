// PNG export via native HTML5 Canvas. Composites the MapLibre WebGL canvas
// into an off-screen 2D canvas, paints the bottom fade (poster-style
// caption zone), then the on-map title overlay (PO-008) at its projected
// position — composite order is map → bottom fade → title, so the title
// always reads on top of the fade — then optionally wraps the result in a
// decorative frame (PO-007, outermost of all), then toDataURL.
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

import {
  showError,
  loadExportFrame,
  loadOnMapTitle,
  loadBottomFade,
} from "./storage.js";
import { BASE_PIN_LABEL_SIZE, setPinLabelSize } from "./map.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// Same budgets the previous Leaflet impl used; MapLibre's `idle` event
// has slightly different semantics (it includes GPU painting) but the
// wall-clock budget translates cleanly enough.
const TILE_WAIT_TIMEOUT_MS = 8000;
const TILE_WAIT_TIMEOUT_MS_PRESET = 12000;

// Upper bound on waitForRender (FBL-011). A render frame normally lands within
// a few ms of triggerRepaint(); this budget only matters when it never does
// (e.g. WebGL context loss between the repaint and the `render` event). Without
// it, the export promise never settles: captureFramed's finally never restores
// the off-screen map and app.js leaves the export button disabled forever.
// 2s is far above the normal single-frame latency yet short enough that a stuck
// export fails fast. On timeout we RESOLVE rather than reject — mirroring
// waitForIdle's philosophy — so the export proceeds with whatever is currently
// in the framebuffer (possibly one frame stale, but always a valid PNG) and the
// pipeline always unwinds through its existing catch/finally cleanup.
const RENDER_WAIT_TIMEOUT_MS = 2000;

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
// The landscape sibling is the same 300 dpi math with dimensions swapped.
export const EXPORT_PRESETS = {
  current: null,
  square: { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
  "a3-portrait": { width: 1191, height: 1684 },
  "a3-landscape": { width: 1684, height: 1191 },
  "photo-10x15-portrait": { width: 1181, height: 1772 },
  "photo-10x15-landscape": { width: 1772, height: 1181 },
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
export async function exportMapAsPng(mapInstance, options = {}) {
  try {
    if (!mapInstance) throw new Error("map instance not provided");

    const formatSelect = document.getElementById("export-format");
    const presetId = formatSelect ? formatSelect.value : "current";
    const preset = EXPORT_PRESETS[presetId] ?? null;

    // FBL-013: prefer the LIVE in-memory frame the on-map overlay renders
    // from — app.js passes it in (normalized through storage.js's
    // normalizeFrame, so it's the exact shape loadExportFrame() returns) —
    // and fall back to the persisted value only when the caller passes
    // nothing, keeping this function usable standalone. Re-reading storage at
    // click time used to diverge from the screen after a "kept in memory
    // only" save failure (localStorage at quota): the overlay showed the new
    // frame while the export rendered the stale saved one.
    const frame =
      options.frame !== undefined ? options.frame : loadExportFrame();

    // PO-008/009 — on-map title. We only extract + validate the title here
    // (its anchor lon/lat + the user's formatting); the pixel position is
    // computed later, inside captureFramed, by re-projecting the anchor on
    // the LIVE map AFTER it's resized to the export's dimensions (FBL-012).
    // resize() keeps center+zoom fixed, so that late projection is the
    // title's true on-map position at ANY aspect ratio — the earlier
    // pre-resize ratio approach drifted for off-center anchors on presets
    // whose width differed materially from the live map's.
    //
    // FBL-013: like the frame above, prefer the caller's live overlay state
    // (mapTitle.getPosition()) over the persisted copy so a quota-time save
    // failure can't make the export contradict what's on screen. Both sources
    // share the same field shape, so prepareOnMapTitle handles either.
    const onMapTitle = prepareOnMapTitle(
      options.onMapTitle !== undefined ? options.onMapTitle : loadOnMapTitle()
    );

    // Bottom fade — resolve the LIVE overlay state the same way frame/title
    // do (FBL-013 pattern): prefer the caller's in-memory value over the
    // persisted copy, so a "kept in memory only" save failure can't make the
    // export contradict what's on screen.
    const bottomFade =
      options.bottomFade !== undefined ? options.bottomFade : loadBottomFade();
    const fadeDrawable = Boolean(
      bottomFade && bottomFade.enabled && bottomFade.height > 0
    );

    // Both paths produce a canvas plus its CSS→canvas-pixel scale (so
    // wrapFrame can express a CSS-pixel thickness in the inner canvas's own
    // pixel space). The optional frame-wrap pass and the single toDataURL
    // conversion happen at the end so they share the exact same code
    // regardless of which capture path ran.
    let innerCanvas;
    let innerScale;
    if (!preset && !onMapTitle && !fadeDrawable) {
      // Fast path: live map, no resize, no overlay text, no fade, no extra
      // canvas. Capture the framebuffer as-is (device resolution).
      // triggerRepaint + once('render') ensures it reflects the current
      // state before we read it. The frame wrap only allocates a canvas if a
      // frame is enabled.
      await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS);
      mapInstance.triggerRepaint();
      await waitForRender(mapInstance, RENDER_WAIT_TIMEOUT_MS);
      innerCanvas = mapInstance.getCanvas();
      innerScale = deviceScale(mapInstance);
    } else {
      const captured = await captureFramed(mapInstance, preset, onMapTitle, bottomFade);
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
async function captureFramed(mapInstance, preset, onMapTitle, bottomFade) {
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
    await waitForRender(mapInstance, RENDER_WAIT_TIMEOUT_MS);

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

    // FBL-012: re-project the title's anchor on the LIVE map now that it sits
    // at the export's dimensions. resize() preserves center+zoom, so this is
    // the anchor's true pixel position on the resized map — no aspect-ratio
    // drift, unlike the old pre-resize ratio approximation that mis-placed
    // off-center titles on presets with a different width. project() returns
    // CSS pixels relative to the (now preset-sized) container; multiplying by
    // `scale` lifts them into the output canvas's pixel space — ×1 for presets
    // (CSS == output), ×dpr for current view — the same factor the chip
    // typography uses, so position and size stay in step (FBL-005).
    let titleChip = null;
    if (onMapTitle) {
      const pt = mapInstance.project([onMapTitle.lon, onMapTitle.lat]);
      titleChip = {
        x: pt.x * scale,
        y: pt.y * scale,
        text: onMapTitle.text,
        style: onMapTitle.style,
      };
    }

    return {
      canvas: composite({
        mapCanvas,
        outputWidth,
        outputHeight,
        titleChip,
        coeff,
        chipScale: scale,
        bottomFade,
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
  titleChip,
  coeff,
  chipScale,
  bottomFade,
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

  // Bottom fade — painted AFTER the map pixels but BEFORE the on-map title,
  // so the title reads on top of the fade band (composite order: map →
  // fade → title). wrapFrame (the decorative frame) runs in the caller,
  // after this whole composite, so the frame stays outermost of all.
  paintBottomFade(ctx, bottomFade, outputWidth, outputHeight);

  // PO-008/009 — draw the on-map title chip AFTER the map pixels (so it
  // floats on top of tiles + markers) and BEFORE wrapFrame (which runs in
  // the caller, so the decorative frame never paints over the title). The
  // caller (captureFramed) has already placed the chip's center at the
  // anchor's re-projected output pixel (FBL-012); here we only draw it. The
  // chip typography multiplies `coeff` by `chipScale` (dpr for current view,
  // 1 for a preset) so the pill keeps the same visual proportion in both
  // pixel spaces.
  if (titleChip) {
    drawOnMapTitle(ctx, {
      x: titleChip.x,
      y: titleChip.y,
      style: titleChip.style,
      text: titleChip.text,
      coeff: coeff * chipScale,
    });
  }

  return out;
}

// Bottom fade (poster-style caption zone). Paints a solid-at-the-bottom,
// transparent-at-the-top-of-the-band linear gradient onto `ctx` — mirrors
// js/map-fade.js's live CSS gradient exactly (same direction, same
// percentage-of-height sizing, same intensity opaque-hold split) so the
// live preview and the exported PNG match 1:1. `height` is a PERCENTAGE of
// the output canvas's own height (0-100), not px — see storage.js's
// DEFAULT_BOTTOM_FADE comment for why a percentage is the only value that
// reads identically across every export preset. `intensity` is a further
// PERCENTAGE (0-100) of the band, measured from the bottom edge, that stays
// fully opaque before the ramp to transparent begins — a 3-stop gradient
// rather than a plain 2-stop linear one. No-ops (draws nothing) when
// disabled or the band would be 0px — same "toggle off" contract PO-007's
// frame uses for thickness=0.
function paintBottomFade(ctx, fade, width, height) {
  if (!fade || !fade.enabled) return;
  const pct = Math.max(0, Math.min(100, Number(fade.height) || 0));
  const bandPx = Math.round((pct / 100) * height);
  if (bandPx <= 0) return;

  const intensity = Math.max(0, Math.min(100, Number(fade.intensity) || 0));

  // Gradient axis spans y = height-bandPx (offset 0, top of band) to
  // y = height (offset 1, bottom edge). The opaque hold starts at
  // `1 - intensity/100` of the way up the axis: intensity=0 → hold point at
  // offset 1 (bottom edge only, i.e. the old pure-linear fade); intensity=100
  // → hold point at offset 0 (opaque for the whole band).
  const grad = ctx.createLinearGradient(0, height - bandPx, 0, height);
  grad.addColorStop(0, hexToRgba(fade.color, 0));
  grad.addColorStop(Math.min(1, Math.max(0, 1 - intensity / 100)), hexToRgba(fade.color, 1));
  grad.addColorStop(1, hexToRgba(fade.color, 1));

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, height - bandPx, width, bandPx);
  ctx.restore();
}

// Parses `#rrggbb` into `rgba(r, g, b, alpha)`. Canvas gradient color stops
// need an explicit alpha channel to fade to transparent, and 8-digit hex
// (`#rrggbbaa`) canvas support isn't relied on here — this is the portable
// path. Falls back to white on a malformed hex so a corrupt/partial fade
// value (already defended against in storage.js's normalizeBottomFade, but
// this function may also see an un-normalized live DOM read) can never
// throw mid-export.
function hexToRgba(hex, alpha) {
  const match = typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.exec(hex);
  if (!match) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

// PO-007 (+ two-frames extension, this milestone) — Decorative frame
// composition. FLOATING MODEL: each frame is a coloured BAND drawn ONTO the
// captured map, not around it — the output stays map-sized and the map shows
// through everywhere except the band(s). `margin` insets a band from the
// canvas edge (map shows there), `thickness` is the band width, `radius` is
// its outer corner radius. `padding` is a gap just inside the band (also map)
// with no separate fill, so it doesn't affect what's painted. This matches
// the live overlay (js/map-frame.js) 1:1 at current-view scale, so the
// preview and the PNG agree.
//
// `frame` is now a FRAME SET — `{ frames: [frameElement, frameElement] }` —
// so a user can configure two independently nested bands (an outer thin
// band, a map gap, then an inner thin band) for a double-frame look. Each
// band's own `margin` places it at a different distance from the edge, so
// bands never overlap and paint order doesn't matter; they're drawn in
// array order (Frame 1 then Frame 2). `frames` is derived defensively so a
// bare single legacy frame object (not wrapped in a set) is still tolerated.
//
// Defensive: if NO frame element is enabled with thickness > 0 (after
// scaling), the inner canvas is returned untouched — nothing to draw.
// Preserves the PO-007 "thickness=0 == toggle off" acceptance criterion per
// element.
//
// Each band is one even-odd fill: an outer rounded rect (inset by margin,
// radius) with an inner rounded rect (inset by margin+thickness, radius minus
// the band width) punched out, so the map shows through the hole. When that
// element's `shadow` is true the fill carries a soft drop shadow, which —
// because the filled shape is the ring itself — casts onto the map along
// BOTH the band's inner and outer edges (a raised-frame look).
//   shadowColor   = "rgba(0,0,0,0.35)"
//   shadowBlur    = round(thickness * 0.4)
//   shadowOffsetY = round(thickness * 0.15)
function wrapFrame(innerCanvas, frame, scale = 1) {
  const frames = Array.isArray(frame?.frames)
    ? frame.frames
    : frame
    ? [frame]
    : [];

  const drawable = frames.filter((frameEl) => isFrameDrawable(frameEl, scale));
  if (drawable.length === 0) return innerCanvas;

  const out = document.createElement("canvas");
  out.width = innerCanvas.width;
  out.height = innerCanvas.height;
  const ctx = out.getContext("2d");

  // The map fills the whole canvas; each band is painted on top of it. Bands
  // sit at different margins (no overlap), so paint order is not critical —
  // painted in array order (Frame 1, then Frame 2).
  ctx.drawImage(innerCanvas, 0, 0);

  for (const frameEl of drawable) {
    paintFrameBand(ctx, frameEl, scale, out.width, out.height);
  }

  return out;
}

// True when `frameEl` has any band width to paint at all, after scaling —
// mirrors the per-element early-outs wrapFrame used to do inline before the
// two-frames extension (enabled=false or thickness<=0 means nothing drawn).
function isFrameDrawable(frameEl, scale) {
  if (!frameEl || !frameEl.enabled) return false;
  const thickness = Math.round(Math.max(0, Number(frameEl.thickness) || 0) * scale);
  return thickness > 0;
}

// Paints ONE frame element's band ring onto `ctx`, isolated in its own
// save/restore so one element's shadow settings never bleed into the next
// element's fill. `canvasWidth`/`canvasHeight` are the output canvas's own
// pixel dimensions (both elements share the same output canvas).
function paintFrameBand(ctx, frameEl, scale, canvasWidth, canvasHeight) {
  // Every dimension is stored/clamped (storage.js: 0–200) in CSS pixels.
  // Multiply by the inner canvas's CSS→pixel scale (dpr for a device-res
  // current-view canvas, 1 for a preset canvas) so the same stored values
  // read at the same visual proportion on every path (FBL-005).
  const margin = Math.round(Math.max(0, Number(frameEl.margin) || 0) * scale);
  const thickness = Math.round(Math.max(0, Number(frameEl.thickness) || 0) * scale);
  const radius = Math.round(Math.max(0, Number(frameEl.radius) || 0) * scale);

  if (thickness <= 0) return;

  // Band ring: outer rounded rect minus inner rounded rect, even-odd filled
  // with frameEl.color, so the map shows through the hole (and the
  // surrounding margin). The inner radius is the outer radius minus the band
  // width, floored at 0 — the same concentric nesting CSS border-radius does.
  const innerRadius = Math.max(0, radius - thickness);
  ctx.save();
  if (frameEl.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = Math.round(thickness * 0.4);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(thickness * 0.15);
  }
  ctx.beginPath();
  addRoundedRectSubpath(
    ctx,
    margin,
    margin,
    canvasWidth - 2 * margin,
    canvasHeight - 2 * margin,
    radius
  );
  addRoundedRectSubpath(
    ctx,
    margin + thickness,
    margin + thickness,
    canvasWidth - 2 * (margin + thickness),
    canvasHeight - 2 * (margin + thickness),
    innerRadius
  );
  ctx.fillStyle = frameEl.color;
  ctx.fill("evenodd");
  ctx.restore();
}

// PO-008/009. Validates the stored on-map title and extracts what the export
// needs — the anchor's lon/lat plus the user's formatting — or null when
// there's nothing renderable (missing/empty text, non-finite coordinates).
// The pixel position is deliberately NOT computed here: captureFramed
// re-projects the anchor on the LIVE map AFTER the preset resize (FBL-012),
// so the chip lands on the same geography it labels regardless of the
// export's aspect ratio, instead of the old pre-resize ratio approximation.
function prepareOnMapTitle(raw) {
  if (!raw || !raw.text) return null;
  if (!Number.isFinite(raw.lon) || !Number.isFinite(raw.lat)) return null;

  return {
    text: raw.text,
    lon: raw.lon,
    lat: raw.lat,
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

  // Multi-line support (mirrors the live overlay's `white-space: pre-line`,
  // which renders "\n" as a break): split on "\n" and stack lines using the
  // same lineHeightMultiplier the live CSS uses. A single-line title is a
  // 1-element array, so lineHeight/textBlockHeight collapse back to the
  // original textHeight/boxHeight math exactly.
  const lines = text.split("\n");
  const lineHeight = fontSize * ON_MAP_TITLE_BOX.lineHeightMultiplier;
  const textWidth = lines.reduce(
    (max, line) => Math.max(max, ctx.measureText(line).width),
    0
  );
  const textBlockHeight = lineHeight * lines.length;
  const boxWidth = textWidth + padX * 2;
  const boxHeight = textBlockHeight + padY * 2;
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
  lines.forEach((line, i) => {
    const lineY = y - textBlockHeight / 2 + lineHeight * (i + 0.5);
    ctx.fillText(line, x, lineY);
  });

  ctx.restore();
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  addRoundedRectSubpath(ctx, x, y, w, h, r);
}

// Adds a rounded-rect SUBPATH to the current path WITHOUT beginPath, so two
// calls under one beginPath + fill("evenodd") produce a frame ring (outer
// minus inner). A non-positive w/h (e.g. a band thicker than half the map)
// adds nothing, so the even-odd fill degrades to a solid rounded rect.
function addRoundedRectSubpath(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
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

// Resolves on the next render frame, or after `timeoutMs` if the `render`
// event never fires (see RENDER_WAIT_TIMEOUT_MS). Mirrors waitForIdle's
// race-against-timeout so both capture paths always settle and unwind their
// cleanup even under WebGL context loss. Used after triggerRepaint() so that
// getCanvas().toDataURL() reads pixels that match the current state, not the
// previous frame's framebuffer.
function waitForRender(mapInstance, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      mapInstance.off("render", finish);
      clearTimeout(timer);
      resolve();
    };
    mapInstance.once("render", finish);
    const timer = setTimeout(finish, timeoutMs);
  });
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
