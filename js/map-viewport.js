// Live WYSIWYG preview of the selected EXPORT SIZE. When an export preset
// (non-"current") is selected, the live `#map` element is letterboxed to
// that preset's ASPECT RATIO — contain-fit and centered within the
// available `.app-map` area (see css/styles.css: `.app-map` is now a flex
// container with `overflow: hidden`, and `#map` defaults to filling it) —
// so the user sees exactly the crop the export will capture. Selecting
// "Current view" (preset `null`) clears the inline sizing and lets `#map`
// fill the whole area again, matching pre-this-feature behaviour.
//
// LETTERBOX MODEL: `.app-map`'s own #dbe2ea background reads as the
// letterbox mat. `#map` is sized in CSS pixels to the largest box with the
// preset's aspect ratio that fits inside `.app-map`'s content box, then
// `map.resize()` tells MapLibre to re-measure its container.
//
// EXPORT-CAPTURE REPARENT GUARD: js/export.js's captureFramed() temporarily
// reparents `#map` into an off-screen wrapper (to render a preset at exact
// pixel dimensions for the PNG) and restores it afterward. While that's
// happening, a ResizeObserver tick on `.app-map` (e.g. from the off-screen
// wrapper's own layout, or a stray resize elsewhere) must NOT fight the
// capture by resetting #map's inline size mid-flight. `apply()` guards
// against this by checking that `#map`'s parent is still `.app-map` before
// touching any styles — while reparented, the guard makes `apply()` a
// no-op, and captureFramed's own restore path puts `#map` back before this
// module would ever observe a legitimate resize again.
//
// Public surface: `init(map)` — idempotent, returns `{ setPreset }`.

let ro = null;
let mapEl = null;
let appMapEl = null;
let mapInstance = null;
let currentPreset = null;

/**
 * Wire the viewport controller to `map`. Idempotent: a second call reuses
 * the existing ResizeObserver rather than creating a duplicate one.
 */
export function init(map) {
  if (!mapInstance) {
    mapInstance = map;
    mapEl = map.getContainer();
    appMapEl = mapEl.parentElement;

    if (appMapEl && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => apply());
      ro.observe(appMapEl);
    }
    // No ResizeObserver / no parent element: degrade gracefully — setPreset
    // below still does a one-shot apply() on every call, it just won't
    // re-fit automatically when the panel/window resizes.
  }

  return { setPreset };
}

/**
 * Store the requested preset (`{ width, height }` or `null` for "current
 * view") and re-fit immediately.
 */
function setPreset(preset) {
  currentPreset = preset || null;
  apply();
}

function apply() {
  if (!mapEl || !appMapEl || !mapInstance) return;

  // Reparent guard: captureFramed() temporarily moves #map out of .app-map
  // during a PNG export. If we're not currently a direct child of the
  // element we were initialized against, some other process owns #map's
  // layout right now — don't touch styles or call resize().
  if (mapEl.parentElement !== appMapEl) return;

  if (!currentPreset) {
    // "Current view" — clear inline sizing so the CSS default (100%/100%,
    // filling .app-map) takes over.
    mapEl.style.width = "";
    mapEl.style.height = "";
    mapInstance.resize();
    return;
  }

  const rect = appMapEl.getBoundingClientRect();
  const availW = rect.width;
  const availH = rect.height;
  if (availW <= 0 || availH <= 0) return;

  const ratio = currentPreset.width / currentPreset.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return;

  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }

  mapEl.style.width = `${Math.round(w)}px`;
  mapEl.style.height = `${Math.round(h)}px`;
  mapInstance.resize();
}
