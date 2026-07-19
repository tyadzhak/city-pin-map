// PNG export via native HTML5 Canvas. Composites the MapLibre WebGL canvas
// into an off-screen 2D canvas, paints the pin labels (js/map-labels.js's DOM
// overlay is NOT part of the WebGL canvas, so they must be re-drawn here from
// computeLabelSpecs()), then the bottom fade (poster-style caption zone), then
// the corner inset box (js/map-inset.js's live overlay, drawn from its second
// MapLibre map's canvas — its labels aren't in ITS canvas either, so they're
// re-painted inside the box too), then the on-map title overlay (PO-008) at its
// projected position — composite order is map → pin labels → bottom fade →
// inset → title, mirroring the live z-order (labels z2 < fade z3 < inset z4 <
// title z6) so the fade dissolves labels and the inset/title read on top —
// then optionally wraps the result in a decorative frame (PO-007, outermost of
// all), then toDataURL. The inset box's position/size (free-dragged or
// frame-aware corner-docked, per the box's current freePos/corner config)
// comes from js/map-inset.js's getResolvedPlacement() — its CSS-px outer
// top-left + square size for the map container's CURRENT dimensions — scaled
// by the same CSS→output-pixel factor as the rest of the composite's fixed-px
// chrome (border/radius/shadow, mirroring .map-inset-overlay in
// css/styles.css 1:1) so the live preview and the exported PNG agree.
//
// Markers and the route line are layers inside the WebGL canvas (see
// js/map.js — Option B GeoJSONSource + circle/line layers), so they are
// captured automatically by getCanvas(). Pin LABELS moved out of WebGL into a
// DOM overlay (js/map-labels.js), so paintPinLabels() re-draws them onto the
// composite from the same computeLabelSpecs() the live overlay uses.
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
//   • Everything drawn onto the 2D canvas by us (the title chip, the pin
//     labels) and the frame thickness is expressed in CSS pixels and multiplied
//     by that canvas's effective CSS→output scale — `chipScale` for the title
//     and labels, `innerScale` for the frame — so a given view / frame / chip /
//     label reads at the same visual proportion on both paths regardless of
//     dpr. MapLibre-drawn content (tiles, markers) is scaled by the GL
//     context's own pixelRatio, so it needs no extra factor. Pin labels are no
//     longer GL-drawn (DOM overlay, js/map-labels.js); they're re-painted from
//     computeLabelSpecs() at `chipScale`, with an optional `sizeMultiplier`
//     (= `coeff` for presets, 1 for current view) reproducing PO-006's old
//     size bump — see paintPinLabels / computeLabelSpecs.

