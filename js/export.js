// PNG export via dom-to-image-more (loaded as a global from index.html CDN).
// Library choice is fixed in index.html — do not switch to html-to-image.

import { showError } from "./storage.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// 8s comfortably covers a slow first paint over a flaky connection while
// staying well under the user's patience for "I clicked Export."
const TILE_WAIT_TIMEOUT_MS = 8000;

// Preset exports resize the map to a brand-new viewport, which kicks off
// a fresh wave of tile fetches plus a `cacheBust` re-download of every
// already-loaded tile. The portrait/landscape A4 frames in particular can
// need 2–3× the tile count of the on-screen map. 12 s buys those a fair
// shot on slow connections without making a normal export feel sluggish
// (it still resolves the moment all layers fire `load`).
const TILE_WAIT_TIMEOUT_MS_PRESET = 12000;

// CSS-pixel offset that pushes the export frame fully off any reasonable
// viewport so the user never sees the wrap. Using `position: fixed` plus a
// large negative left keeps it laid out (so dom-to-image-more can paint it)
// while staying invisible.
const OFFSCREEN_PX = -100000;

// Preset id → {width, height} in CSS pixels for the exported PNG. `null`
// means "Current view — capture the live map at its on-screen size".
//
// A4 dimensions use 96 dpi (794×1123 portrait, the inverse for landscape).
// 300 dpi (2480×3508) was rejected as the v2 default: `cacheBust: true`
// re-fetches every tile, so a 300-dpi export over a typical home connection
// can take 10–20 s and produce a ~6 MB PNG. 96 dpi is print-acceptable on
// most consumer printers and keeps the click-to-download time under a few
// seconds. See NICE-007 task notes.
export const EXPORT_PRESETS = {
  current: null,
  square: { width: 1080, height: 1080 },
  "16x9": { width: 1920, height: 1080 },
  "a4-portrait": { width: 794, height: 1123 },
  "a4-landscape": { width: 1123, height: 794 },
  "a3-portrait": { width: 1191, height: 1684 },
  "a3-landscape": { width: 1684, height: 1191 },
};

/**
 * Capture the current map view and trigger a PNG download.
 * Waits for in-flight tiles before capturing so the image has no grey gaps.
 * On any failure, surfaces a user-visible message via the page error banner
 * and keeps the app usable (no re-throw).
 */
export async function exportMapAsPng(mapInstance) {
  try {
    if (!mapInstance) throw new Error("map instance not provided");
    if (typeof window.domtoimage === "undefined") {
      throw new Error("dom-to-image-more not loaded");
    }

    const titleInput = document.getElementById("export-title");
    const subtitleInput = document.getElementById("export-subtitle");
    const title = titleInput ? titleInput.value.trim() : "";
    const subtitle = subtitleInput ? subtitleInput.value.trim() : "";

    // Read the preset from the DOM, mirroring the title/subtitle reads
    // above. Keeps storage out of this module's runtime path — the format
    // selector's <option> values ARE the source of truth at click time.
    const formatSelect = document.getElementById("export-format");
    const presetId = formatSelect ? formatSelect.value : "current";
    const preset = EXPORT_PRESETS[presetId] ?? null;

    // Fast path: no title strip, no resize → capture the live map element
    // directly. Identical behaviour to CORE-012; preserved verbatim so a
    // user who never touches the new options gets the original code path.
    let dataUrl;
    if (!title && !subtitle && !preset) {
      await waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS);
      // No `filter` option — every descendant (tiles, markers, attribution
      // control) must be captured. Stripping anything risks losing the
      // OSM attribution, which the tile license requires.
      dataUrl = await window.domtoimage.toPng(mapInstance.getContainer(), {
        cacheBust: true,
      });
    } else {
      dataUrl = await captureFramed(mapInstance, title, subtitle, preset);
    }

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
}

