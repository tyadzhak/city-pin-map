// PNG export via dom-to-image-more (loaded as a global from index.html CDN).
// Library choice is fixed in index.html — do not switch to html-to-image.

import { showError } from "./storage.js";

// Safety net so a stalled tile fetch can't hang the whole export.
// 8s comfortably covers a slow first paint over a flaky connection while
// staying well under the user's patience for "I clicked Export."
const TILE_WAIT_TIMEOUT_MS = 8000;

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

    const container = mapInstance.getContainer();
    await waitForTiles(mapInstance, TILE_WAIT_TIMEOUT_MS);

    // No `filter` option — every descendant (tiles, markers, attribution
    // control) must be captured. Stripping anything risks losing the OSM
    // attribution, which the tile license requires us to keep visible.
    const dataUrl = await window.domtoimage.toPng(container, {
      cacheBust: true,
    });

    triggerDownload(dataUrl, `city-pin-map-${todayStamp()}.png`);
  } catch (err) {
    console.error("PNG export failed:", err);
    showError("Could not export the map. Try again.");
  }
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
