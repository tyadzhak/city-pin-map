// PNG export via native HTML5 Canvas. Composites the MapLibre WebGL canvas
// + an optional title strip into an off-screen 2D canvas, then toDataURL.
//
// Markers and the route line are layers inside the WebGL canvas (see
// js/map.js — Option B GeoJSONSource + circle/line layers), so they are
// captured automatically by getCanvas(). No post-composite step is needed.

import { showError } from "./storage.js";
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

// Reference canvas dimension that the BASE values in TITLE_STRIP and the
// pins-labels layer were tuned against (PO-006). The export coefficient
// is the longest output side divided by this baseline, clamped to keep
// extreme presets readable. Tuning history: a 1280-px-wide capture is the
// "canonical" desktop browser viewport these constants were eyeballed at.
const REFERENCE_BASELINE = 1280;
const COEFF_MIN = 0.6;
const COEFF_MAX = 2.5;

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

// Title strip layout — matches css/styles.css .export-title-strip so the
// exported PNG looks the same as the previous DOM-walk capture.
const TITLE_STRIP = {
  background: "#ffffff",
  textColor: "#1f2933",
  subtitleColor: "#4b5563",
  // Georgia ships on macOS / Windows / most Linux desktops, so the PNG
  // looks the same on every machine. Same fontstack as the previous CSS.
  fontFamily: 'Georgia, "Times New Roman", serif',
  titleSize: 32,
  titleWeight: 700,
  subtitleSize: 18,
  subtitleStyle: "italic",
  subtitleWeight: 400,
  paddingTop: 24,
  paddingBottom: 20,
  paddingX: 32,
  titleSubtitleGap: 6,
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

    const titleInput = document.getElementById("export-title");
    const subtitleInput = document.getElementById("export-subtitle");
    const title = titleInput ? titleInput.value.trim() : "";
    const subtitle = subtitleInput ? subtitleInput.value.trim() : "";

    const formatSelect = document.getElementById("export-format");
    const presetId = formatSelect ? formatSelect.value : "current";
    const preset = EXPORT_PRESETS[presetId] ?? null;

    let dataUrl;
    if (!title && !subtitle && !preset) {
      // Fast path: live map, no title strip, no resize. Capture the
      // canvas as-is. triggerRepaint + once('render') ensures the
      // framebuffer reflects the current state before we read it.
      await waitForIdle(mapInstance, TILE_WAIT_TIMEOUT_MS);
      mapInstance.triggerRepaint();
      await waitForRender(mapInstance);
      dataUrl = mapInstance.getCanvas().toDataURL("image/png");
    } else {
      dataUrl = await captureFramed(mapInstance, title, subtitle, preset);
    }

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
}

