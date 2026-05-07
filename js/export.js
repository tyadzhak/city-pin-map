// PNG export via dom-to-image-more (loaded as a global from index.html CDN).
// Library choice is fixed in index.html — do not switch to html-to-image.

import { showError } from "./storage.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// 8s comfortably covers a slow first paint over a flaky connection while
// staying well under the user's patience for "I clicked Export."
const TILE_WAIT_TIMEOUT_MS = 8000;

// CSS-pixel offset that pushes the export frame fully off any reasonable
// viewport so the user never sees the wrap. Using `position: fixed` plus a
// large negative left keeps it laid out (so dom-to-image-more can paint it)
// while staying invisible.
const OFFSCREEN_PX = -100000;

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

    await waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS);

    // No `filter` option on either branch — every descendant (tiles,
    // markers, attribution control) must be captured. Stripping anything
    // risks losing the OSM attribution, which the tile license requires.
    let dataUrl;
    if (!title && !subtitle) {
      // Original CORE-012 path: capture the live map container as-is.
      dataUrl = await window.domtoimage.toPng(mapInstance.getContainer(), {
        cacheBust: true,
      });
    } else {
      dataUrl = await captureWithTitleStrip(mapInstance, title, subtitle);
    }

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
}

// Wraps the live map element in a transient `.export-frame` containing a
// title strip, captures the wrapper, then restores the DOM exactly as it
// was. The wrapper is positioned off-screen so the user never sees the
// reparenting; Leaflet internals are untouched (no invalidateSize), and
// the map's pixel dimensions are pinned for the duration of the capture
// so the absolute-positioned map node doesn't collapse in its new parent.
async function captureWithTitleStrip(mapInstance, title, subtitle) {
  const mapEl = mapInstance.getContainer();

  // Snapshot everything we are about to mutate so we can replay it exactly
  // — including empty strings (the natural inline-style state for most of
  // these properties before this function ran).
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
  wrapper.style.width = `${rect.width}px`;

  const titleStrip = buildTitleStrip(title, subtitle);
  wrapper.appendChild(titleStrip);

  // Pin pixel dimensions so the map stays exactly the size it was on
  // screen even after losing its `inset: 0` parent. Leaflet reads pixel
  // size from the container, so matching the original keeps tile math
  // stable — no reflow, no invalidateSize needed.
  mapEl.style.position = "relative";
  mapEl.style.top = "auto";
  mapEl.style.right = "auto";
  mapEl.style.bottom = "auto";
  mapEl.style.left = "auto";
  mapEl.style.width = `${rect.width}px`;
  mapEl.style.height = `${rect.height}px`;

  // Move the live map into the wrapper, then mount the wrapper itself.
  // Order matters: appending the map to a not-yet-mounted wrapper avoids a
  // brief layout where the map is parentless.
  wrapper.appendChild(mapEl);
  document.body.appendChild(wrapper);

  try {
    return await window.domtoimage.toPng(wrapper, { cacheBust: true });
  } finally {
    // Replay snapshot in reverse: move the map back first (so any layout
    // observers see it in its real home), then drop the wrapper.
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