// Single off-screen wrapper that handles both the title strip (NICE-006)
// and the preset resize (NICE-007). One try/finally so any failure unwinds
// the DOM and Leaflet state atomically.
//
// Off-screen technique: `position: fixed; left: -100000px; top: 0`. The
// wrapper is in the document (so dom-to-image-more can paint it) but well
// outside any reasonable viewport, so the user never sees the resized map
// and the page does not scroll. This was the existing CORE-012/NICE-006
// approach and it generalises cleanly to the larger preset sizes — Leaflet
// reads container dimensions from getBoundingClientRect, which works the
// same at negative coordinates.
async function captureFramed(mapInstance, title, subtitle, preset) {
  const mapEl = mapInstance.getContainer();

  // Snapshot every inline style we are about to mutate so we can replay
  // it exactly — including empty strings, which are the natural state for
  // most of these properties before this function ran.
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
  wrapper.className = "export-frame";
  wrapper.style.position = "fixed";
  wrapper.style.left = `${OFFSCREEN_PX}px`;
  wrapper.style.top = "0";

  const frameWidth = preset ? preset.width : rect.width;
  wrapper.style.width = `${frameWidth}px`;
  if (preset) {
    // Pin the wrapper to the exact preset dims so dom-to-image-more's
    // explicit width/height arguments line up with the rendered subtree
    // and the PNG comes out byte-for-byte sized to the preset.
    wrapper.style.height = `${preset.height}px`;
  }

  let titleStrip = null;
  if (title || subtitle) {
    titleStrip = buildTitleStrip(title, subtitle);
    wrapper.appendChild(titleStrip);
  }

  // Strip the .app-map `inset: 0` positioning so the map sits as a normal
  // block child of the wrapper. Without this, the map would still try to
  // pin itself to the (now off-screen) viewport.
  mapEl.style.position = "relative";
  mapEl.style.top = "auto";
  mapEl.style.right = "auto";
  mapEl.style.bottom = "auto";
  mapEl.style.left = "auto";
  mapEl.style.width = `${frameWidth}px`;
  // Provisional height for the no-preset path; the preset branch below
  // overwrites this once the title strip's real pixel height is known.
  mapEl.style.height = `${rect.height}px`;

  // Move the live map into the wrapper, then mount the wrapper itself.
  // Order matters: appending the map to a not-yet-mounted wrapper avoids
  // a brief layout where the map is parentless.
  wrapper.appendChild(mapEl);
  document.body.appendChild(wrapper);

  try {
    if (preset) {
      // Now that the wrapper is in the DOM, the title strip (if any) has
      // its real pixel height. The map fills the remainder so the captured
      // frame is exactly preset.width × preset.height with the title band
      // stacked above the map.
      const titleHeight = titleStrip ? titleStrip.offsetHeight : 0;
      const mapHeight = Math.max(0, preset.height - titleHeight);
      mapEl.style.height = `${mapHeight}px`;

      // Tell Leaflet the container is a different size now so it
      // recomputes its viewport and starts loading the new tile set.
      // animate:false — we don't want a zoom animation during export.
      mapInstance.invalidateSize({ animate: false });

      await waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS_PRESET);

      return await window.domtoimage.toPng(wrapper, {
        cacheBust: true,
        width: preset.width,
        height: preset.height,
      });
    }

    // Current-view preset with a title strip: keep the on-screen map
    // dimensions intact, no Leaflet resize needed, capture the wrapper at
    // its natural size (rect.width × (rect.height + titleStrip height)).
    await waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS);
    return await window.domtoimage.toPng(wrapper, { cacheBust: true });
  } finally {
    // Replay the snapshot in reverse: move the map back first (so any
    // layout observers see it in its real home), then drop the wrapper.
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
    if (preset) {
      // Force Leaflet back to the live container's true on-screen size so
      // pan, zoom, and pin clicks behave exactly as before the export.
      // Skipped for the no-preset path because we never touched Leaflet's
      // own size in that branch — the container's pixel dimensions were
      // re-pinned but stayed numerically equal to rect.width × rect.height.
      mapInstance.invalidateSize({ animate: false });
    }
    wrapper.remove();
  }
}

// Builds the title-strip element rendered above the map in the captured
// image. Returns a single <div class="export-title-strip"> containing one
// or both of <h2 class="export-title-strip__title"> and
// <p class="export-title-strip__subtitle">. If a field is empty, omit
// that element entirely — no phantom blank line in the PNG.
//
// Use textContent (not innerHTML) when injecting user input: the title
// and subtitle come straight from the DOM <input>s, and a curious user
// typing `<script>` should appear as literal characters in the PNG, not
// as injected markup at capture time.
function buildTitleStrip(title, subtitle) {
  const strip = document.createElement("div");
  strip.className = "export-title-strip";

  if (title) {
    const h = document.createElement("h2");
    h.className = "export-title-strip__title";
    h.textContent = title;
    strip.appendChild(h);
  }

  if (subtitle) {
    const p = document.createElement("p");
    p.className = "export-title-strip__subtitle";
    p.textContent = subtitle;
    strip.appendChild(p);
  }

  return strip;
}

// Resolves when every active tile layer has fired `load` (or after the
// timeout, whichever comes first). Resolves synchronously when nothing is
// pending so a click on a fully-rendered map doesn't add latency.
function waitForTiles(mapInstance, timeoutMs) {
  const tileLayers = [];
  mapInstance.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) tileLayers.push(layer);
  });
  if (tileLayers.length === 0) return Promise.resolve();

  // _loading is undocumented but stable across Leaflet 1.x and is what
  // Leaflet's own plugins read. If every layer is already idle, no need
  // to attach listeners.
  const pending = tileLayers.filter((layer) => layer._loading);
  if (pending.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let remaining = pending.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.forEach((layer) => layer.off("load", onLayerLoad));
      resolve();
    };

    const onLayerLoad = () => {
      remaining -= 1;
      if (remaining <= 0) finish();
    };

    pending.forEach((layer) => layer.on("load", onLayerLoad));
    const timer = setTimeout(finish, timeoutMs);
  });
}

// Programmatic download via a one-shot anchor. The element must be in the
// DOM for the click to take effect in Firefox; appending and removing in the
// same tick is enough.
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