// Single off-screen wrapper that handles both the title strip and the
// preset resize. One try/finally so any failure unwinds the DOM and the
// MapLibre container atomically.
async function captureFramed(mapInstance, title, subtitle, preset) {
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
  wrapper.style.background = TITLE_STRIP.background;

  const frameWidth = preset ? preset.width : rect.width;

  // PO-006: the typography coefficient is a function of the export's
  // longest side. For preset captures we use the preset dimensions
  // directly. For "current view" we use the live map's CSS rect — the
  // map portion only, not including the title strip — so the coefficient
  // reflects the canvas the user actually sees, and ~1.0 for a typical
  // 1280-px-wide window keeps NICE-006's visual contract intact.
  const coeffSourceHeight = preset ? preset.height : rect.height;
  const coeff = computeCoeff(frameWidth, coeffSourceHeight);

  // Pre-compute the title strip metrics so we know its exact pixel height
  // before the map is resized. Strip height now scales with `coeff` too.
  const titleHeight =
    title || subtitle ? measureTitleStrip({ title, subtitle }, coeff) : 0;

  const frameHeight = preset ? preset.height : rect.height + titleHeight;

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
  mapEl.style.height = `${frameHeight - titleHeight}px`;

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
      mapHeightCss: frameHeight - titleHeight,
      titleStrip: {
        title,
        subtitle,
        height: titleHeight,
        width: frameWidth,
        coeff,
      },
      outputWidth: frameWidth,
      outputHeight: frameHeight,
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

// Returns the title strip's exact pixel height for the given inputs and
// the resolved scaling coefficient (PO-006). Every typographic constant
// — titleSize, subtitleSize, gap, paddings — scales by `coeff` so the
// strip grows in lockstep with the title and never crops a scaled glyph.
// Width is unused for the simple single-line layout we draw — long titles
// are clipped, matching the old CSS's white-space behaviour.
function measureTitleStrip({ title, subtitle }, coeff) {
  const titleLineHeight = title
    ? Math.ceil(TITLE_STRIP.titleSize * coeff * TITLE_STRIP.lineHeightMultiplier)
    : 0;
  const subtitleLineHeight = subtitle
    ? Math.ceil(
        TITLE_STRIP.subtitleSize * coeff * TITLE_STRIP.lineHeightMultiplier
      )
    : 0;
  const gap = title && subtitle ? TITLE_STRIP.titleSubtitleGap * coeff : 0;

  return Math.ceil(
    TITLE_STRIP.paddingTop * coeff +
      titleLineHeight +
      gap +
      subtitleLineHeight +
      TITLE_STRIP.paddingBottom * coeff
  );
}

// Clamp(longestSide / REFERENCE_BASELINE, [COEFF_MIN, COEFF_MAX]). Used
// by both the title strip and the pin-labels override. See PO-006 notes:
// the clamp guards against unreadable extremes from custom or future
// preset dimensions sitting far outside the tuned-for-1280 sweet spot.
function computeCoeff(width, height) {
  const longest = Math.max(width, height);
  const raw = longest / REFERENCE_BASELINE;
  return Math.min(COEFF_MAX, Math.max(COEFF_MIN, raw));
}

// Composite the map canvas + title strip into one output canvas and
// return its data URL. The output canvas is sized in CSS pixels to match
// what dom-to-image-more produced — same on-disk dimensions as the
// previous pipeline, no surprise size change for the user.
function composite({
  mapCanvas,
  mapWidthCss,
  mapHeightCss,
  titleStrip,
  outputWidth,
  outputHeight,
}) {
  const out = document.createElement("canvas");
  out.width = outputWidth;
  out.height = outputHeight;
  const ctx = out.getContext("2d");

  // Solid background under everything — covers the title strip area and
  // any margin if the map is letterboxed.
  ctx.fillStyle = TITLE_STRIP.background;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  if (titleStrip.height > 0) {
    drawTitleStrip(ctx, titleStrip);
  }

  // Map canvas drawn below the title strip, scaled to CSS pixel dims.
  // mapCanvas.width/.height are device pixels (CSS × dpr); drawImage's
  // 9-arg form rescales to the destination rect.
  ctx.drawImage(
    mapCanvas,
    0,
    0,
    mapCanvas.width,
    mapCanvas.height,
    0,
    titleStrip.height,
    mapWidthCss,
    mapHeightCss
  );

  return out.toDataURL("image/png");
}

function drawTitleStrip(ctx, { title, subtitle, height, width, coeff }) {
  ctx.fillStyle = TITLE_STRIP.background;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Every typographic constant is multiplied by `coeff` so the strip
  // matches what measureTitleStrip already reserved space for (PO-006).
  const titleSize = TITLE_STRIP.titleSize * coeff;
  const subtitleSize = TITLE_STRIP.subtitleSize * coeff;

  let cursorY = TITLE_STRIP.paddingTop * coeff;

  if (title) {
    ctx.fillStyle = TITLE_STRIP.textColor;
    ctx.font = `${TITLE_STRIP.titleWeight} ${titleSize}px ${TITLE_STRIP.fontFamily}`;
    const lineHeight = Math.ceil(titleSize * TITLE_STRIP.lineHeightMultiplier);
    // textBaseline alphabetic + cursorY+lineHeight*0.85 visually centers
    // the cap-height row in the line-height box. Matches the apparent
    // baseline the CSS engine produces with line-height: 1.2.
    ctx.fillText(title, width / 2, cursorY + lineHeight * 0.85);
    cursorY += lineHeight;
    if (subtitle) cursorY += TITLE_STRIP.titleSubtitleGap * coeff;
  }

  if (subtitle) {
    ctx.fillStyle = TITLE_STRIP.subtitleColor;
    ctx.font = `${TITLE_STRIP.subtitleStyle} ${TITLE_STRIP.subtitleWeight} ${subtitleSize}px ${TITLE_STRIP.fontFamily}`;
    const lineHeight = Math.ceil(
      subtitleSize * TITLE_STRIP.lineHeightMultiplier
    );
    ctx.fillText(subtitle, width / 2, cursorY + lineHeight * 0.85);
  }
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