import {
  showError,
  loadExportFrame,
  loadOnMapTitle,
  loadBottomFade,
} from "./storage.js";
import { computeLabelSpecs } from "./map-labels.js";
import { getInsetMap, getResolvedPlacement } from "./map-inset.js";

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

    // PO-008/009 — on-map title, frame-relative anchor. We only extract +
    // validate the title here (its normalized nx/ny anchor + the user's
    // formatting); the pixel position is computed later, inside
    // captureFramed, as nx/ny * outputWidth/outputHeight — no re-projection
    // off the live map needed, so the title stays frame-fixed at any
    // aspect ratio/preset.
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
    // Pin labels are a DOM overlay now (js/map-labels.js), NOT part of the
    // WebGL canvas getCanvas() returns — so the raw-framebuffer fast path can
    // only be taken when there are zero labels to paint. With any pin present,
    // even "Current view" must go through the composite path so paintPinLabels
    // can draw them back onto the output.
    const hasPinLabels = computeLabelSpecs(mapInstance).labels.length > 0;

    let innerCanvas;
    let innerScale;
    if (
      !preset &&
      !onMapTitle &&
      !fadeDrawable &&
      getInsetMap() === null &&
      !hasPinLabels
    ) {
      // Fast path: live map, no resize, no overlay text, no fade, no inset,
      // no pin labels, no extra canvas. Capture the framebuffer as-is (device
      // resolution). An active corner inset (or any pin label) forces the
      // composite path just like the fade does, since getCanvas() alone can't
      // carry the second map's box or the DOM label overlay.
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

    mapInstance.triggerRepaint();
    await waitForRender(mapInstance, RENDER_WAIT_TIMEOUT_MS);

    // Corner inset (js/map-inset.js). Its overlay box is sized as a % of the
    // #map container, so it just resized ALONGSIDE the main map above — its
    // second MapLibre map now needs to re-measure and re-settle at the export
    // resolution before we read its canvas. Mirrors the main map's
    // resize → idle → repaint → render sequence exactly, on the inset map.
    //
    // Failure honesty (CLAUDE.md: never silently swallow): waitForIdle
    // resolves false on timeout. For the MAIN map a stale-but-valid frame is
    // acceptable, but a half-loaded inset would export a blank/torn box — so a
    // timeout here THROWS, routing to exportMapAsPng's showError() catch and
    // the finally-block restore, rather than shipping a broken inset.
    const insetMap = getInsetMap();
    if (insetMap) {
      insetMap.resize();
      const settled = await waitForIdle(insetMap, TILE_WAIT_TIMEOUT_MS_PRESET);
      if (!settled) {
        throw new Error("inset map did not settle before export");
      }
      insetMap.triggerRepaint();
      await waitForRender(insetMap, RENDER_WAIT_TIMEOUT_MS);
    }

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

    // The title's anchor (nx/ny) is a normalized frame-relative fraction, so
    // its pixel position is computed directly from the output dims — no
    // re-projection off the live map needed, and it stays frame-fixed at
    // any aspect ratio/preset.
    let titleChip = null;
    if (onMapTitle) {
      titleChip = {
        x: onMapTitle.nx * outputWidth,
        y: onMapTitle.ny * outputHeight,
        lines: onMapTitle.lines,
      };
    }

    // Pin labels (js/map-labels.js DOM overlay — NOT in the WebGL canvas).
    // Computed AFTER the resize + idle + render settle so map.project() reads
    // the resized viewport's CSS px. `sizeMultiplier` is the typography `coeff`
    // for a preset (reproducing PO-006's old label-size bump, which also scaled
    // the ems-derived offset) and 1 for a current-view composite (so the export
    // matches the on-screen labels 1:1). paintPinLabels then scales the returned
    // CSS-px positions/font by `scale` (chipScale) like the title chip does.
    const labelMultiplier = preset ? coeff : 1;
    const labelSpecs = computeLabelSpecs(mapInstance, {
      sizeMultiplier: labelMultiplier,
    });

    // Inset canvas + geometry, read AFTER its settle above. getInsetMap()
    // could in principle flip to null between the settle and here (a pin/group
    // change firing the live subscription mid-export); re-read once and gate
    // the composite paint on it so we never drawImage a hidden box.
    // getResolvedPlacement() is read AFTER the container's resize()+idle+render
    // settle above (both the main map's and, if present, the inset's own), so
    // it reflects the box's actual px rect at the EXPORT's resized container
    // dimensions — freePos fractions and the frame-aware dock offset both
    // included, exactly like the live overlay computes it on every
    // ResizeObserver tick.
    const activeInset = getInsetMap();
    const insetCanvas = activeInset ? activeInset.getCanvas() : null;
    const insetPlacement = activeInset ? getResolvedPlacement() : null;
    // Inset labels use the SAME sizeMultiplier convention; positions are in the
    // inset map's own (resized) CSS px, transformed into the box inside
    // paintInset.
    const insetLabelSpecs = activeInset
      ? computeLabelSpecs(activeInset, { sizeMultiplier: labelMultiplier })
      : null;

    return {
      canvas: composite({
        mapCanvas,
        outputWidth,
        outputHeight,
        titleChip,
        coeff,
        chipScale: scale,
        bottomFade,
        labelSpecs,
        insetCanvas,
        insetPlacement,
        insetLabelSpecs,
      }),
      scale,
    };
  } finally {
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
    // The inset overlay travels inside #map, so it just resized back with the
    // container above — re-measure its map so the live corner box returns to
    // its on-screen size (mirrors the main map's restore resize). Re-read the
    // handle: it may have been thrown-past or cleared during this capture.
    const insetOnRestore = getInsetMap();
    if (insetOnRestore) insetOnRestore.resize();
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
  labelSpecs,
  insetCanvas,
  insetPlacement,
  insetLabelSpecs,
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

  // Pin labels (js/map-labels.js DOM overlay) — painted RIGHT AFTER the map
  // pixels and BEFORE the bottom fade, matching the live z-order (labels z2 <
  // fade z3 < inset z4 < title z6): the fade dissolves the labels, and the
  // inset box + title read on top of them. Positions/font come from
  // computeLabelSpecs (CSS px) scaled by chipScale into output px.
  paintPinLabels(ctx, labelSpecs, chipScale);

  // Bottom fade — painted AFTER the map pixels + labels but BEFORE the on-map
  // title, so the title reads on top of the fade band (composite order: map →
  // labels → fade → inset → title). wrapFrame (the decorative frame) runs in
  // the caller, after this whole composite, so the frame stays outermost of all.
  paintBottomFade(ctx, bottomFade, outputWidth, outputHeight);

  // Corner inset — painted AFTER the fade but BEFORE the on-map title, so the
  // composite order is map → fade → inset → title (the title always reads on
  // top of the box, and wrapFrame still runs last in the caller so the frame
  // stays outermost). The box's position/size (insetPlacement, from
  // getResolvedPlacement()) is already resolved in CSS px for the export's
  // resized container, so it — and the CSS-px box chrome
  // (border/radius/shadow) — scale by `chipScale`, the same CSS→output-pixel
  // factor the frame band uses, NOT the typography coeff, because the box is a
  // fixed-CSS-px decoration like the frame, not readability-scaled text.
  paintInset(ctx, insetCanvas, insetPlacement, chipScale, insetLabelSpecs);

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
      lines: titleChip.lines,
      coeff: coeff * chipScale,
    });
  }

  return out;
}

// Corner inset box (js/map-inset.js). Draws the inset map's own canvas into a
// framed square at its resolved placement, mirroring the live
// .map-inset-overlay 1:1 so the preview and the exported PNG agree. Geometry:
//   • `placement` is js/map-inset.js's getResolvedPlacement() result — the
//     box's ACTUAL outer top-left (x, y) + square outer size, all in CSS px,
//     already resolved for the export's (resized) container: freePos
//     fractions and the frame-aware dock offset are both baked in, so this
//     function does no corner/margin math of its own — it just scales the
//     resolved rect into output px via `coeff`;
//   • a 2px white border, 6px outer radius, and the .map-inset-overlay drop
//     shadow (0 2px 10px rgba(0,0,0,.25)) — all CSS-px values scaled by
//     `coeff` (= the frame's chipScale: CSS→output-pixel scale, 1 for a
//     preset, dpr for current view).
// The inset map's backing-store pixel size differs from its CSS box size
// (× dpr), so drawImage scale-draws the WHOLE canvas into the clipped inner
// square. No-op when there's no active inset (getInsetMap() was null).
//
// The inset's own pin labels (js/map-labels.js display-only overlay) are NOT
// part of its canvas either, so `insetLabelSpecs` (computeLabelSpecs on the
// inset map) is painted inside the same rounded-rect clip after the canvas —
// see the paintPinLabels call below.
function paintInset(ctx, insetCanvas, placement, coeff, insetLabelSpecs) {
  if (!insetCanvas || !placement) return;

  const boxSize = Math.max(0, Number(placement.size) || 0) * coeff;
  if (boxSize <= 0) return;

  const border = 2 * coeff;
  const radius = 6 * coeff;

  // Outer (border-box) top-left, scaled from the resolved CSS-px rect into
  // output px by the same CSS→output-pixel factor as the border/radius/shadow.
  const x = (Number(placement.x) || 0) * coeff;
  const y = (Number(placement.y) || 0) * coeff;

  ctx.save();

  // 1) White rounded-rect box carrying the drop shadow. This IS the 2px white
  //    border — the inset map is drawn clipped INSIDE it, leaving the white
  //    ring showing, exactly like the CSS border + overflow:hidden.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 10 * coeff;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2 * coeff;
  ctx.fillStyle = "#ffffff";
  drawRoundedRect(ctx, x, y, boxSize, boxSize, radius);
  ctx.fill();
  ctx.restore();

  // 2) Inset map, clipped to the inner rounded square (inset by the border).
  const innerX = x + border;
  const innerY = y + border;
  const innerSize = boxSize - 2 * border;
  if (innerSize > 0) {
    const innerRadius = Math.max(0, radius - border);
    ctx.save();
    drawRoundedRect(ctx, innerX, innerY, innerSize, innerSize, innerRadius);
    ctx.clip();
    ctx.drawImage(
      insetCanvas,
      0,
      0,
      insetCanvas.width,
      insetCanvas.height,
      innerX,
      innerY,
      innerSize,
      innerSize
    );

    // Inset pin labels (js/map-labels.js display-only overlay — NOT in the
    // inset canvas). Painted INSIDE the same rounded-rect clip so labels are
    // trimmed at the box edge exactly like the live overlay's overflow:hidden.
    // computeLabelSpecs returned positions in the inset map's own CSS px; the
    // inner map area (innerSize output px) equals insetCssWidth × coeff — the
    // SAME chipScale factor — so a label at CSS (lx, ly) lands at
    // (innerX + lx*coeff, innerY + ly*coeff).
    paintPinLabels(ctx, insetLabelSpecs, coeff, innerX, innerY);
    ctx.restore();
  }

  ctx.restore();
}

// Draw the pin labels from computeLabelSpecs (js/map-labels.js — the SAME
// source of truth the live DOM overlay uses) onto the composite. `specs.labels`
// carry CSS-px positions in the (resized) map viewport; `scale` is the
// CSS→output-pixel factor (chipScale: 1 for a preset, dpr for current view).
// `offsetX`/`offsetY` shift the whole set (0 for the main map; the inset's
// inner-map top-left for inset labels, whose positions are relative to the
// inset viewport). x is the label's horizontal CENTER, y its TOP edge, matching
// the overlay's translate(-50%,0) + textAnchor:top.
//
// Halo: the live overlay draws a white 8-direction text-shadow outline at the
// halo WIDTH (spec.halo.blurPx carries 1.5). We reproduce it with a single
// strokeText UNDER the fill — white, lineWidth = 2×haloWidth×scale (so the
// stroke, centred on the glyph outline, extends ~haloWidth outward each side,
// matching the shadow ring's reach), lineJoin "round" to soften corners like
// the blurred shadow. One crisp stroke reads cleaner than eight offset copies
// at export resolution while landing on the same visual weight.
function paintPinLabels(ctx, specs, scale, offsetX = 0, offsetY = 0) {
  if (!specs || !Array.isArray(specs.labels) || specs.labels.length === 0) {
    return;
  }
  const style = specs.style || {};
  const fontSize = (Number(style.sizePx) || 0) * scale;
  if (!(fontSize > 0)) return;

  const weight = style.bold ? "700" : "400";
  const styleToken = style.italic ? "italic " : "";
  const fontFamily = style.fontFamily || "sans-serif";

  const halo = style.halo || {};
  const haloWidth = Number.isFinite(halo.blurPx) ? halo.blurPx : 0;
  const haloLineWidth = 2 * haloWidth * scale;
  const haloColor = typeof halo.color === "string" ? halo.color : "#ffffff";
  const fillColor = typeof style.color === "string" ? style.color : "#1f2937";

  ctx.save();
  ctx.font = `${styleToken}${weight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  for (const label of specs.labels) {
    if (!label || typeof label.text !== "string" || label.text.length === 0) {
      continue;
    }
    const px = offsetX + label.x * scale;
    const py = offsetY + label.y * scale;
    if (haloLineWidth > 0) {
      ctx.strokeStyle = haloColor;
      ctx.lineWidth = haloLineWidth;
      ctx.strokeText(label.text, px, py);
    }
    ctx.fillStyle = fillColor;
    ctx.fillText(label.text, px, py);
  }

  ctx.restore();
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
// scaling) AND the outside treatment is "none" (or has no enabled frame to
// bound against), the inner canvas is returned untouched — nothing to draw.
// Preserves the PO-007 "thickness=0 == toggle off" acceptance criterion per
// element.
//
// `outside` (this milestone) fills/blurs the region beyond the OUTERMOST
// ENABLED frame's outer edge — see outermostEnabledFrame / paintFrameOutside
// below. Painted before the bands so a band's own edge still reads crisply
// over it. A no-op when no frame is enabled at all (no boundary to paint
// against), regardless of `outside.mode`.
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
  const outside = frame?.outside || null;

  const drawable = frames.filter((frameEl) => isFrameDrawable(frameEl, scale));
  // "Outermost enabled" (not "drawable") on purpose: a frame with thickness
  // 0 still defines a boundary via its own margin/radius even though it
  // paints no band of its own — see outermostEnabledFrame's own comment.
  const outermost = outermostEnabledFrame(frames);
  const outsideMode = outermost ? normalizeOutsideMode(outside?.mode) : "none";

  if (drawable.length === 0 && outsideMode === "none") return innerCanvas;

  const out = document.createElement("canvas");
  out.width = innerCanvas.width;
  out.height = innerCanvas.height;
  const ctx = out.getContext("2d");

  // The map fills the whole canvas; each band is painted on top of it. Bands
  // sit at different margins (no overlap), so paint order is not critical —
  // painted in array order (Frame 1, then Frame 2).
  ctx.drawImage(innerCanvas, 0, 0);

  // Outside-frame treatment paints BEFORE the bands so a band's own edge
  // still reads crisply on top of it (the fill/blur only ever touches the
  // region beyond the outermost band's outer edge, but painting order keeps
  // this correct even at the boundary pixel row).
  if (outsideMode !== "none") {
    paintFrameOutside(ctx, innerCanvas, outermost, outside, scale, out.width, out.height);
  }

  for (const frameEl of drawable) {
    paintFrameBand(ctx, frameEl, scale, out.width, out.height);
  }

  return out;
}

// Among ENABLED frame elements, the one with the smallest `margin` — its
// outer edge sits closest to the canvas edge, i.e. the largest outer
// rounded-rect. Mirrors js/map-frame.js's identical helper so the live
// preview and the exported PNG always agree on which frame the outside
// treatment bounds against. Deliberately keys off `.enabled`, NOT
// isFrameDrawable's additional thickness>0 requirement — an enabled frame
// with a 0px band still has a real margin/radius boundary.
function outermostEnabledFrame(frames) {
  let best = null;
  let bestMargin = Infinity;
  for (const f of frames) {
    if (!f || !f.enabled) continue;
    const margin = Math.max(0, Number(f.margin) || 0);
    if (margin < bestMargin) {
      bestMargin = margin;
      best = f;
    }
  }
  return best;
}

const OUTSIDE_MODES = ["none", "white", "blur"];
function normalizeOutsideMode(mode) {
  return OUTSIDE_MODES.includes(mode) ? mode : "none";
}

// Paints the OUTSIDE-frame treatment (this milestone): the region beyond
// the outer edge of the outermost ENABLED frame — the margin band between
// the canvas edge and that frame's outer rounded-rect. Called BEFORE the
// frame bands (paintFrameBand runs right after this in wrapFrame) so a
// band still reads crisply over it at its own edges.
//
// `white` is a flat even-odd fill: full-canvas rect minus the inner
// rounded-rect, filled with `outside.color`.
//
// `blur` clips to that same even-odd region and draws a blurred copy of
// `sourceCanvas` (the ALREADY-COMPOSITED map — bottom fade + on-map title
// included, per this file's header comment on composite order) via
// ctx.filter. The clip means pixels inside the frame boundary are
// untouched; the title/fade DO blur wherever they happen to fall in the
// outside region, matching what a real optical blur would do to whatever
// is physically out there. Falls back to the `white` behavior when
// ctx.filter isn't supported by the running engine (never silently no-op —
// CLAUDE.md's error convention).
function paintFrameOutside(ctx, sourceCanvas, outermost, outside, scale, canvasWidth, canvasHeight) {
  const mode = normalizeOutsideMode(outside?.mode);
  if (mode === "none") return;

  const margin = Math.round(Math.max(0, Number(outermost.margin) || 0) * scale);
  const radius = Math.round(Math.max(0, Number(outermost.radius) || 0) * scale);
  const innerX = margin;
  const innerY = margin;
  const innerW = canvasWidth - 2 * margin;
  const innerH = canvasHeight - 2 * margin;

  const buildOutsidePath = () => {
    ctx.beginPath();
    addRoundedRectSubpath(ctx, 0, 0, canvasWidth, canvasHeight, 0);
    addRoundedRectSubpath(ctx, innerX, innerY, innerW, innerH, radius);
  };

  if (mode === "white") {
    const color =
      typeof outside.color === "string" && /^#[0-9a-fA-F]{6}$/.test(outside.color)
        ? outside.color
        : "#ffffff";
    ctx.save();
    buildOutsidePath();
    ctx.fillStyle = color;
    ctx.fill("evenodd");
    ctx.restore();
    return;
  }

  // mode === "blur". Feature-detect ctx.filter: an unsupporting engine never
  // defines the property at all (typeof stays "undefined"), vs. a
  // supporting one that always reads back a string ("none" by default).
  const filterSupported = typeof ctx.filter === "string";
  if (!filterSupported) {
    paintFrameOutside(
      ctx,
      sourceCanvas,
      outermost,
      { mode: "white", color: "#ffffff" },
      scale,
      canvasWidth,
      canvasHeight
    );
    return;
  }

  const blurPx = Math.round(Math.max(0, Math.min(50, Number(outside.blur) || 0)) * scale);
  ctx.save();
  buildOutsidePath();
  ctx.clip("evenodd");
  ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";
  ctx.drawImage(sourceCanvas, 0, 0, canvasWidth, canvasHeight);
  ctx.filter = "none";
  ctx.restore();
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

// Per-line title model (this milestone). Validates the stored/live on-map
// title and extracts what the export needs — the anchor's normalized nx/ny
// fraction plus the ordered list of renderable lines, each with its own
// style — or null when there's nothing renderable (no lines with non-empty
// text, non-finite fractions). The pixel position is deliberately NOT
// computed here: captureFramed multiplies nx/ny by the output dims
// directly, so the block stays frame-fixed at any aspect ratio without any
// re-projection off the live map.
//
// Lines with empty text are dropped (only rendered ones need to reach the
// canvas painter) but ORDER among the remaining lines is preserved. Note
// this means an empty line does NOT act as vertical spacing — it renders as
// zero height, same as the live overlay — so this filter never removes a
// gap the user was relying on.
function prepareOnMapTitle(raw) {
  if (!raw || !Array.isArray(raw.lines)) return null;
  if (!Number.isFinite(raw.nx) || !Number.isFinite(raw.ny)) return null;

  const lines = raw.lines
    .filter((line) => line && typeof line.text === "string" && line.text.length > 0)
    .map((line) => ({
      text: line.text,
      style: {
        font: line.font,
        bold: Boolean(line.bold),
        italic: Boolean(line.italic),
        color: line.color,
        size: line.size,
      },
    }));
  if (lines.length === 0) return null;

  return { nx: raw.nx, ny: raw.ny, lines };
}

// Per-line title model (this milestone). Paints the chip at (x, y) —
// interpreted as the chip's CENTER, mirroring the live overlay's
// translate(-50%, -50%) trick. Each entry in `lines` carries its OWN style
// (font/bold/italic/color/size) — unlike the old single-style title, this
// draws every line with its own `ctx.font`/fillStyle rather than one shared
// style for the whole block. The box constants (background, border,
// padding, radius) still come from ON_MAP_TITLE_BOX and stay uniform across
// lines so the backdrop reads as one pill. Every dimension scales by
// `coeff` so a 1080² preset gets a slightly smaller pill than a 1920×1080
// one — same proportional-sizing contract the pin labels follow.
//
// A single-line title is a 1-element `lines` array, so this collapses back
// to exactly the old single-style box math.
function drawOnMapTitle(ctx, { x, y, lines, coeff }) {
  const padX = ON_MAP_TITLE_BOX.paddingX * coeff;
  const padY = ON_MAP_TITLE_BOX.paddingY * coeff;
  const radius = ON_MAP_TITLE_BOX.borderRadius * coeff;
  const borderWidth = ON_MAP_TITLE_BOX.borderWidth * coeff;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // First pass: measure every line at its OWN font/size (ctx.font must be
  // set before measureText reflects it), building parallel arrays of
  // { fontString, lineHeight } and the running maxWidth/totalHeight the box
  // needs. A second pass (below) re-sets ctx.font per line when actually
  // drawing — cheap, and avoids caching font strings across two loops.
  let maxWidth = 0;
  let totalHeight = 0;
  const lineHeights = lines.map((line) => {
    const fontSize = line.style.size * coeff;
    const weight = line.style.bold ? "700" : "400";
    const styleToken = line.style.italic ? "italic " : "";
    ctx.font = `${styleToken}${weight} ${fontSize}px ${line.style.font}`;
    maxWidth = Math.max(maxWidth, ctx.measureText(line.text).width);
    const lineHeight = fontSize * ON_MAP_TITLE_BOX.lineHeightMultiplier;
    totalHeight += lineHeight;
    return lineHeight;
  });

  const boxWidth = maxWidth + padX * 2;
  const boxHeight = totalHeight + padY * 2;
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

  // Stack lines top → bottom, each drawn with its own font + fill color.
  let runningTop = y - totalHeight / 2;
  lines.forEach((line, i) => {
    const lineHeight = lineHeights[i];
    const fontSize = line.style.size * coeff;
    const weight = line.style.bold ? "700" : "400";
    const styleToken = line.style.italic ? "italic " : "";
    ctx.font = `${styleToken}${weight} ${fontSize}px ${line.style.font}`;
    ctx.fillStyle = line.style.color;
    const centerY = runningTop + lineHeight / 2;
    ctx.fillText(line.text, x, centerY);
    runningTop += lineHeight;
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
// already idle, `once('idle')` resolves on the next tick. Resolves `true`
// when `idle` won the race and `false` on timeout — the main-map callers
// ignore the value (a stale-but-valid frame is acceptable there), but the
// inset capture path treats a `false` as a hard failure (see captureFramed).
function waitForIdle(mapInstance, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (viaIdle) => {
      if (settled) return;
      settled = true;
      mapInstance.off("idle", onIdle);
      clearTimeout(timer);
      resolve(viaIdle);
    };
    const onIdle = () => finish(true);
    mapInstance.once("idle", onIdle);
    const timer = setTimeout(() => finish(false), timeoutMs);
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
